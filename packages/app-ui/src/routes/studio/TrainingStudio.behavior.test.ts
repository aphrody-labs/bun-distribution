// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, test } from "bun:test";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { TrainingStudio, type TrainingStudioBackend } from "./TrainingStudio";
import type { ShenronTraining, TrainEvent } from "../../studio-bridge";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
const report: ShenronTraining = {
  python_project: "/fixture/training",
  gpu_count: 2,
  candidate_root: "/fixture/candidates",
  rag_promotion: "Promotion vérifiée par le propriétaire RAG.",
};
const services = (changes: Partial<TrainingStudioBackend> = {}): TrainingStudioBackend => ({
  isDesktop: () => true,
  environment: async () => report,
  subscribe: async () => () => {},
  ...changes,
});
let root: Root | undefined;
let container: HTMLDivElement | undefined;
const hasDom = typeof document !== "undefined";
if (hasDom) (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  container?.remove();
  container = undefined;
});
async function mount(backend: TrainingStudioBackend) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(
      createElement<NonNullable<Parameters<typeof TrainingStudio>[0]>>(TrainingStudio, {
        services: backend,
      }),
    ),
  );
}
async function ready(predicate: () => boolean) {
  const deadline = performance.now() + 1500;
  while (!predicate() && performance.now() < deadline)
    // oxlint-disable-next-line no-await-in-loop -- observe dependent React commits.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
    });
  expect(predicate()).toBe(true);
}
test("initial and browser views never fabricate GPU state or expose a process launch", () => {
  const html = renderToStaticMarkup(
    createElement<NonNullable<Parameters<typeof TrainingStudio>[0]>>(TrainingStudio, {
      services: services(),
    }),
  );
  expect(html).toContain("Lecture de l&#x27;environnement");
  expect(html).not.toContain("GPU détectés :");
  expect(html).not.toContain("Lancer l");
  expect(html).not.toContain("<input");
  expect(html).not.toContain("<select");
  const browser = renderToStaticMarkup(
    createElement<NonNullable<Parameters<typeof TrainingStudio>[0]>>(TrainingStudio, {
      services: services({ isDesktop: () => false }),
    }),
  );
  expect(browser).toContain("disponible dans l");
  expect(browser).not.toContain("Lecture");
});
describe.skipIf(!hasDom)("Training Studio real report and event lifecycle", () => {
  test("shows only acknowledged native report and connection status with no launcher", async () => {
    const environment = deferred<ShenronTraining>();
    const subscription = deferred<() => void>();
    await mount(
      services({ environment: () => environment.promise, subscribe: () => subscription.promise }),
    );
    expect(container!.textContent).not.toContain("GPU détectés");
    expect(container!.textContent).toContain("Connexion aux événements");
    await act(async () => environment.resolve(report));
    await ready(() => container!.textContent!.includes("GPU détectés : 2"));
    expect(container!.textContent).toContain("/fixture/candidates");
    expect(container!.textContent).not.toContain("Aucun événement reçu");
    await act(async () => subscription.resolve(() => {}));
    await ready(() => container!.textContent!.includes("Aucun événement reçu depuis"));
    expect(container!.querySelectorAll("input, select, button")).toHaveLength(0);
  });
  test("native report and event failures are visible and retry reconnects both", async () => {
    let reads = 0;
    let subscriptions = 0;
    await mount(
      services({
        environment: async () => {
          if (++reads === 1) throw new Error("rapport natif inaccessible");
          return report;
        },
        subscribe: async () => {
          if (++subscriptions === 1) throw new Error("abonnement natif refusé");
          return () => {};
        },
      }),
    );
    await ready(() => container!.querySelectorAll('[role="alert"]').length === 2);
    expect(container!.textContent).toContain("rapport natif inaccessible");
    expect(container!.textContent).toContain("abonnement natif refusé");
    expect(container!.textContent).not.toContain("GPU détectés");
    expect(container!.textContent).not.toContain("Terminé");
    await act(async () => container!.querySelector("button")!.click());
    await ready(() => container!.textContent!.includes("GPU détectés : 2"));
    expect(reads).toBe(2);
    expect(subscriptions).toBe(2);
    expect(container!.querySelector('[role="alert"]')).toBeNull();
  });
  test("completion appears only when an actual native event arrives", async () => {
    let receive!: (event: TrainEvent) => void;
    await mount(
      services({
        subscribe: async (handler) => {
          receive = handler;
          return () => {};
        },
      }),
    );
    await ready(() => container!.textContent!.includes("Aucun événement reçu"));
    expect(container!.textContent).not.toContain("Terminé");
    await act(async () =>
      receive({ state: "started", kind: "embed", steps: 10, baseModel: "native-model" }),
    );
    expect(container!.textContent).toContain("Démarré : embed, 10 pas, native-model");
    expect(container!.textContent).not.toContain("Terminé");
    await act(async () =>
      receive({ state: "finished", kind: "embed", output: "/fixture/new-candidate" }),
    );
    expect(container!.textContent).toContain("Terminé : embed → /fixture/new-candidate");
    expect(container!.querySelectorAll("button")).toHaveLength(0);
  });
  test("attached native listeners are removed once at unmount", async () => {
    let stops = 0;
    await mount(
      services({
        subscribe: async () => () => {
          stops++;
        },
      }),
    );
    await ready(() => container!.textContent!.includes("Aucun événement reçu"));
    await act(async () => root!.unmount());
    root = undefined;
    expect(stops).toBe(1);
  });
  test("a subscription that resolves after unmount is immediately disposed", async () => {
    const subscription = deferred<() => void>();
    let stops = 0;
    await mount(services({ subscribe: () => subscription.promise }));
    await act(async () => root!.unmount());
    root = undefined;
    await act(async () =>
      subscription.resolve(() => {
        stops++;
      }),
    );
    expect(stops).toBe(1);
    expect(container!.innerHTML).toBe("");
  });
});
