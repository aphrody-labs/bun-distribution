// SPDX-License-Identifier: Apache-2.0
//! Material Design 3 CorePalette generator using the native HCT implementation.

import { argbToHct, hctToArgb } from "@aphrody/bun";
import type { M3Theme, TonalPalette } from "./types.ts";

const toneSteps = [0, 6, 10, 12, 20, 22, 30, 40, 50, 60, 70, 80, 90, 94, 95, 98, 99, 100];

function parseSeedArgb(hex: string): number {
  const match = /^#?([\da-f]{3}|[\da-f]{6})$/i.exec(hex.trim());
  if (!match) {
    throw new Error(`Invalid seed color: ${hex}`);
  }

  const digits = match[1]!;
  const rgb = digits.length === 3
    ? [...digits].map((digit) => `${digit}${digit}`).join("")
    : digits;
  return (0xff000000 | Number.parseInt(rgb, 16)) >>> 0;
}

function argbToHex(argb: number): string {
  return `#${(argb >>> 0).toString(16).slice(-6).toUpperCase()}`;
}

function createPalette(name: string, hue: number, chroma: number): TonalPalette {
  const tones: Record<number, string> = {};
  for (const tone of toneSteps) {
    tones[tone] = argbToHex(hctToArgb(hue, chroma, tone));
  }
  return { name, tones };
}

/** Generate an M3 CorePalette and light/dark CSS tokens from a seed color. */
export function generateTheme(seedHex: string): M3Theme {
  const seed = seedHex.trim().startsWith("#") ? seedHex.trim().toUpperCase() : `#${seedHex.trim().toUpperCase()}`;
  const { hue, chroma } = argbToHct(parseSeedArgb(seedHex));

  // These are the CorePalette.of relationships used by Material Color Utilities.
  const primary = createPalette("primary", hue, Math.max(48, chroma));
  const secondary = createPalette("secondary", hue, 16);
  const tertiary = createPalette("tertiary", hue + 60, 24);
  const neutral = createPalette("neutral", hue, 4);
  const neutralVariant = createPalette("neutral-variant", hue, 8);
  const error = createPalette("error", 25, 84);

  let css = `:root {\n  /* Seed Color: ${seed} */\n`;
  const palettes = { primary, secondary, tertiary, error, neutral, neutralVariant };

  for (const [key, palette] of Object.entries(palettes)) {
    const prefix = key === "neutralVariant" ? "neutral-variant" : key;
    css += `  /* Tonal Palette: ${palette.name} */\n`;
    for (const tone of toneSteps) {
      css += `  --md-ref-palette-${prefix}-${tone}: ${palette.tones[tone]};\n`;
    }
  }

  css += `\n  /* System Tokens - Light Mode */\n`;
  css += `  --md-sys-color-primary: var(--md-ref-palette-primary-40);\n`;
  css += `  --md-sys-color-on-primary: var(--md-ref-palette-primary-100);\n`;
  css += `  --md-sys-color-primary-container: var(--md-ref-palette-primary-90);\n`;
  css += `  --md-sys-color-on-primary-container: var(--md-ref-palette-primary-10);\n`;
  css += `  --md-sys-color-secondary: var(--md-ref-palette-secondary-40);\n`;
  css += `  --md-sys-color-on-secondary: var(--md-ref-palette-secondary-100);\n`;
  css += `  --md-sys-color-secondary-container: var(--md-ref-palette-secondary-90);\n`;
  css += `  --md-sys-color-on-secondary-container: var(--md-ref-palette-secondary-10);\n`;
  css += `  --md-sys-color-surface: var(--md-ref-palette-neutral-98);\n`;
  css += `  --md-sys-color-on-surface: var(--md-ref-palette-neutral-10);\n`;
  css += `  --md-sys-color-surface-container: var(--md-ref-palette-neutral-94);\n`;
  css += `  --md-sys-color-surface-container-highest: var(--md-ref-palette-neutral-90);\n`;
  css += `  --md-sys-color-outline: var(--md-ref-palette-neutral-variant-50);\n`;
  css += `  --md-sys-color-outline-variant: var(--md-ref-palette-neutral-variant-80);\n`;

  css += `}\n\n@media (prefers-color-scheme: dark) {\n  :root {\n`;
  css += `    --md-sys-color-primary: var(--md-ref-palette-primary-80);\n`;
  css += `    --md-sys-color-on-primary: var(--md-ref-palette-primary-20);\n`;
  css += `    --md-sys-color-primary-container: var(--md-ref-palette-primary-30);\n`;
  css += `    --md-sys-color-on-primary-container: var(--md-ref-palette-primary-90);\n`;
  css += `    --md-sys-color-secondary: var(--md-ref-palette-secondary-80);\n`;
  css += `    --md-sys-color-on-secondary: var(--md-ref-palette-secondary-20);\n`;
  css += `    --md-sys-color-secondary-container: var(--md-ref-palette-secondary-30);\n`;
  css += `    --md-sys-color-on-secondary-container: var(--md-ref-palette-secondary-90);\n`;
  css += `    --md-sys-color-surface: var(--md-ref-palette-neutral-6);\n`;
  css += `    --md-sys-color-on-surface: var(--md-ref-palette-neutral-90);\n`;
  css += `    --md-sys-color-surface-container: var(--md-ref-palette-neutral-12);\n`;
  css += `    --md-sys-color-surface-container-highest: var(--md-ref-palette-neutral-22);\n`;
  css += `    --md-sys-color-outline: var(--md-ref-palette-neutral-variant-60);\n`;
  css += `    --md-sys-color-outline-variant: var(--md-ref-palette-neutral-variant-30);\n`;
  css += `  }\n}\n`;

  return {
    seed,
    palettes: { primary, secondary, tertiary, neutral, neutralVariant, error },
    cssCustomProperties: css,
  };
}
