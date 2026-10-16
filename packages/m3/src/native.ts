// SPDX-License-Identifier: Apache-2.0
// Lazy bridge to the canonical @aphrody/bun binding owner. Its m3Css function delegates to
// bun_rs_m3_css in aphrody-ffi; Rust's aphrody-m3-tokens owns every dynamic sheet.
// No baseline stylesheet or TypeScript palette can replace that native request contract.

/** The sheets `crates/aphrody-m3-tokens` exports through `m3Css`. */
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
    throw new Error(
      "@aphrody/m3: the canonical @aphrody/bun owner must expose m3Css backed by a qualified aphrody-ffi artifact (crates/aphrody-ffi, bun_rs_m3_css). No static theme fallback is supported.",
    );
  }
  return mod.m3Css;
}

/**
 * Scheme variant in the spelling `crates/aphrody-m3-tokens` expects (`tonal-spot`), from either
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
