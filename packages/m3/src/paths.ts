// SPDX-License-Identifier: Apache-2.0
// Where the Aphrody OS assets live. Fonts and icons ship from the crates (docs/design/M3-PLAN.md,
// decision D5): `crates/ui/bun/icons/material-symbols/*.woff2` and
// the `@aphrody/m3-fonts` package. Two layouts are recognised: an Aphrody OS checkout
// (`crates/ui/bun/icons/material-symbols`, `assets/fonts/google-sans-flex`) and an aphrody-m3 checkout
// whose `packages/m3-fonts/fonts/upstream` holds the same files, pinned and fetched by
// `bun scripts/fonts-sync.ts` (standalone, yolo and iecode checkouts). The root is discovered by
// walking up from a start directory; `APHRODY_OS_ROOT` or an explicit `root` option override it.
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** Repository-relative directory of the Material Symbols woff2 files. */
export const SYMBOLS_DIR = "crates/ui/bun/icons/material-symbols";
/** Repository-relative directory of the Google Sans Flex variable font. */
export const SANS_FLEX_DIR = "assets/fonts/google-sans-flex";
/** aphrody-m3 layout: the synced upstream sources of `@aphrody/m3-fonts` (fonts.lock.json). */
export const M3_FONTS_UPSTREAM_DIR = "packages/m3-fonts/fonts/upstream";
const M3_SYMBOLS_DIR = `${M3_FONTS_UPSTREAM_DIR}/material-symbols`;
const M3_SANS_FLEX_DIR = `${M3_FONTS_UPSTREAM_DIR}/google-sans-flex`;

/** Whether `dir` holds the fonts in the Aphrody OS layout (`os`) or the aphrody-m3 layout (`m3`). */
export function fontLayout(dir: string): "os" | "m3" | undefined {
  if (existsSync(join(dir, SYMBOLS_DIR, "material-symbols-outlined.woff2")))
    return "os";
  if (existsSync(join(dir, M3_SYMBOLS_DIR, "material-symbols-outlined.woff2")))
    return "m3";
  return undefined;
}

/** The three Material Symbols styles shipped by the `aphrody-bun` icons module. */
export const SYMBOL_STYLES = ["outlined", "rounded", "sharp"] as const;
export type SymbolStyle = (typeof SYMBOL_STYLES)[number];

/** Walk up from `start` to the first directory holding the Material Symbols fonts. */
export function findRepoRoot(start: string): string | undefined {
  let dir = resolve(start);
  for (;;) {
    if (fontLayout(dir)) return dir;
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
      `@aphrody/m3: cannot find ${SYMBOLS_DIR} or ${M3_SYMBOLS_DIR} above ${process.cwd()}; run \`bun scripts/fonts-sync.ts\` in aphrody-m3, pass \`root\` or set APHRODY_OS_ROOT`,
    );
  }
  return found;
}

/** Absolute paths of the font files, for a given repository root. */
export function fontPaths(root: string) {
  const m3 = fontLayout(root) === "m3";
  const symbols = join(root, m3 ? M3_SYMBOLS_DIR : SYMBOLS_DIR);
  const sansFlexDir = join(root, m3 ? M3_SANS_FLEX_DIR : SANS_FLEX_DIR);
  return {
    symbolsDir: symbols,
    symbols: Object.fromEntries(
      SYMBOL_STYLES.map((style) => [
        style,
        join(symbols, `material-symbols-${style}.woff2`),
      ]),
    ) as Record<SymbolStyle, string>,
    sansFlexDir,
    sansFlex: join(sansFlexDir, "GoogleSansFlex-Variable.ttf"),
  };
}
