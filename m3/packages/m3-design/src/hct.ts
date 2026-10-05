// SPDX-License-Identifier: Apache-2.0
//! Material Design 3 CorePalette generator using the pure-JS HCT implementation.

import { Hct } from "@material/material-color-utilities";
import type { M3Theme, TonalPalette } from "./types.ts";

const toneSteps = [
  0, 4, 6, 10, 12, 17, 20, 22, 24, 30, 40, 50, 60, 70, 80, 87, 90, 92, 94, 95, 96, 98, 99, 100,
];

type RoleTone = readonly [palette: string, light: number, dark: number];

/** CorePalette system roles, including the M3 surface levels and fixed accents. */
function systemRoles(): Record<string, RoleTone> {
  const roles: Record<string, RoleTone> = {
    background: ["neutral", 98, 6],
    "on-background": ["neutral", 10, 90],
    surface: ["neutral", 98, 6],
    "surface-dim": ["neutral", 87, 6],
    "surface-bright": ["neutral", 98, 24],
    "surface-container-lowest": ["neutral", 100, 4],
    "surface-container-low": ["neutral", 96, 10],
    "surface-container": ["neutral", 94, 12],
    "surface-container-high": ["neutral", 92, 17],
    "surface-container-highest": ["neutral", 90, 22],
    "on-surface": ["neutral", 10, 90],
    "surface-variant": ["neutral-variant", 90, 30],
    "on-surface-variant": ["neutral-variant", 30, 80],
    "inverse-surface": ["neutral", 20, 90],
    "inverse-on-surface": ["neutral", 95, 20],
    outline: ["neutral-variant", 50, 60],
    "outline-variant": ["neutral-variant", 80, 30],
    shadow: ["neutral", 0, 0],
    scrim: ["neutral", 0, 0],
    "surface-tint": ["primary", 40, 80],
    "inverse-primary": ["primary", 80, 40],
  };
  for (const palette of ["primary", "secondary", "tertiary", "error"]) {
    roles[palette] = [palette, 40, 80];
    roles[`on-${palette}`] = [palette, 100, 20];
    roles[`${palette}-container`] = [palette, 90, 30];
    // MCU Scheme.dark uses error tone 80, while the other container foregrounds use 90.
    roles[`on-${palette}-container`] = [palette, 10, palette === "error" ? 80 : 90];
    if (palette !== "error") {
      roles[`${palette}-fixed`] = [palette, 90, 90];
      roles[`${palette}-fixed-dim`] = [palette, 80, 80];
      roles[`on-${palette}-fixed`] = [palette, 10, 10];
      roles[`on-${palette}-fixed-variant`] = [palette, 30, 30];
    }
  }
  return roles;
}

const SYSTEM_ROLES = systemRoles();

function renderSystemRoles(dark: boolean): string {
  const indent = dark ? "    " : "  ";
  return Object.entries(SYSTEM_ROLES)
    .map(
      ([role, [palette, lightTone, darkTone]]) =>
        `${indent}--md-sys-color-${role}: var(--md-ref-palette-${palette}-${dark ? darkTone : lightTone});\n`,
    )
    .join("");
}

function parseSeedArgb(hex: string): number {
  const match = /^#?([\da-f]{3}|[\da-f]{6})$/i.exec(hex.trim());
  if (!match) {
    throw new Error(`Invalid seed color: ${hex}`);
  }

  const digits = match[1]!;
  const rgb =
    digits.length === 3 ? [...digits].map((digit) => `${digit}${digit}`).join("") : digits;
  return (0xff000000 | Number.parseInt(rgb, 16)) >>> 0;
}

function argbToHex(argb: number): string {
  return `#${(argb >>> 0).toString(16).slice(-6).toUpperCase()}`;
}

function createPalette(name: string, hue: number, chroma: number): TonalPalette {
  const tones: Record<number, string> = {};
  for (const tone of toneSteps) {
    tones[tone] = argbToHex(Hct.from(hue, chroma, tone).toInt());
  }
  return { name, tones };
}

/** Generate an M3 CorePalette and light/dark CSS tokens from a seed color. */
export function generateTheme(seedHex: string): M3Theme {
  const seed = seedHex.trim().startsWith("#")
    ? seedHex.trim().toUpperCase()
    : `#${seedHex.trim().toUpperCase()}`;
  const { hue, chroma } = Hct.fromInt(parseSeedArgb(seedHex));

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
  css += renderSystemRoles(false);

  css += `}\n\n@media (prefers-color-scheme: dark) {\n  :root {\n`;
  css += renderSystemRoles(true);
  css += `  }\n}\n`;

  return {
    seed,
    palettes: { primary, secondary, tertiary, neutral, neutralVariant, error },
    cssCustomProperties: css,
  };
}
