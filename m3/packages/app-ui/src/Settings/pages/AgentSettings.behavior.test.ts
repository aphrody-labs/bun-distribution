// SPDX-License-Identifier: Apache-2.0
// DOM qualification: bun test --preload @aphrody/m3-config/test/dom <this file>.
import { afterEach, describe, expect, test } from "bun:test";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentSettings, type AgentSettingsBackend } from "./AgentSettings";
import {
  DEFAULT_PREFERENCES,
  loadPreferences,
  savePreferences,
  type Preferences,
} from "../../preferences";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, refuse) => {
    resolve = accept;
    reject = refuse;
  });
  return { promise, resolve, reject };
}
const preferences = (): Preferences => ({
  ...DEFAULT_PREFERENCES,
  defaultModel: "native-model",
  trustedFolders: [],
});
const services = (changes: Partial<AgentSettingsBackend> = {}): AgentSettingsBackend => ({
  initialize: async () => {},
  models: async () => ({
    data: [
      { id: "native-model", displayName: "Modèle natif", provider: "local" },
      { id: "remote-model", displayName: "Modèle distant", provider: "remote" },
    ],
  }),
  preferences: async () => preferences(),
  save: async (partial) => ({ ...preferences(), ...partial }),
  saveDefaultModel: async () => {},
  chooseDirectory: async () => null,
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
async function mount(backend: AgentSettingsBackend) {
  const success: string[] = [];
  const error: string[] = [];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(
      createElement<NonNullable<Parameters<typeof AgentSettings>[0]>>(AgentSettings, {
        services: backend,
        notify: {
          success: (message) => {
            success.push(String(message));
            return "fixture";
          },
          error: (message) => {
            error.push(String(message));
            return "fixture";
          },
        },
      }),
    ),
  );
  return { success, error };
}
async function ready(predicate: () => boolean) {
  const deadline = performance.now() + 1500;
  while (!predicate() && performance.now() < deadline)
    // oxlint-disable-next-line no-await-in-loop -- observe dependent React commits until ready.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
    });
  expect(predicate()).toBe(true);
}
async function openModels() {
  const trigger = document.querySelector<HTMLButtonElement>(
    'button[aria-label="Modèle par défaut"]',
  )!;
  await act(async () => trigger.click());
  await ready(() => document.querySelectorAll('[role="menuitemradio"]').length === 2);
  return Array.from(document.querySelectorAll<HTMLElement>('[role="menuitemradio"]'));
}

test("the initial view never presents fabricated loaded settings or dead actions", () => {
  const html = renderToStaticMarkup(createElement(AgentSettings));
  expect(html).toContain("Chargement des préférences");
  expect(html).not.toContain("gpt-6");
  expect(html).not.toContain("gemini-3.8");
  expect(html).not.toContain("qwen-30b");
  expect(html).not.toContain("Binaire de");
  expect(html).not.toContain("Indexer un dossier");
});

