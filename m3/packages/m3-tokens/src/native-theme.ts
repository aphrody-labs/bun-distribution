// SPDX-License-Identifier: Apache-2.0
// Adapter for aphrody_m3_tokens::theme::ThemeExport. Rust owns the colours.
import type { ColorRoleMap, SchemeVariant } from "./dynamic-color";

// The Google dynamic-colour roles that map 1:1 onto `--md-sys-color-*` tokens.
// (Palette key colours and non-colour spec fields are intentionally excluded.)
export const ROLES = [
  "background",
  "onBackground",
  "surface",
  "surfaceDim",
  "surfaceBright",
  "surfaceContainerLowest",
  "surfaceContainerLow",
  "surfaceContainer",
  "surfaceContainerHigh",
  "surfaceContainerHighest",
  "onSurface",
  "surfaceVariant",
  "onSurfaceVariant",
  "inverseSurface",
  "inverseOnSurface",
  "outline",
  "outlineVariant",
  "shadow",
  "scrim",
  "surfaceTint",
  "primary",
  "onPrimary",
  "primaryContainer",
  "onPrimaryContainer",
  "inversePrimary",
  "secondary",
  "onSecondary",
  "secondaryContainer",
  "onSecondaryContainer",
  "tertiary",
  "onTertiary",
  "tertiaryContainer",
  "onTertiaryContainer",
  "error",
  "onError",
  "errorContainer",
  "onErrorContainer",
  "primaryFixed",
  "primaryFixedDim",
  "onPrimaryFixed",
  "onPrimaryFixedVariant",
  "secondaryFixed",
  "secondaryFixedDim",
  "onSecondaryFixed",
  "onSecondaryFixedVariant",
  "tertiaryFixed",
  "tertiaryFixedDim",
  "onTertiaryFixed",
  "onTertiaryFixedVariant",
] as const;

const VARIANTS = {
  "tonal-spot": "tonalSpot",
  expressive: "expressive",
  vibrant: "vibrant",
  neutral: "neutral",
  monochrome: "monochrome",
  rainbow: "rainbow",
  "fruit-salad": "fruitSalad",
  content: "content",
  fidelity: "fidelity",
} as const;

/** Native 2021 variants, every one provided by the Rust owner. */
export type NativeSchemeVariant = SchemeVariant | "rainbow" | "fruitSalad";

export interface NativeThemeExport {
  readonly schema_version: 1;
  readonly spec_version: "2021";
  readonly seed: string;
  readonly variant: keyof typeof VARIANTS;
  readonly contrast_level: number;
  readonly light: Readonly<Record<(typeof ROLES)[number], string>>;
  readonly dark: Readonly<Record<(typeof ROLES)[number], string>>;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new TypeError("Native M3 theme must contain an object");
  return value as Record<string, unknown>;
}

function color(value: unknown): string {
  if (typeof value !== "string" || !/^#[\da-f]{6}$/i.test(value))
    throw new TypeError("Native M3 theme contains an invalid hex colour");
  return value.toLowerCase();
}

/** Validate and freeze a detached copy before using native colour data in generated files. */
export function parseNativeThemeExport(value: unknown): NativeThemeExport {
  const theme = record(value);
  if (theme["schema_version"] !== 1 || theme["spec_version"] !== "2021")
    throw new TypeError("Unsupported native M3 theme schema or specification");
  if (typeof theme["variant"] !== "string" || !Object.hasOwn(VARIANTS, theme["variant"]))
    throw new TypeError("Native M3 theme contains an unknown variant");
  const contrast = theme["contrast_level"];
  if (typeof contrast !== "number" || !Number.isFinite(contrast) || contrast < -1 || contrast > 1)
    throw new RangeError("Native M3 contrast must be between -1 and 1");
  const roles = (mode: "light" | "dark") => {
    const source = record(theme[mode]);
    if (Object.keys(source).length !== ROLES.length)
      throw new TypeError(`Native M3 ${mode} scheme must contain all ${ROLES.length} roles`);
    return Object.freeze(Object.fromEntries(ROLES.map((role) => [role, color(source[role])])));
  };
  return Object.freeze({
    schema_version: 1,
    spec_version: "2021",
    seed: color(theme["seed"]),
    variant: theme["variant"] as NativeThemeExport["variant"],
    contrast_level: contrast,
    light: roles("light") as NativeThemeExport["light"],
    dark: roles("dark") as NativeThemeExport["dark"],
  });
}

export function nativeThemeVariant(theme: NativeThemeExport): NativeSchemeVariant {
  return VARIANTS[theme.variant];
}

/** Keep every colour unchanged; only translate native role names to CSS property names. */
export function nativeThemeColorRoles(value: NativeThemeExport, dark = false): ColorRoleMap {
  const theme = parseNativeThemeExport(value);
  const roles = dark ? theme.dark : theme.light;
  return Object.fromEntries(
    ROLES.map((role) => [
      `--md-sys-color-${role.replace(/([A-Z])/g, "-$1").toLowerCase()}`,
      roles[role],
    ]),
  );
}

export function nativeThemeCss(
  theme: NativeThemeExport,
  selectors: { lightSelector?: string; darkSelector?: string } = {},
): string {
  const light = selectors.lightSelector ?? ":root";
  const dark = selectors.darkSelector ?? ':root[data-theme="dark"]';
  const sheet = (selector: string, isDark: boolean) =>
    `${selector} {\n  color-scheme: ${isDark ? "dark" : "light"};\n` +
    Object.entries(nativeThemeColorRoles(theme, isDark))
      .map(([name, value]) => `  ${name}: ${value};`)
      .join("\n") +
    "\n}\n";
  return sheet(light, false) + "\n" + sheet(dark, true);
}
