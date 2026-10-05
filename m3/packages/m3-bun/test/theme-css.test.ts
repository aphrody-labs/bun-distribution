// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { schemeVariant, tsM3Css } from "../src/theme-css.ts";

describe("tsM3Css", () => {
  test("tokens: static token CSS plus light and dark colour roles of the seed", () => {
    const css = tsM3Css({ sheet: "tokens", seed: "#6750a4" });
    expect(css).toContain("--md-sys-shape-corner-medium: 12px");
    expect(css).toContain("--md-sys-color-primary: #65558f");
    expect(css).toContain("@media (prefers-color-scheme: dark)");
    expect(css).toContain(':root[data-theme="dark"]');
  });
  test("scheme: one mode, so dark differs from light", () => {
    const light = tsM3Css({ sheet: "scheme", seed: "#6750a4" });
    const dark = tsM3Css({ sheet: "scheme", seed: "#6750a4", dark: true });
    expect(light).toContain("--md-sys-color-primary: #65558f");
    expect(dark).toContain("--md-sys-color-primary: #cfbdfe");
    expect(light).not.toBe(dark);
  });
  test("seed, variant and contrast change the roles", () => {
    const base = tsM3Css({ sheet: "scheme", seed: "#6750a4" });
    expect(tsM3Css({ sheet: "scheme", seed: "#00897b" })).not.toBe(base);
    expect(tsM3Css({ sheet: "scheme", seed: "#6750a4", variant: "vibrant" })).not.toBe(base);
    expect(tsM3Css({ sheet: "scheme", seed: "#6750a4", contrast: 1 })).not.toBe(base);
  });
  test("the Rust-only sheets say what to use instead", () => {
    expect(() => tsM3Css({ sheet: "tailwind" })).toThrow(/m3-tailwind\/preset\.css/);
    expect(() => tsM3Css({ sheet: "spaceui" })).toThrow(/needs the Rust m3Css/);
  });
  test("schemeVariant accepts camelCase and kebab-case and rejects the rest", () => {
    expect(schemeVariant(undefined)).toBe("tonalSpot");
    expect(schemeVariant("tonal-spot")).toBe("tonalSpot");
    expect(schemeVariant("tonalSpot")).toBe("tonalSpot");
    expect(schemeVariant("monochrome")).toBe("monochrome");
    expect(() => schemeVariant("rainbow")).toThrow(/unknown scheme variant/);
  });
});
