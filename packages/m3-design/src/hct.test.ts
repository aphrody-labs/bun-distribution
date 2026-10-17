// SPDX-License-Identifier: Apache-2.0
import { expect, test, describe } from "bun:test";
import { generateTheme } from "./hct.ts";
import { argbFromHex, hexFromArgb, Scheme } from "@material/material-color-utilities";

describe("HCT palette and CSS variables compiler", () => {
  test("should generate correct tone steps for seed color", () => {
    const theme = generateTheme("#CE422B");
    expect(theme.seed).toBe("#CE422B");

    // Check that tone steps are present
    const toneSteps = [0, 6, 10, 12, 20, 22, 30, 40, 50, 60, 70, 80, 90, 94, 95, 98, 99, 100];
    for (const step of toneSteps) {
      expect(theme.palettes.primary.tones[step]).toBeDefined();
      expect(theme.palettes.secondary.tones[step]).toBeDefined();
      expect(theme.palettes.tertiary.tones[step]).toBeDefined();
      expect(theme.palettes.neutral.tones[step]).toBeDefined();
      expect(theme.palettes.neutralVariant.tones[step]).toBeDefined();
      expect(theme.palettes.error.tones[step]).toBeDefined();
    }

    expect(theme.palettes.primary.tones[100]).toBe("#FFFFFF");
    expect(theme.palettes.primary.tones[0]).toBe("#000000");

    // Check that CSS Custom properties are exported
    expect(theme.cssCustomProperties).toContain("--md-ref-palette-primary-40");
    expect(theme.cssCustomProperties).toContain("--md-sys-color-primary");
    expect(theme.cssCustomProperties).toContain("@media (prefers-color-scheme: dark)");
  });

  test("should verify light mode system tokens generation", () => {
    const theme = generateTheme("#CE422B");
    const css = theme.cssCustomProperties;

    expect(css).toContain("/* System Tokens - Light Mode */");
    expect(css).toContain("--md-sys-color-primary: var(--md-ref-palette-primary-40);");
    expect(css).toContain("--md-sys-color-on-primary: var(--md-ref-palette-primary-100);");
    expect(css).toContain("--md-sys-color-primary-container: var(--md-ref-palette-primary-90);");
    expect(css).toContain("--md-sys-color-on-primary-container: var(--md-ref-palette-primary-10);");
    expect(css).toContain("--md-sys-color-surface: var(--md-ref-palette-neutral-98);");
    expect(css).toContain("--md-sys-color-on-surface: var(--md-ref-palette-neutral-10);");
    expect(css).toContain("--md-sys-color-outline: var(--md-ref-palette-neutral-variant-50);");
  });

  test("should verify dark mode system tokens overrides", () => {
    const theme = generateTheme("#CE422B");
    const css = theme.cssCustomProperties;

    // Dark mode block check
    expect(css).toContain("@media (prefers-color-scheme: dark)");
    // Split the CSS to check declarations within the dark media query block
    const parts = css.split("@media (prefers-color-scheme: dark) {");
    expect(parts.length).toBe(2);
    const darkBlock = parts[1];

    expect(darkBlock).toContain("--md-sys-color-primary: var(--md-ref-palette-primary-80);");
    expect(darkBlock).toContain("--md-sys-color-on-primary: var(--md-ref-palette-primary-20);");
    expect(darkBlock).toContain("--md-sys-color-primary-container: var(--md-ref-palette-primary-30);");
    expect(darkBlock).toContain("--md-sys-color-on-primary-container: var(--md-ref-palette-primary-90);");
    expect(darkBlock).toContain("--md-sys-color-surface: var(--md-ref-palette-neutral-6);");
    expect(darkBlock).toContain("--md-sys-color-on-surface: var(--md-ref-palette-neutral-90);");
    expect(darkBlock).toContain("--md-sys-color-outline: var(--md-ref-palette-neutral-variant-60);");
  });

  test("should generate distinct themes for different seeds", () => {
    const redTheme = generateTheme("#CE422B");
    const blueTheme = generateTheme("#0F52BA");

    expect(redTheme.palettes.primary.tones[40]).not.toBe(blueTheme.palettes.primary.tones[40]);
    expect(redTheme.palettes.secondary.tones[40]).not.toBe(blueTheme.palettes.secondary.tones[40]);
  });

  test("matches Material Color Utilities CorePalette HCT reference tones", () => {
    const theme = generateTheme("#6750A4");

    expect(theme.palettes.primary.tones[10]).toBe("#22005D");
    expect(theme.palettes.primary.tones[40]).toBe("#6750A4");
    expect(theme.palettes.primary.tones[90]).toBe("#E9DDFF");
    expect(theme.palettes.secondary.tones[40]).toBe("#625B71");
    expect(theme.palettes.tertiary.tones[40]).toBe("#7E5260");
    expect(theme.palettes.error.tones[40]).toBe("#BA1A1A");
  });

  test("normalizes short and unprefixed hex seeds", () => {
    expect(generateTheme("abc").seed).toBe("#ABC");
    expect(generateTheme("6750a4").palettes.primary.tones[40]).toBe("#6750A4");
  });

  test("rejects malformed seed colors", () => {
    expect(() => generateTheme("purple")).toThrow("Invalid seed color: purple");
  });

  test.each(["#6750A4", "#CE422B", "#0F52BA", "#FFFFFF"])(
    "tertiary and error roles resolve to the MCU CorePalette reference for %s",
    seed => {
      const css = generateTheme(seed).cssCustomProperties;
      const declarations = new Map(
        [...css.matchAll(/(--md-ref-palette-[\w-]+):\s*(#[\da-f]+);/gi)].map(match => [
          match[1]!,
          match[2]!.toLowerCase(),
        ]),
      );
      const [light, dark] = css.split("@media (prefers-color-scheme: dark)");
      for (const [block, reference] of [
        [light!, Scheme.light(argbFromHex(seed)).toJSON()],
        [dark!, Scheme.dark(argbFromHex(seed)).toJSON()],
      ] as const) {
        for (const role of [
          "tertiary",
          "onTertiary",
          "tertiaryContainer",
          "onTertiaryContainer",
          "error",
          "onError",
          "errorContainer",
          "onErrorContainer",
        ] as const) {
          const name = role.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
          const match = new RegExp(`--md-sys-color-${name}: var\\((--md-ref-palette-[\\w-]+)\\);`).exec(block);
          expect(match).not.toBeNull();
          expect(declarations.get(match![1]!)).toBe(hexFromArgb(reference[role]));
        }
      }
    },
  );

  test("both modes declare every M3 color role and reference existing palette values", async () => {
    const contract = await Bun.file(new URL("../../m3-tokens/src/native-theme.ts", import.meta.url)).text();
    const roles = [.../export const ROLES = \[([\s\S]*?)\]/.exec(contract)![1]!.matchAll(/"(\w+)"/g)].map(
      match => `--md-sys-color-${match[1]!.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`,
    );
    expect(roles.length).toBe(49);
    const css = generateTheme("#6750A4").cssCustomProperties;
    const paletteNames = new Set([...css.matchAll(/(--md-ref-palette-[\w-]+):/g)].map(match => match[1]));
    for (const block of css.split("@media (prefers-color-scheme: dark)")) {
      const actual = [...block.matchAll(/(--md-sys-color-[\w-]+):\s*var\((--md-ref-palette-[\w-]+)\);/g)];
      expect(actual).toHaveLength(roles.length);
      expect(new Set(actual.map(match => match[1]))).toEqual(new Set(roles));
      for (const match of actual) expect(paletteNames.has(match[2])).toBe(true);
    }
  });
});
