// SPDX-License-Identifier: Apache-2.0
// Where the Aphrody OS assets live. Fonts and icons ship from the crates (docs/design/M3-PLAN.md,
// decision D5): `crates/ui/bun/icons/material-symbols/*.woff2` and
// the `@aphrody/m3-fonts` package. The repository root is discovered by walking up from a start
// directory; `APHRODY_OS_ROOT` or an explicit `root` option override it.
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** Repository-relative directory of the Material Symbols woff2 files. */
export const SYMBOLS_DIR = "crates/ui/bun/icons/material-symbols";
/** Repository-relative directory of the Google Sans Flex variable font. */
export const SANS_FLEX_DIR = "assets/fonts/google-sans-flex";

/** The three Material Symbols styles shipped by the `aphrody-bun` icons module. */
export const SYMBOL_STYLES = ["outlined", "rounded", "sharp"] as const;
export type SymbolStyle = (typeof SYMBOL_STYLES)[number];

/** Walk up from `start` to the first directory holding the Material Symbols fonts. */
export function findRepoRoot(start: string): string | undefined {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, SYMBOLS_DIR, "material-symbols-outlined.woff2"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Resolve the Aphrody OS root: explicit `root`, then `APHRODY_OS_ROOT`, then a walk up from the
 * working directory, then from this package. Throws when none holds the fonts.
 */
export function resolveRepoRoot(root?: string): string {
  if (root) return resolve(root);
  const fromEnv = Bun.env.APHRODY_OS_ROOT;
  if (fromEnv) return resolve(fromEnv);
  const found = findRepoRoot(process.cwd()) ?? findRepoRoot(import.meta.dir);
  if (!found) {
    throw new Error(
      `@aphrody/m3: cannot find ${SYMBOLS_DIR} above ${process.cwd()}; pass \`root\` or set APHRODY_OS_ROOT`,
    );
  }
  return found;
}

/** Absolute paths of the font files, for a given repository root. */
export function fontPaths(root: string) {
  const symbols = join(root, SYMBOLS_DIR);
  return {
    symbolsDir: symbols,
    symbols: Object.fromEntries(
      SYMBOL_STYLES.map((style) => [style, join(symbols, `material-symbols-${style}.woff2`)]),
    ) as Record<SymbolStyle, string>,
    sansFlexDir: join(root, SANS_FLEX_DIR),
    sansFlex: join(root, SANS_FLEX_DIR, "GoogleSansFlex-Variable.ttf"),
  };
}
