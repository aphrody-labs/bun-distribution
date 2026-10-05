// SPDX-License-Identifier: Apache-2.0
// The `m3:*` token sheets in TypeScript, from `@aphrody/m3-tokens` (Material Color Utilities): the fallback of
// `m3Css` of `@aphrody/bun`, which needs the Rust library. The `tokens` sheet is the static token CSS plus the
// colour roles of the seed for light and dark; the `scheme` sheet is one mode's roles. `tailwind` and `spaceui`
// are Rust-only sheets: use `@aphrody/m3-tailwind/preset.css` or pass `css` to the plugin.
import { cssFromSeed, schemeFromSeed, type SchemeVariant } from "@aphrody/m3-tokens/dynamic-color";
import type { M3CssConfig, M3CssFn } from "@aphrody/m3";
import { readFileSync } from "node:fs";

const VARIANTS: Record<string, SchemeVariant> = {
  "tonal-spot": "tonalSpot",
  tonalspot: "tonalSpot",
  content: "content",
  fidelity: "fidelity",
  expressive: "expressive",
  vibrant: "vibrant",
  neutral: "neutral",
  monochrome: "monochrome",
};

/** `tonal-spot` and `tonalSpot` both name the default scheme variant. */
export function schemeVariant(name: string | undefined): SchemeVariant {
  if (!name) return "tonalSpot";
  const variant = VARIANTS[name.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase()];
  if (!variant) throw new Error(`m3-bun: unknown scheme variant ${name} (${Object.keys(VARIANTS).join(", ")})`);
  return variant;
}

const staticSheets = (): string =>
  ["@aphrody/m3-tokens/m3-tokens.css", "@aphrody/m3-tokens/expressive.css"]
    .map((specifier) => readFileSync(Bun.resolveSync(specifier, import.meta.dir), "utf8"))
    .join("\n");

/** An `M3CssFn` that needs no native library. */
export const tsM3Css: M3CssFn = (config: M3CssConfig): string => {
  const seed = config.seed ?? "#6750a4";
  const options = { variant: schemeVariant(config.variant), ...(config.contrast !== undefined ? { contrastLevel: config.contrast } : {}) };
  switch (config.sheet) {
    case "tokens":
      return `${staticSheets()}\n${cssFromSeed(seed, options)}`;
    case "scheme": {
      const roles = schemeFromSeed(seed, { ...options, dark: config.dark ?? false });
      return `:root {\n${Object.entries(roles)
        .map(([name, value]) => `  ${name}: ${value};`)
        .join("\n")}\n}\n`;
    }
    default:
      throw new Error(`m3-bun: the ${config.sheet} sheet needs the Rust m3Css (@aphrody/bun); import @aphrody/m3-tailwind/preset.css or pass \`css\` to the plugin`);
  }
};
