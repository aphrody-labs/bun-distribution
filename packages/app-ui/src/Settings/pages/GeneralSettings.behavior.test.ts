// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, test } from "bun:test";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import {
  GeneralSettings,
  type GeneralSettingsBackend,
} from "./GeneralSettings";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, refuse) => {
    resolve = accept;
    reject = refuse;
  });
  return { promise, resolve, reject };
}
const services = (
  changes: Partial<GeneralSettingsBackend> = {},
): GeneralSettingsBackend => ({
  isDesktop: () => true,
  readAutostart: async () => false,
  writeAutostart: async () => {},
  checkUpdate: async () => null,
  installUpdate: async () => {},
  ...changes,
});
let root: Root | undefined;
let container: HTMLDivElement | undefined;
const hasDom = typeof document !== "undefined";
if (hasDom)
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  container?.remove();
  container = undefined;
});
async function mount(backend: GeneralSettingsBackend) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(
      createElement<NonNullable<Parameters<typeof GeneralSettings>[0]>>(
        GeneralSettings,
        {
          services: backend,
        },
      ),
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
const switchControl = () =>
  container!.querySelector<HTMLButtonElement>('[role="switch"]');
test("browser settings expose no native-only or unsupported controls", () => {
  const html = renderToStaticMarkup(
    createElement<NonNullable<Parameters<typeof GeneralSettings>[0]>>(
      GeneralSettings,
      {
        services: services({ isDesktop: () => false }),
      },
    ),
  );
  expect(html).toContain("application de bureau");
  expect(html).not.toContain('role="switch"');
  expect(html).not.toContain("Vérifier les mises à jour");
  expect(html).not.toContain("Langue de l'interface");
  expect(html).not.toContain("Conserver dans la zone");
  expect(html).not.toContain("Ouvrir avec Aphrody");
});
describe.skipIf(!hasDom)("General settings native acknowledgements", () => {
  test("autostart is unknown until the native state resolves", async () => {
    const state = deferred<boolean>();
    await mount(services({ readAutostart: () => state.promise }));
    expect(switchControl()).toBeNull();
    expect(container!.textContent).toContain("Lecture du démarrage");
    await act(async () => state.resolve(true));
    await ready(() => switchControl() !== null);
    expect(switchControl()!.getAttribute("aria-checked")).toBe("true");
  });
  test("a write and its fresh native read finish before a confirmed change", async () => {
    const write = deferred<void>();
    const verified = deferred<boolean>();
    const calls: string[] = [];
    let reads = 0;
    await mount(
      services({
        readAutostart: () => {
          calls.push("read");
          return ++reads === 1 ? Promise.resolve(false) : verified.promise;
        },
        writeAutostart: (enabled) => {
          calls.push("write:" + enabled);
          return write.promise;
        },
      }),
    );
    await ready(() => switchControl() !== null);
    await act(async () => switchControl()!.click());
    expect(calls).toEqual(["read", "write:true"]);
    expect(switchControl()!.getAttribute("aria-checked")).toBe("false");
    expect(switchControl()!.disabled).toBe(true);
    expect(container!.textContent).not.toContain("automatique activé.");
    await act(async () => write.resolve());
    expect(calls).toEqual(["read", "write:true", "read"]);
    expect(container!.textContent).not.toContain("automatique activé.");
    await act(async () => verified.resolve(true));
    await ready(() => switchControl()!.getAttribute("aria-checked") === "true");
    expect(container!.textContent).toContain("Démarrage automatique activé.");
  });
  test("native failure keeps the previous value and exposes the actual error", async () => {
    const write = deferred<void>();
    await mount(services({ writeAutostart: () => write.promise }));
    await ready(() => switchControl() !== null);
    await act(async () => switchControl()!.click());
    await act(async () =>
      write.reject(new Error("autorisation système refusée")),
    );
    await ready(() => Boolean(container!.querySelector('[role="alert"]')));
    expect(switchControl()!.getAttribute("aria-checked")).toBe("false");
    expect(switchControl()!.disabled).toBe(false);
    expect(container!.querySelector('[role="alert"]')!.textContent).toContain(
      "autorisation système refusée",
    );
    expect(container!.textContent).not.toContain("automatique activé.");
  });
  test("an unverified successful write becomes unknown and can retry the native probe", async () => {
    let reads = 0;
    await mount(
      services({
        readAutostart: async () => {
          if (++reads === 2) throw new Error("état natif inaccessible");
          return reads > 2;
        },
      }),
    );
    await ready(() => switchControl() !== null);
    await act(async () => switchControl()!.click());
    await ready(() => Boolean(container!.querySelector('[role="alert"]')));
    expect(switchControl()).toBeNull();
    expect(container!.textContent).not.toContain("automatique activé.");
    const retry = Array.from(container!.querySelectorAll("button")).find(
      (button) => button.getAttribute("aria-label") === "Réessayer",
    )!;
    await act(async () => retry.click());
    await ready(() => switchControl() !== null);
    expect(reads).toBe(3);
    expect(switchControl()!.getAttribute("aria-checked")).toBe("true");
  });
  test("update failure never reports an up-to-date application", async () => {
    const check = deferred<null>();
    await mount(services({ checkUpdate: () => check.promise }));
    const button = Array.from(container!.querySelectorAll("button")).find(
      (item) => item.textContent!.includes("Vérifier les mises"),
    )!;
    await act(async () => button.click());
    expect(button.disabled).toBe(true);
    expect(container!.textContent).not.toContain("application est à jour");
    await act(async () => check.reject(new Error("release feed unavailable")));
    await ready(() =>
      container!.textContent!.includes("Vérification impossible"),
    );
    expect(button.disabled).toBe(false);
    expect(container!.textContent).not.toContain("application est à jour");
  });
});
