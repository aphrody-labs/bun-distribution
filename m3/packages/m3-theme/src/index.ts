// SPDX-License-Identifier: Apache-2.0

import { schemeFromSeed } from "@aphrody/m3-tokens/dynamic-color";

export { M3_PLATFORM_CONTRACT, platformState } from "@aphrody/m3-tokens/platform-contract";
export type { M3PlatformState } from "@aphrody/m3-tokens/platform-contract";
export { M3_UI_CATALOG, resolveM3Layer } from "./catalog";
export type { M3UiLayer } from "./catalog";
export {
  GEMINI_BRAND_COLORS,
  GEMINI_BRAND_GRADIENTS,
  GEMINI_BRAND_SHAPES,
  getGeminiBrandCss,
} from "./brand";

// shadcn/ui token -> M3 system role mappings.
// Derived from generate.ts ALIASES.
export const ALIASES = [
  ["background", "surface"],
  ["foreground", "on-surface"],
  ["card", "surface-container-low"],
  ["card-foreground", "on-surface"],
  ["popover", "surface-container"],
  ["popover-foreground", "on-surface"],
  ["primary", "primary"],
  ["primary-foreground", "on-primary"],
  ["secondary", "secondary-container"],
  ["secondary-foreground", "on-secondary-container"],
  ["muted", "surface-variant"],
  ["muted-foreground", "on-surface-variant"],
  ["accent", "tertiary-container"],
  ["accent-foreground", "on-tertiary-container"],
  ["destructive", "error"],
  ["destructive-foreground", "on-error"],
  ["border", "outline-variant"],
  ["input", "outline-variant"],
  ["ring", "primary"],
] as const;

export interface ApplyDynamicFusionThemeOptions {
  dark?: boolean;
  target?: HTMLElement;
  contrastLevel?: number;
  variant?:
    | "tonalSpot"
    | "content"
    | "fidelity"
    | "expressive"
    | "vibrant"
    | "neutral"
    | "monochrome";
}

/**
 * Dynamically applies a Material You color scheme generated from a seed color
 * to a target DOM element (defaulting to document.documentElement).
 *
 * Sets the M3 custom properties (--md-sys-color-*) and maps the corresponding
 * shadcn/ui aliases (--<alias>) and Tailwind v4 bindings (--color-<alias>) inline.
 * Also toggles the 'dark' class and sets the 'color-scheme' CSS property.
 */
export function applyDynamicFusionTheme(
  seed: string,
  options: ApplyDynamicFusionThemeOptions = {},
): void {
  const target =
    options.target ?? (typeof document !== "undefined" ? document.documentElement : null);
  if (!target) return;

  // Detect whether dark mode is active
  let isDark = options.dark;
  if (isDark === undefined) {
    isDark =
      target.classList.contains("dark") ||
      (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  }

  // Derive and validate the whole scheme before changing the target.
  const vars = schemeFromSeed(seed, {
    dark: isDark,
    contrastLevel: options.contrastLevel,
    variant: options.variant,
  });

  // Sync dark class and color-scheme
  if (isDark) {
    target.classList.add("dark");
    target.style.setProperty("color-scheme", "dark");
  } else {
    target.classList.remove("dark");
    target.style.setProperty("color-scheme", "light");
  }

  // Apply M3 system colors
  for (const [key, value] of Object.entries(vars)) {
    target.style.setProperty(key, value);
  }

  // Apply shadcn/ui aliases and Tailwind v4 bindings
  for (const [alias, role] of ALIASES) {
    target.style.setProperty(`--${alias}`, `var(--md-sys-color-${role})`);
    target.style.setProperty(`--color-${alias}`, `var(--md-sys-color-${role})`);
  }
}
