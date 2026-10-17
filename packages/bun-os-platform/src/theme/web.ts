// SPDX-License-Identifier: Apache-2.0
/**
 * Browser side of the theme: the server sends the merged theme file (`GET /api/platform/theme`)
 * and the generated stylesheet (`GET /api/platform/theme.css`); dynamic color re-resolves the
 * same file with a new seed so variant, contrast and role overrides of the user's theme still
 * apply to art-seeded schemes.
 */
import { colorDeclarations, resolveTheme, type ThemeFile } from "./resolve";

export type { ThemeFile, Tokens } from "./resolve";

let file: ThemeFile = {};

export async function loadWebTheme(base = ""): Promise<ThemeFile> {
  file = (await (await fetch(`${base}/api/platform/theme`)).json()) as ThemeFile;
  return file;
}

export function webThemeFile(): ThemeFile {
  return file;
}

/** System high contrast / forced colors in the browser. */
export function prefersHighContrast(): boolean {
  return matchMedia("(prefers-contrast: more)").matches || matchMedia("(forced-colors: active)").matches;
}

/**
 * Applies the theme's color roles for `dark`, re-seeded from `seed` when the theme opts into
 * dynamic color (`color.dynamic: "art"`). Under forced colors the stylesheet's system colors win
 * (no inline override is written).
 */
export function applyWebTheme(options: { dark: boolean; seed?: string | null; target?: HTMLElement }): void {
  const root = options.target ?? document.documentElement;
  const style = root.style;
  for (let i = style.length - 1; i >= 0; i--) {
    const name = style.item(i);
    if (name.startsWith("--md-sys-color-")) style.removeProperty(name);
  }
  if (matchMedia("(forced-colors: active)").matches) return;
  const seed = file.color?.dynamic === "art" ? (options.seed ?? undefined) : undefined;
  const tokens = resolveTheme(file, {
    dark: options.dark,
    seed,
    highContrast: prefersHighContrast(),
  });
  for (const line of colorDeclarations(tokens, "").split("\n")) {
    const [name, value] = line.replace(/;$/, "").split(": ");
    if (name && value) style.setProperty(name, value);
  }
}
