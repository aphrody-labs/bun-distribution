// SPDX-License-Identifier: Apache-2.0
// Desktop themes: Material 3 roles from a seed (cssFromSeed), then hand-tuned dark surfaces and accents in the
// spirit of the Omarchy theme set. Every value here is our own; only the palette moods are borrowed.
import { cssFromSeed } from "@aphrody/m3-tokens/dynamic-color";

type Roles = Record<string, string>;

export interface DesktopTheme {
  id: string;
  name: string;
  /** One line shown under the name in Settings. */
  mood: string;
  seed: string;
  variant: "tonalSpot" | "vibrant" | "expressive" | "fidelity";
  /** Dark-mode overrides (role name without the --md-sys-color- prefix). */
  dark?: Roles;
  /** Light-mode overrides. */
  light?: Roles;
  /** Preview colours for the theme card: background, surface, accent, second accent. */
  preview: [string, string, string, string];
}

const surfaces = (
  [lowest, surface, low, container, high, highest]: string[],
  onSurface: string,
  onVariant: string,
  outline: string,
  outlineVariant: string,
): Roles => ({
  "surface-container-lowest": lowest!,
  "surface-dim": lowest!,
  surface: surface!,
  background: surface!,
  "surface-container-low": low!,
  "surface-container": container!,
  "surface-container-high": high!,
  "surface-container-highest": highest!,
  "surface-bright": highest!,
  "surface-variant": highest!,
  "on-surface": onSurface,
  "on-background": onSurface,
  "on-surface-variant": onVariant,
  outline,
  "outline-variant": outlineVariant,
});

const accent = (
  name: string,
  [base, on, container, onContainer]: string[],
): Roles => ({
  [name]: base!,
  [`on-${name}`]: on!,
  [`${name}-container`]: container!,
  [`on-${name}-container`]: onContainer!,
});

export const THEMES: DesktopTheme[] = [
  {
    id: "aphrody",
    name: "Aphrody",
    mood: "Calm indigo, follows your light or dark setting",
    seed: "#4c62d9",
    variant: "tonalSpot",
    dark: {
      ...surfaces(
        ["#0c0e17", "#11131d", "#161925", "#1b1e2b", "#232736", "#2c3142"],
        "#e1e3f2",
        "#a9aec8",
        "#6d7393",
        "#353a50",
      ),
      ...accent("primary", ["#a9b8ff", "#13226b", "#2e3f95", "#dde2ff"]),
      ...accent("tertiary", ["#7fd6c6", "#00382f", "#1c5148", "#a6f2e2"]),
    },
    preview: ["#11131d", "#232736", "#a9b8ff", "#7fd6c6"],
  },
  {
    id: "night",
    name: "Neon night",
    mood: "Deep navy with electric blue and violet",
    seed: "#6f8ff0",
    variant: "vibrant",
    dark: {
      ...surfaces(
        ["#0f1018", "#14151f", "#191a26", "#1e202e", "#262839", "#2f3246"],
        "#c9d0f2",
        "#8e97c2",
        "#5a628e",
        "#323750",
      ),
      ...accent("primary", ["#8eabfa", "#0e1b45", "#2a3b72", "#dbe3ff"]),
      ...accent("secondary", ["#bb9ef7", "#2b1458", "#45307a", "#ecdcff"]),
      ...accent("tertiary", ["#86dccd", "#00382f", "#1d5248", "#b4f5e8"]),
    },
    preview: ["#14151f", "#262839", "#8eabfa", "#bb9ef7"],
  },
  {
    id: "mocha",
    name: "Mocha",
    mood: "Soft lavender and pink on warm plum",
    seed: "#b893f2",
    variant: "tonalSpot",
    dark: {
      ...surfaces(
        ["#13111b", "#1a1824", "#1f1d2a", "#252331", "#2d2b3b", "#373446"],
        "#dcd9f4",
        "#aaa6ca",
        "#716d8f",
        "#3e3b52",
      ),
      ...accent("primary", ["#cbaef7", "#33175c", "#4d3478", "#f0e2ff"]),
      ...accent("secondary", ["#f1bcd2", "#4c1d33", "#663349", "#ffd9e6"]),
      ...accent("tertiary", ["#99dcc9", "#00382c", "#1f5245", "#b8f6e3"]),
    },
    preview: ["#1a1824", "#2d2b3b", "#cbaef7", "#f1bcd2"],
  },
  {
    id: "campfire",
    name: "Campfire",
    mood: "Amber and olive on toasted brown",
    seed: "#d89a3a",
    variant: "tonalSpot",
    dark: {
      ...surfaces(
        ["#141310", "#1b1916", "#211f1b", "#272420", "#302c27", "#3a3630"],
        "#ecdfc2",
        "#c1b292",
        "#81755f",
        "#48423a",
      ),
      ...accent("primary", ["#eab55a", "#2c1c00", "#5b4216", "#ffdeac"]),
      ...accent("secondary", ["#b3c46a", "#232c00", "#3f4a12", "#d6e88c"]),
      ...accent("tertiary", ["#8fbca9", "#00382a", "#2a4f42", "#b1e2cd"]),
    },
    preview: ["#1b1916", "#302c27", "#eab55a", "#b3c46a"],
  },
  {
    id: "rose",
    name: "Rose dusk",
    mood: "Muted rose, iris and foam at twilight",
    seed: "#c4859a",
    variant: "tonalSpot",
    dark: {
      ...surfaces(
        ["#120f19", "#18151f", "#1d1a26", "#23202d", "#2b2736", "#353042"],
        "#e5ddf2",
        "#aca3c3",
        "#706889",
        "#3c3650",
      ),
      ...accent("primary", ["#eeb8c8", "#4a1b2b", "#653041", "#ffd9e3"]),
      ...accent("secondary", ["#c7abea", "#311a52", "#48336b", "#ecdcff"]),
      ...accent("tertiary", ["#a1d1da", "#00363e", "#22505a", "#c3eef6"]),
    },
    preview: ["#18151f", "#2b2736", "#eeb8c8", "#c7abea"],
  },
];

/** Accent colours for the "Your colour" theme (Material You from a seed). */
export const SEEDS: [string, string][] = [
  ["Violet", "#6750a4"],
  ["Ocean", "#0b6bcb"],
  ["Forest", "#2e7d32"],
  ["Sunset", "#d84315"],
  ["Rose", "#c2185b"],
  ["Slate", "#455a64"],
];

const block = (roles: Roles | undefined, indent = "  ") =>
  roles
    ? Object.entries(roles)
        .map(([k, v]) => `${indent}--md-sys-color-${k}: ${v};`)
        .join("\n")
    : "";

/** The stylesheet for a theme id, or for a custom seed when id is "seed". */
export function themeCss(id: string, seed?: string): string {
  const theme = THEMES.find((t) => t.id === id);
  if (!theme)
    return cssFromSeed(seed ?? THEMES[0]!.seed, { variant: "tonalSpot" });
  const base = cssFromSeed(theme.seed, { variant: theme.variant });
  const dark = block(theme.dark, "    ");
  const light = block(theme.light);
  return [
    base,
    light ? `:root {\n${light}\n}` : "",
    dark
      ? `@media (prefers-color-scheme: dark) {\n  :root:not([data-theme]) {\n${dark}\n  }\n}\n:root[data-theme="dark"] {\n${block(theme.dark)}\n}`
      : "",
  ].join("\n");
}
