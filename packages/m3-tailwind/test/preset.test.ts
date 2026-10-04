// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { compile } from "@tailwindcss/node";
import { ROLES } from "@aphrody/m3-tokens/dynamic-color";
import { presetCss, themeCss } from "../src/index.ts";

describe("m3-tailwind preset", () => {
  test("preset.css is up to date with the generator", () => {
    expect(readFileSync(new URL("../preset.css", import.meta.url), "utf8")).toBe(presetCss());
  });

  test("maps every colour role from m3-tokens", () => {
    const css = themeCss();
    for (const r of ROLES) {
      const k = r.replace(/([A-Z])/g, "-$1").toLowerCase();
      expect(css).toContain(`--color-${k}: var(--md-sys-color-${k});`);
    }
  });

  test("covers shape, emphasized type, easing and elevation", () => {
    const css = themeCss({ keepUnused: true });
    expect(css.startsWith("@theme static {")).toBe(true);
    expect(css).toContain("--radius-extra-large: var(--md-sys-shape-corner-extra-large);");
    expect(css).toContain(
      "--text-label-small-emphasized--font-weight: var(--md-sys-typescale-label-small-emphasized-weight);",
    );
    expect(css).toContain("--ease-emphasized: var(--md-sys-motion-easing-emphasized);");
    expect(css).toContain("--shadow-elevation-3: var(--md-sys-elevation-level3);");
  });

  test("Tailwind v4 compiles utilities against the theme", async () => {
    const compiler = await compile(`@tailwind utilities;\n${themeCss()}`, {
      base: process.cwd(),
      onDependency: () => {},
    });
    const out = compiler.build([
      "bg-primary",
      "text-on-surface",
      "rounded-large",
      "text-body-large",
      "ease-emphasized",
    ]);
    expect(out).toContain("var(--md-sys-color-primary)");
    expect(out).toContain("var(--md-sys-color-on-surface)");
    expect(out).toContain("var(--md-sys-shape-corner-large)");
    expect(out).toContain("var(--md-sys-typescale-body-large-size)");
    expect(out).toContain("var(--md-sys-motion-easing-emphasized)");
  });
});