describe.skipIf(!hasDom)("Agent settings persistence and native catalog", () => {
  test("controls wait for preferences and initialized real-catalog response", async () => {
    const stored = deferred<Preferences>();
    const initialized = deferred<void>();
    const catalog = deferred<Record<string, unknown>>();
    let modelCalls = 0;
    await mount(
      services({
        preferences: () => stored.promise,
        initialize: () => initialized.promise,
        models: () => {
          modelCalls++;
          return catalog.promise;
        },
      }),
    );
    expect(container!.querySelector("select")).toBeNull();
    expect(container!.textContent).toContain("Chargement");
    await act(async () => stored.resolve(preferences()));
    expect(modelCalls).toBe(0);
    await act(async () => initialized.resolve());
    expect(modelCalls).toBe(1);
    expect(container!.querySelector("select")).toBeNull();
    await act(async () => catalog.resolve({ data: [] }));
    await ready(() => container!.textContent!.includes("Aucun modèle disponible"));
    expect(container!.querySelector('button[aria-label="Modèle par défaut"]')).toBeNull();
  });

  test("only returned models are offered and both writes finish before success", async () => {
    const persisted = deferred<Preferences>();
    const modelSetting = deferred<void>();
    const calls: string[] = [];
    const notices = await mount(
      services({
        save: (partial) => {
          calls.push("preferences:" + partial.defaultModel);
          return persisted.promise;
        },
        saveDefaultModel: (model) => {
          calls.push("model:" + model);
          return modelSetting.promise;
        },
      }),
    );
    await ready(() => Boolean(container!.querySelector('button[aria-label="Modèle par défaut"]')));
    const items = await openModels();
    expect(
      items.map((item) => {
        const label = item.cloneNode(true) as HTMLElement;
        for (const hidden of label.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
        return label.textContent!.trim();
      }),
    ).toEqual(["Modèle natif", "Modèle distant"]);
    await act(async () => items[1]!.click());
    expect(calls).toEqual(["preferences:remote-model"]);
    expect(notices.success).toEqual([]);
    await act(async () => persisted.resolve({ ...preferences(), defaultModel: "remote-model" }));
    expect(calls).toEqual(["preferences:remote-model", "model:remote-model"]);
    expect(notices.success).toEqual([]);
    expect(
      container!.querySelector('button[aria-label="Modèle par défaut"]')!.textContent,
    ).toContain("Modèle natif");
    await act(async () => modelSetting.resolve());
    await ready(() => notices.success.length === 1);
    expect(
      container!.querySelector('button[aria-label="Modèle par défaut"]')!.textContent,
    ).toContain("Modèle distant");
    expect(notices.error).toEqual([]);
  });

  test("a rejected save retains the previous selection and reports an actual failure", async () => {
    const persisted = deferred<Preferences>();
    const notices = await mount(services({ save: () => persisted.promise }));
    await ready(() =>
      Boolean(container!.querySelector('select[aria-label="Effort de raisonnement"]')),
    );
    const select = container!.querySelector<HTMLSelectElement>(
      'select[aria-label="Effort de raisonnement"]',
    )!;
    await act(async () => {
      select.value = "high";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(select.disabled).toBe(true);
    expect(notices.success).toEqual([]);
    await act(async () => persisted.reject(new Error("fixture write denied")));
    await ready(() => notices.error.length === 1);
    expect(select.value).toBe("medium");
    expect(select.disabled).toBe(false);
    expect(container!.querySelector('[role="alert"]')!.textContent).toContain(
      "Enregistrement impossible",
    );
    expect(notices.success).toEqual([]);
  });

  test("a failed catalog displays a retry action and no loaded controls", async () => {
    let calls = 0;
    await mount(
      services({
        models: async () => {
          if (++calls === 1) throw new Error("fixture catalog unavailable");
          return { data: [] };
        },
      }),
    );
    await ready(() => Boolean(container!.querySelector('[role="alert"]')));
    expect(container!.querySelector("select")).toBeNull();
    const retry = Array.from(container!.querySelectorAll("button")).find(
      (button) => button.getAttribute("aria-label") === "Réessayer",
    )!;
    await act(async () => retry.click());
    await ready(() => container!.textContent!.includes("Aucun modèle disponible"));
    expect(calls).toBe(2);
  });

  test("failed persistent writes never publish unflushed preferences to the cache", async () => {
    const original = loadPreferences();
    await savePreferences(preferences());
    const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage")!;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: () => null,
        setItem: () => {
          throw new Error("fixture store unavailable");
        },
      },
    });
    try {
      await expect(
        savePreferences({ ...preferences(), defaultModel: "unflushed-model" }),
      ).rejects.toThrow("fixture store unavailable");
      expect(loadPreferences().defaultModel).toBe("native-model");
    } finally {
      Object.defineProperty(globalThis, "localStorage", storageDescriptor);
      await savePreferences(original);
    }
  });
});
