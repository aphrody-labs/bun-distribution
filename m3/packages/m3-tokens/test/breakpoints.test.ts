import { describe, expect, test } from "bun:test";
import {
  BREAKPOINTS,
  classifyWidth,
  marginFor,
  mediaQuery,
  navigationFor,
  panesFor,
  classifyHeight,
  HEIGHT_BREAKPOINTS,
  heightMediaQuery,
  breakpointsCss,
} from "../src/breakpoints.js";

describe("M3 breakpoints", () => {
  test.each([
    [599, "compact"],
    [600, "medium"],
    [840, "expanded"],
    [1200, "large"],
    [1600, "extra-large"],
  ] as const)("classifyWidth(%i) === %s", (w, c) => expect(classifyWidth(w)).toBe(c));

  test("canonical lower bounds", () =>
    expect([
      BREAKPOINTS.medium,
      BREAKPOINTS.expanded,
      BREAKPOINTS.large,
      BREAKPOINTS["extra-large"],
    ]).toEqual([600, 840, 1200, 1600]));

  test("margins 16/24", () => {
    expect(marginFor("compact")).toBe(16);
    expect(marginFor("expanded")).toBe(24);
  });

  test("adaptive navigation per class", () => {
    expect(navigationFor("compact")).toBe("bar");
    expect(navigationFor("medium")).toBe("rail-collapsed");
    expect(navigationFor("large")).toBe("rail-expanded");
  });

  test("pane counts 1/1/2/2/3", () =>
    expect(
      ["compact", "medium", "expanded", "large", "extra-large"].map((c) => panesFor(c as never)),
    ).toEqual([1, 1, 2, 2, 3]));

  test("mediaQuery + breakpointsCss", () => {
    expect(mediaQuery("expanded")).toBe("(min-width: 840px)");
    const css = breakpointsCss();
    expect(css).toContain("@custom-media --md-expanded (min-width: 840px)");
    expect(css).toContain("--md-breakpoint-large: 1200px");
  });
});

describe("M3 window height classes", () => {
  test.each([
    [479, "compact"],
    [480, "medium"],
    [899, "medium"],
    [900, "expanded"],
  ] as const)("classifyHeight(%i) === %s", (h, c) => expect(classifyHeight(h)).toBe(c));

  test("css carries the height breakpoints", async () => {
    expect(HEIGHT_BREAKPOINTS).toEqual({ compact: 0, medium: 480, expanded: 900 });
    expect(heightMediaQuery("medium")).toBe("(min-height: 480px)");
    const css = breakpointsCss();
    expect(css).toContain("@custom-media --md-height-expanded (min-height: 900px)");
    expect(css).toContain("--md-breakpoint-height-medium: 480px");
    const file = await Bun.file(new URL("../src/breakpoints.css", import.meta.url)).text();
    expect(file).toContain("@custom-media --md-height-medium (min-height: 480px)");
    expect(file).toContain("--md-breakpoint-height-expanded: 900px");
  });

  test("navigation kinds match adaptive.rs", () => {
    expect([navigationFor("compact"), navigationFor("expanded"), navigationFor("large")]).toEqual([
      "bar",
      "rail-collapsed",
      "rail-expanded",
    ]);
  });
});
