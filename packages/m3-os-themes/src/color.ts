// SPDX-License-Identifier: Apache-2.0
import {
  schemeFromSeed,
  type SchemeVariant,
} from "@aphrody/m3-tokens/dynamic-color";
import {
  nativeThemeColorRoles,
  nativeThemeVariant,
  parseNativeThemeExport,
} from "@aphrody/m3-tokens/native-theme";
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
  if (!seed)
    throw new Error(`invalid seed colour "${input.seed}": expected #rrggbb`);
  if (!["light", "dark", "auto"].includes(input.mode))
    throw new Error(`invalid theme mode "${input.mode}"`);
  if (
    input.contrastLevel !== undefined &&
    (!Number.isFinite(input.contrastLevel) ||
      input.contrastLevel < -1 ||
      input.contrastLevel > 1)
  )
    throw new RangeError(
      "M3 contrast must be a finite number between -1 and 1",
    );
  if (
    input.variant !== undefined &&
    ![
      "tonalSpot",
      "content",
      "fidelity",
      "expressive",
      "vibrant",
      "neutral",
      "monochrome",
      "rainbow",
      "fruitSalad",
    ].includes(input.variant)
  )
    throw new Error(`invalid theme variant "${input.variant}"`);
  if (
    !input.nativeTheme &&
    (input.variant === "rainbow" || input.variant === "fruitSalad")
  )
    throw new Error(
      `Theme variant "${input.variant}" requires a native theme export`,
    );
  return seed.toLowerCase();
}

/** Roles are a pure function of seed, variant, contrast and mode. */
const ROLE_CACHE_SIZE = 32;
const roleCache = new Map<string, ThemeColors>();

/**
 * M3 roles for one mode, keyed by camelCase role name. Memoised per (seed, variant, contrast, mode): one `generate()` for all four
 * targets calls this ~17 times for the 2 distinct schemes, and each call costs 0.5 ms. The result is frozen, as it is
 * shared between callers.
 */
export function rolesFor(input: ThemeInput, mode: Mode): ThemeColors {
  const seed = validate(input);
  const native =
    input.nativeTheme === undefined
      ? undefined
      : parseNativeThemeExport(input.nativeTheme);
  if (
    native &&
    (native.seed !== seed ||
      nativeThemeVariant(native) !== (input.variant ?? "tonalSpot") ||
      native.contrast_level !== (input.contrastLevel ?? 0))
  )
    throw new Error(
      "Native theme does not match the requested seed, variant or contrast",
    );
  const key = `${seed}|${input.variant ?? "tonalSpot"}|${input.contrastLevel ?? 0}|${mode}|${native ? JSON.stringify(native) : ""}`;
  const cached = roleCache.get(key);
  if (cached) return cached;
  const map = native
    ? nativeThemeColorRoles(native, mode === "dark")
    : schemeFromSeed(seed, {
        dark: mode === "dark",
        variant: input.variant as SchemeVariant | undefined,
        contrastLevel: input.contrastLevel,
      });
  const roles: Roles = {};
  for (const [k, v] of Object.entries(map)) {
    roles[camel(k.replace("--md-sys-color-", ""))] = v.toLowerCase();
  }
  const colors: ThemeColors = Object.freeze({
    mode,
    roles: Object.freeze(roles),
  });
  if (roleCache.size >= ROLE_CACHE_SIZE)
    roleCache.delete(roleCache.keys().next().value!);
  roleCache.set(key, colors);
  return colors;
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
export const hex8 = (n: number): string =>
  (n >>> 0).toString(16).padStart(8, "0");

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
export function unit(color: string): {
  red: string;
  green: string;
  blue: string;
} {
  const [r, g, b] = rgb(color).map((c) => (c / 255).toFixed(6));
  return { red: r!, green: g!, blue: b! };
}

export const sanitizeName = (name: string): string =>
  name.replace(/[^A-Za-z0-9_-]/g, "-");
