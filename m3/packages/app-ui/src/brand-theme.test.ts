// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { schemeFromSeed } from "@aphrody/m3-tokens/dynamic-color";
import { PET_COLORS } from "@aphrody/identity/pet";
import {
  BRAND_SEED,
  READING_COLUMN,
  SHAPE,
  SPRING_NAMES,
  TITLE_GRADIENT_STOPS,
  WEIGHTS,
  brandCss,
  springDurationMs,
  springLinear,
  springsFromTokensCss,
} from "./brand-theme";

const tokensCss = await Bun.file(
  Bun.fileURLToPath(import.meta.resolve("@aphrody/m3-tokens/m3-tokens.css")),
).text();

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const l = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * l[0]! + 0.7152 * l[1]! + 0.0722 * l[2]!;
}
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].toSorted((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}

describe("brand theme", () => {
  test("src/brand.css is the generated sheet for the pet seed", async () => {
    const onDisk = await Bun.file(new URL("./brand.css", import.meta.url)).text();
    expect(onDisk).toBe(brandCss(tokensCss, BRAND_SEED));
  });

  test("brand values use the canonical pet palette and semantic gradient roles", () => {
    expect(BRAND_SEED).toBe(PET_COLORS.seed);
    expect(TITLE_GRADIENT_STOPS).toEqual([
      "var(--md-sys-color-primary)",
      "var(--md-sys-color-secondary)",
      "var(--md-sys-color-tertiary)",
    ]);
    expect(SHAPE).toEqual({
      promptEmpty: "40px",
      promptContent: "32px",
      promptDocked: "24px 24px 0 0",
      chip: "16px",
    });
    expect(READING_COLUMN).toBe(760);
    expect(WEIGHTS).toEqual({ display: 280, headline: 350, body: 400, bodyStrong: 500 });
  });

  test("colour roles are generated tonal-spot roles, not hand-copied", () => {
    const css = brandCss(tokensCss);
    const dark = schemeFromSeed(BRAND_SEED, { dark: true });
    const light = schemeFromSeed(BRAND_SEED, { dark: false });
    const lightBlock = css.slice(
      css.indexOf(":root.light,\n.light {"),
      css.indexOf(":root,\n.dark {"),
    );
    const darkBlock = css.slice(
      css.indexOf(":root,\n.dark {"),
      css.indexOf("/* Exact Aphrody pet"),
    );
    expect(lightBlock).toContain("color-scheme: light;");
    expect(darkBlock).toContain("color-scheme: dark;");
    for (const [role, hex] of Object.entries(light))
      expect(lightBlock).toContain(`${role}: ${hex};`);
    for (const [role, hex] of Object.entries(dark)) expect(darkBlock).toContain(`${role}: ${hex};`);
  });

  test("pet-generated surfaces retain AA contrast with no later colour overrides", () => {
    const css = brandCss(tokensCss);
    expect(css.match(/--md-sys-color-surface:/g)).toHaveLength(2);
    expect(css.match(/--md-sys-color-background:/g)).toHaveLength(2);
    const light = schemeFromSeed(BRAND_SEED, { dark: false }) as Record<string, string>;
    const dark = schemeFromSeed(BRAND_SEED, { dark: true }) as Record<string, string>;
    for (const role of [
      "--md-sys-color-on-surface",
      "--md-sys-color-on-surface-variant",
      "--md-sys-color-primary",
    ]) {
      expect(contrast(light[role]!, light["--md-sys-color-surface"]!)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(dark[role]!, dark["--md-sys-color-surface"]!)).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("springs come from m3-tokens.css and render as settling linear() easings", () => {
    const springs = springsFromTokensCss(tokensCss);
    expect(springs["default-spatial"]).toEqual({ damping: 0.9, stiffness: 700 });
    expect(springs["fast-effects"]).toEqual({ damping: 1, stiffness: 3800 });
    const css = brandCss(tokensCss);
    for (const name of SPRING_NAMES) {
      const s = springs[name];
      const easing = springLinear(s);
      expect(easing.startsWith("linear(0, ")).toBe(true);
      expect(easing.endsWith(", 1)")).toBe(true);
      expect(css).toContain(`--app-motion-spring-${name}: ${easing};`);
      expect(css).toContain(`--app-motion-spring-${name}-duration: ${springDurationMs(s)}ms;`);
    }
    expect(springDurationMs(springs["default-spatial"])).toBe(325);
    expect(springDurationMs(springs["fast-effects"])).toBe(150);
  });

  test("app.css layers the brand sheet over the SpaceUI palette", async () => {
    const appCss = await Bun.file(new URL("./app.css", import.meta.url)).text();
    const spaceui = appCss.indexOf('@import "@aphrody/m3-theme/spaceui.css"');
    const brand = appCss.indexOf('@import "./brand.css"');
    expect(spaceui).toBeGreaterThanOrEqual(0);
    expect(brand).toBeGreaterThan(spaceui);
  });
});
