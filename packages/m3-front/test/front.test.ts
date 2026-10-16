// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import {
  M3ThemeElement,
  observeWindowClass,
  registerM3Component,
  windowClassFor,
} from "../src/index.ts";

describe("<m3-theme>", () => {
  test("is registered and scopes the colour roles to its subtree", () => {
    expect(customElements.get("m3-theme")).toBe(M3ThemeElement);
    const el = document.createElement("m3-theme") as M3ThemeElement;
    el.setAttribute("seed", "#6750a4");
    el.setAttribute("mode", "light");
    document.body.append(el);
    expect(el.style.getPropertyValue("--md-sys-color-primary")).toMatch(
      /^#[0-9a-f]{6}$/,
    );
    expect(el.dataset["resolvedMode"]).toBe("light");
    const lightSurface = el.style.getPropertyValue("--md-sys-color-surface");
    el.mode = "dark";
    expect(el.dataset["resolvedMode"]).toBe("dark");
    expect(el.style.getPropertyValue("--md-sys-color-surface")).not.toBe(
      lightSurface,
    );
    expect(
      document.documentElement.style.getPropertyValue("--md-sys-color-primary"),
    ).toBe("");
    el.remove();
    expect(el.style.getPropertyValue("--md-sys-color-primary")).toBe("");
  });

  test("emits m3-theme-change", () => {
    const el = document.createElement("m3-theme") as M3ThemeElement;
    let seen = 0;
    el.addEventListener("m3-theme-change", () => seen++);
    document.body.append(el);
    el.seed = "#336699";
    expect(seen).toBeGreaterThanOrEqual(2);
    el.remove();
  });
});

describe("window classes", () => {
  test("classifies width and height", () => {
    expect(windowClassFor(500, 400)).toEqual({
      width: "compact",
      height: "compact",
      navigation: "bar",
      panes: 1,
    });
    expect(windowClassFor(1300, 950)).toEqual({
      width: "large",
      height: "expanded",
      navigation: "rail-expanded",
      panes: 2,
    });
  });

  test("mirrors classes on the target and disposes", () => {
    const target = document.createElement("div");
    const seen: string[] = [];
    const dispose = observeWindowClass((s) => seen.push(s.width), target, {
      innerWidth: 700,
      innerHeight: 500,
      addEventListener() {},
      removeEventListener() {},
    } as unknown as Window);
    expect(target.dataset["m3Width"]).toBe("medium");
    expect(target.dataset["m3Height"]).toBe("medium");
    expect(target.dataset["m3Nav"]).toBe("rail-collapsed");
    expect(seen).toEqual(["medium"]);
    dispose();
  });
});

describe("registration", () => {
  test("rejects unsafe component paths", async () => {
    await expect(registerM3Component("../evil")).rejects.toThrow(
      "invalid component path",
    );
  });
});
