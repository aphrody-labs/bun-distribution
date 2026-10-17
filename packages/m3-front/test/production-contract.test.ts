// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, test } from "bun:test";
import { schemeFromSeed } from "@aphrody/m3-tokens/dynamic-color";
import { defineM3Theme, M3ThemeElement, observeWindowClass, registerM3 } from "../src/index.ts";

const originalMatchMedia = window.matchMedia;
afterEach(() => {
  document.body.replaceChildren();
  window.matchMedia = originalMatchMedia;
});

function colorPreference(dark = false) {
  const listeners = new Set<() => void>();
  const media = {
    matches: dark,
    addEventListener(_type: string, listener: () => void) {
      listeners.add(listener);
    },
    removeEventListener(_type: string, listener: () => void) {
      listeners.delete(listener);
    },
  };
  window.matchMedia = () => media as unknown as MediaQueryList;
  return {
    listeners,
    change(value: boolean) {
      media.matches = value;
      for (const listener of listeners) listener();
    },
  };
}

describe("front production contract", () => {
  test("imports all public front helpers in a server without DOM globals", async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        "-e",
        'const front = await import("@aphrody/m3-front"); front.defineM3Theme(); console.log(front.windowClassFor(600, 480).width);',
      ],
      {
        windowsHide: true,
        cwd: Bun.fileURLToPath(new URL("..", import.meta.url)),
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(stdout.trim()).toBe("medium");
  });

  test("registers independent custom tag aliases idempotently", () => {
    defineM3Theme("m3-custom-theme");
    const ctor = customElements.get("m3-custom-theme");
    defineM3Theme("m3-custom-theme");
    expect(customElements.get("m3-custom-theme")).toBe(ctor);
    const element = document.createElement("m3-custom-theme");
    expect(element).toBeInstanceOf(M3ThemeElement);
    document.body.append(element);
    expect(element.style.getPropertyValue("--md-sys-color-primary")).toMatch(/^#[0-9a-f]{6}$/);
  });

  test("reacts to contrast and variant and announces complete roles across shadow boundaries", () => {
    colorPreference();
    const host = document.createElement("div");
    document.body.append(host);
    const shadow = host.attachShadow({ mode: "open" });
    const element = document.createElement("m3-theme") as M3ThemeElement;
    element.dir = "rtl";
    const changes: Array<{ variant: string; contrastLevel: number }> = [];
    const onChange = (event: Event) => changes.push((event as CustomEvent).detail);
    document.addEventListener("m3-theme-change", onChange);
    try {
      shadow.append(element);
      element.variant = "fidelity";
      element.contrast = 1;
      const roles = schemeFromSeed(element.seed, {
        variant: "fidelity",
        contrastLevel: 1,
      });
      for (const [role, value] of Object.entries(roles)) {
        expect(element.style.getPropertyValue(role)).toBe(value);
      }
      expect(element.dir).toBe("rtl");
      expect(changes.at(-1)).toMatchObject({
        variant: "fidelity",
        contrastLevel: 1,
      });
    } finally {
      document.removeEventListener("m3-theme-change", onChange);
    }
  });

  test("only auto mode follows system changes and reconnects with one live subscription", () => {
    const preference = colorPreference();
    const element = document.createElement("m3-theme") as M3ThemeElement;
    let events = 0;
    element.addEventListener("m3-theme-change", () => events++);
    document.body.append(element);
    expect(preference.listeners.size).toBe(1);
    preference.change(true);
    expect(element.resolvedMode).toBe("dark");
    element.mode = "light";
    const beforeChange = events;
    preference.change(false);
    expect(events).toBe(beforeChange);
    element.mode = "auto";
    element.remove();
    expect(preference.listeners.size).toBe(0);
    expect(element.style.getPropertyValue("--md-sys-color-primary")).toBe("");
    expect(element.style.getPropertyValue("color-scheme")).toBe("");
    expect(element.dataset["resolvedMode"]).toBeUndefined();
    document.body.append(element);
    expect(preference.listeners.size).toBe(1);
    preference.change(true);
    expect(element.dataset["resolvedMode"]).toBe("dark");
  });

  test("rejects invalid contrast atomically instead of silently resetting it", () => {
    const element = document.createElement("m3-theme") as M3ThemeElement;
    document.body.append(element);
    const style = element.style.cssText;
    let events = 0;
    element.addEventListener("m3-theme-change", () => events++);
    expect(() => element.setAttribute("contrast", "invalid")).toThrow("contrast");
    expect(element.style.cssText).toBe(style);
    expect(events).toBe(0);
    element.contrast = 0.5;
    expect(element.contrast).toBe(0.5);
    expect(events).toBe(1);
  });

  test("adaptive observation publishes changes once and removes its exact listener", () => {
    const target = document.createElement("div");
    let width = 599;
    let resize: (() => void) | undefined;
    let removed: (() => void) | undefined;
    const win = {
      get innerWidth() {
        return width;
      },
      innerHeight: 900,
      addEventListener(_type: string, listener: () => void) {
        resize = listener;
      },
      removeEventListener(_type: string, listener: () => void) {
        removed = listener;
      },
    };
    const states: string[] = [];
    const dispose = observeWindowClass(state => states.push(state.width), target, win as unknown as Window);
    width = 600;
    resize?.();
    resize?.();
    width = 840;
    resize?.();
    expect(states).toEqual(["compact", "medium", "expanded"]);
    expect(target.dataset["m3Nav"]).toBe("rail-collapsed");
    dispose();
    expect(removed).toBe(resize);
  });

  test("rejects prototype names as catalog keys", async () => {
    await expect(registerM3("__proto__" as "all")).rejects.toThrow("invalid M3 catalog");
    await expect(registerM3("constructor" as "all")).rejects.toThrow("invalid M3 catalog");
  });
});
