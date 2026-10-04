// SPDX-License-Identifier: Apache-2.0
// Tailwind v4 CSS-first preset: `@theme` generated from @aphrody/m3-tokens, so the utilities
// (`bg-primary`, `rounded-large`, `text-body-large`, `ease-emphasized`, `shadow-elevation-2`) and the
// runtime `--md-sys-*` custom properties never drift.
import { ROLES } from "@aphrody/m3-tokens/dynamic-color";
import { EMPHASIZED_STYLES, TYPE_BASE, type TypeStyleName } from "@aphrody/m3-tokens/expressive";

const kebab = (s: string): string => s.replace(/([A-Z])/g, "-$1").toLowerCase();

export const SHAPES = [
  "none",
  "extra-small",
  "small",
  "medium",
  "large",
  "large-increased",
  "extra-large",
  "extra-large-increased",
  "extra-extra-large",
  "full",
] as const;

export const EASINGS = [
  "standard",
  "standard-decelerate",
  "standard-accelerate",
  "emphasized",
  "emphasized-decelerate",
  "emphasized-accelerate",
] as const;

export interface PresetOptions {
  /** Emit `@theme static` so every variable is kept even when no utility uses it. Default false (`inline`). */
  keepUnused?: boolean;
}

const lines = (entries: [string, string][]): string =>
  entries.map(([k, v]) => `  ${k}: ${v};`).join("\n");

export function colorEntries(): [string, string][] {
  return ROLES.map((r) => [`--color-${kebab(r)}`, `var(--md-sys-color-${kebab(r)})`]);
}

export function shapeEntries(): [string, string][] {
  return SHAPES.map((s) => [`--radius-${s}`, `var(--md-sys-shape-corner-${s})`]);
}

export function textEntries(): [string, string][] {
  const out: [string, string][] = [];
  for (const name of Object.keys(TYPE_BASE) as TypeStyleName[]) {
    const p = `--md-sys-typescale-${name}`;
    out.push(
      [`--text-${name}`, `var(${p}-size)`],
      [`--text-${name}--line-height`, `var(${p}-line-height)`],
      [`--text-${name}--letter-spacing`, `var(${p}-tracking)`],
      [`--text-${name}--font-weight`, `var(${p}-weight)`],
    );
  }
  for (const s of EMPHASIZED_STYLES) {
    const p = `--md-sys-typescale-${s.name}-emphasized`;
    out.push(
      [`--text-${s.name}-emphasized`, `var(${p}-size)`],
      [`--text-${s.name}-emphasized--line-height`, `var(${p}-line-height)`],
      [`--text-${s.name}-emphasized--letter-spacing`, `var(${p}-tracking)`],
      [`--text-${s.name}-emphasized--font-weight`, `var(${p}-weight)`],
    );
  }
  return out;
}

export function easeEntries(): [string, string][] {
  return EASINGS.map((e) => [`--ease-${e}`, `var(--md-sys-motion-easing-${e})`]);
}

export function shadowEntries(): [string, string][] {
  return [1, 2, 3, 4, 5].map((n) => [
    `--shadow-elevation-${n}`,
    `var(--md-sys-elevation-level${n})`,
  ]);
}

/** The `@theme` block. Pair it with `m3-tokens.css`, `expressive.css` and a colour sheet at runtime. */
export function themeCss(options: PresetOptions = {}): string {
  const kind = options.keepUnused ? "static" : "inline";
  const fonts: [string, string][] = [
    ["--font-brand", "var(--md-ref-typeface-brand)"],
    ["--font-plain", "var(--md-ref-typeface-plain)"],
    ["--font-code", "var(--md-ref-typeface-code)"],
  ];
  return `@theme ${kind} {\n${lines([
    ...colorEntries(),
    ...shapeEntries(),
    ...textEntries(),
    ...easeEntries(),
    ...shadowEntries(),
    ...fonts,
  ])}\n}\n`;
}

/** Contents of `preset.css`. */
export function presetCss(): string {
  return `/* SPDX-License-Identifier: Apache-2.0 */
/*
 * Material 3 preset for Tailwind v4 (CSS-first). GENERATED from @aphrody/m3-tokens: bun run generate.
 * Usage:
 *   @import "tailwindcss";
 *   @import "@aphrody/m3-tokens/m3-tokens.css";
 *   @import "@aphrody/m3-tokens/expressive.css";
 *   @import "@aphrody/m3-tailwind/preset.css";
 * and set the colour roles at runtime (applyDynamicColor / cssFromSeed / @aphrody/m3-theme/tokens.css).
 */

${themeCss()}`;
}
