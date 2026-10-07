// SPDX-License-Identifier: Apache-2.0
// oxlint-disable-next-line no-unassigned-import -- register the existing DOM owner before real React components
import "../../../../scripts/test-dom";
import { afterEach, expect, test } from "bun:test";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import {
  DEFAULT_PREFERENCES,
  loadPreferences,
  savePreferences,
  type Preferences,
} from "./preferences";

const { QuickBar } = await import("./quickbar");
const { CommandPalette } = await import("./CommandPalette");
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | undefined;
let host: HTMLDivElement | undefined;
let restore: (() => Promise<void>) | undefined;
let calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
let failStore = false;
let failRelay = false;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
  await restore?.();
  restore = undefined;
});

async function fixture() {
  calls = [];
  failStore = false;
  failRelay = false;
  const before = loadPreferences();
  const descriptors = ["__TAURI__", "__TAURI_INTERNALS__"].map((key) => ({
    key,
    descriptor: Object.getOwnPropertyDescriptor(window, key),
  }));
  const clipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  const background = [document.body.style.background, document.documentElement.style.background];
  const preferences: Preferences = {
    ...DEFAULT_PREFERENCES,
    onboarded: true,
    theme: "dark",
    sources: { history: false, calculator: true, navigation: true, commands: true, files: true },
  };
  const invoke = async (command: string, args?: Record<string, unknown>) => {
    calls.push({ command, args });
    if (command === "plugin:store|load") return 1;
    if (command === "plugin:store|get") return [preferences, true];
    if (command === "plugin:store|set") return null;
    if (command === "plugin:store|save") {
      if (failStore) throw new Error("Fixture: storage refused");
      return null;
    }
    if (command === "plugin:event|emit_to") {
      if (failRelay) throw new Error("Fixture: main window unavailable");
      return null;
    }
    if (command === "aphrody_quickbar") return null;
    throw new Error("Unexpected native command; inference forbidden: " + command);
  };
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: { invoke, transformCallback: () => 1 },
  });
  Object.defineProperty(window, "__TAURI__", { configurable: true, value: { core: { invoke } } });
  await savePreferences(preferences);
  calls = [];
  restore = async () => {
    failStore = false;
    await savePreferences(before);
    for (const { key, descriptor } of descriptors) {
      if (descriptor) Object.defineProperty(window, key, descriptor);
      else Reflect.deleteProperty(window, key);
    }
    if (clipboard) Object.defineProperty(navigator, "clipboard", clipboard);
    else Reflect.deleteProperty(navigator, "clipboard");
    [document.body.style.background, document.documentElement.style.background] = background;
  };
}

async function mount(component: ReturnType<typeof createElement>) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(component);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function input() {
  const found = host?.querySelector<HTMLInputElement>('input[role="combobox"]');
  if (!found) throw new Error("Missing command input");
  return found;
}

async function type(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function choose(label: string) {
  const option = [...(host?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])].find((node) =>
    node.textContent?.includes(label),
  );
  if (!option) throw new Error("Missing action " + label);
  await act(async () => {
    option.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    option.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function Palette() {
  const [open, setOpen] = useState(true);
  const location = useLocation();
  return createElement(
    "div",
    {},
    <CommandPalette open={open} onOpenChange={setOpen} />,
    createElement(
      "output",
      { id: "destination" },
      JSON.stringify({ pathname: location.pathname, state: location.state }),
    ),
  );
}

test("QuickBar relays each visible menu action to its actual main-window listener before opening main", async () => {
  await fixture();
  await mount(createElement(QuickBar));
  for (const [label, event] of [
    ["> new", "aphrody://menu/new-session"],
    ["> open-folder", "aphrody://menu/open-folder"],
    ["> open", "aphrody://menu/open-file"],
  ]) {
    calls = [];
    // eslint-disable-next-line no-await-in-loop -- These actions share one mounted QuickBar and must finish in order.
    await type(label);
    // eslint-disable-next-line no-await-in-loop -- Wait for the native relay before changing the shared input.
    await choose(label);
    expect(calls).toEqual([
      {
        command: "plugin:event|emit_to",
        args: { target: { kind: "AnyLabel", label: "main" }, event, payload: undefined },
      },
      { command: "aphrody_quickbar", args: { action: { action: "open_main" } } },
    ]);
  }
});

test("QuickBar hides nonrelayable navigation and keeps command failures visible without asking the agent", async () => {
  await fixture();
  await mount(createElement(QuickBar));
  await type("> settings");
  expect(host?.querySelector('[role="option"]')).toBeNull();
  calls = [];
  await act(async () =>
    input().form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(host?.querySelector('[role="alert"]')?.textContent).toContain("pas disponible");
  expect(calls).toEqual([]);
  failRelay = true;
  await type("> new");
  await choose("> new");
  expect(host?.querySelector('[role="alert"]')?.textContent).toContain("main window unavailable");
  expect(calls.some((call) => call.command === "aphrody_quickbar")).toBe(false);
});

test("QuickBar theme changes wait for storage and expose a rejected persistence operation", async () => {
  await fixture();
  await mount(createElement(QuickBar));
  failStore = true;
  await type("> theme");
  await choose("> theme");
  expect(host?.querySelector('[role="alert"]')?.textContent).toContain("storage refused");
  expect(loadPreferences().theme).toBe("dark");
  failStore = false;
  await choose("> theme");
  expect(loadPreferences().theme).toBe("light");
});

test("Palette Enter transfers the exact question to the composer without sending it", async () => {
  await fixture();
  await mount(createElement(MemoryRouter, {}, createElement(Palette)));
  const question = "  Pourquoi Ω change dans mon document ?  ";
  await type(question);
  expect(host?.textContent).toContain("ouvrir ce texte dans le chat");
  calls = [];
  await act(async () =>
    input().dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    ),
  );
  expect(JSON.parse(host?.querySelector("#destination")?.textContent ?? "{}")).toEqual({
    pathname: "/chat",
    state: { initialPrompt: question },
  });
  expect(host?.querySelector('[role="dialog"]')).toBeNull();
  expect(calls).toEqual([]);
});

test("Palette clipboard and theme failures retain the dialog and expose the owner error", async () => {
  await fixture();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async () => {
        throw new Error("Fixture: clipboard refused");
      },
    },
  });
  await mount(createElement(MemoryRouter, {}, createElement(Palette)));
  await type("2 + 2");
  await choose("2 + 2");
  expect(host?.querySelector('[role="dialog"]')).not.toBeNull();
  expect(host?.querySelector('[role="alert"]')?.textContent).toContain("clipboard refused");
  failStore = true;
  await type("> theme");
  await choose("> theme");
  expect(host?.querySelector('[role="dialog"]')).not.toBeNull();
  expect(host?.querySelector('[role="alert"]')?.textContent).toContain("storage refused");
  expect(loadPreferences().theme).toBe("dark");
});
