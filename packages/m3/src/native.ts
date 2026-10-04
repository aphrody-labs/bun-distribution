// SPDX-License-Identifier: Apache-2.0
// Lazy bridge to `@aphrody/bun`. Importing that package opens the `bun_rs` native library, so it
// is only loaded when a sheet is generated or a `.scss` file is compiled: a dev server or build
// that uses neither never needs the Rust library.

/** The sheets `crates/ui/m3-tokens` exports through `m3Css`. */
export type M3Sheet = "tokens" | "tailwind" | "spaceui" | "scheme";

/** Arguments of `m3Css` in `@aphrody/bun` (the Rust token exporter behind FFI). */
export interface M3CssConfig {
  sheet: M3Sheet;
  seed?: string;
  variant?: string;
  dark?: boolean;
  contrast?: number;
}

/** A CSS generator: `m3Css` from `@aphrody/bun`, or a replacement (tests, custom tokens). */
export type M3CssFn = (config: M3CssConfig) => string;

/** The subset of `@aphrody/bun` this package uses. `m3Css` is declared optional: older builds lack it. */
interface AphrodyBunModule {
  m3Css?: M3CssFn;
  sassRustPlugin?: (options?: { loadPaths?: string[]; style?: "expanded" | "compressed"; quiet?: boolean }) => {
    name: string;
    setup(build: unknown): void;
  };
}

// A specifier held in a variable keeps the typechecker out of the package sources (they are
// compiled against their own tsconfig) and keeps bundlers from inlining the FFI loader.
const APHRODY_BUN = "@aphrody/bun";
let loaded: Promise<AphrodyBunModule> | undefined;

/** Import `@aphrody/bun` once. */
export function loadAphrodyBun(): Promise<AphrodyBunModule> {
  loaded ??= import(APHRODY_BUN) as Promise<AphrodyBunModule>;
  return loaded;
}

/** `m3Css` from `@aphrody/bun`, loaded on first call. */
export async function defaultM3Css(): Promise<M3CssFn> {
  const mod = await loadAphrodyBun();
  if (typeof mod.m3Css !== "function") {
    throw new Error("@aphrody/m3: this build of @aphrody/bun does not export m3Css (rebuild crates/ui/bun)");
  }
  return mod.m3Css;
}

/**
 * Scheme variant in the spelling `crates/ui/m3-tokens` expects (`tonal-spot`), from either
 * the kebab-case name or the camelCase `SchemeVariant` of `@aphrody/m3-theme/react` (`tonalSpot`).
 */
export function normalizeVariant(variant: string): string {
  return variant.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

/** The `m3Css` request for `sheet` and a theme, omitting unset fields. */
export function cssRequest(
  sheet: M3Sheet,
  theme: { seed?: string; variant?: string; contrast?: number; dark?: boolean },
): M3CssConfig {
  const config: M3CssConfig = { sheet };
  if (theme.seed !== undefined) config.seed = theme.seed;
  if (theme.variant !== undefined) config.variant = normalizeVariant(theme.variant);
  if (theme.contrast !== undefined) config.contrast = theme.contrast;
  if (theme.dark !== undefined) config.dark = theme.dark;
  return config;
}
