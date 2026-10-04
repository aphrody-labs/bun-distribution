// SPDX-License-Identifier: Apache-2.0
import { schemeFromSeed } from "@aphrody/m3-tokens/dynamic-color";
import { normalizeHex } from "@aphrody/m3-tokens/theme-to-tokens";
import type { Mode, Roles, ThemeColors, ThemeInput } from "./types.ts";

const camel = (kebab: string): string =>
  kebab.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

/** Validate the theme name and seed; returns the normalised `#rrggbb` seed. */
export function validate(input: ThemeInput): string {
  if (!/^[A-Za-z0-9_-]+$/.test(input.name)) {
    throw new Error(`invalid theme name "${input.name}": use [A-Za-z0-9_-]`);
  }
  const seed = normalizeHex(input.seed);
  if (!seed) throw new Error(`invalid seed colour "${input.seed}": expected #rrggbb`);
  return seed.toLowerCase();
}

/** M3 roles for one mode, keyed by camelCase role name. */
export function rolesFor(input: ThemeInput, mode: Mode): ThemeColors {
  const seed = validate(input);
  const map = schemeFromSeed(seed, { dark: mode === "dark", variant: input.variant });
  const roles: Roles = {};
  for (const [k, v] of Object.entries(map)) {
    roles[camel(k.replace("--md-sys-color-", ""))] = v.toLowerCase();
  }
  return { mode, roles };
}

export const MODES: readonly Mode[] = ["light", "dark"];

export function allModes(input: ThemeInput): ThemeColors[] {
  return MODES.map((m) => rolesFor(input, m));
}

export function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const hex = (n: number): string => n.toString(16).padStart(2, "0");
export const hex8 = (n: number): string => (n >>> 0).toString(16).padStart(8, "0");

/** Windows DWM DWORD for `AccentColor` / `*ColorMenu`: 0xAABBGGRR. */
export function abgr(color: string, alpha = 255): number {
  const [r, g, b] = rgb(color);
  return ((alpha << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

/** Windows `ColorizationColor` DWORD: 0xAARRGGBB. */
export function argb(color: string, alpha = 255): number {
  const [r, g, b] = rgb(color);
  return ((alpha << 24) | (r << 16) | (g << 8) | b) >>> 0;
}

/** sRGB channels as 0..1 floats for RON (rounded to 6 decimals). */
export function unit(color: string): { red: string; green: string; blue: string } {
  const [r, g, b] = rgb(color).map((c) => (c / 255).toFixed(6));
  return { red: r!, green: g!, blue: b! };
}

export const sanitizeName = (name: string): string => name.replace(/[^A-Za-z0-9_-]/g, "-");
