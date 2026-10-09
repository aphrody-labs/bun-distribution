// SPDX-License-Identifier: Apache-2.0
// Lazy bridge to `@aphrody/bun`. Importing that package opens the `bun_rs` native library, so it
// is only loaded when a sheet is generated or a `.scss` file is compiled: a dev server or build
// that uses neither never needs the Rust library.
import {
  closeSync,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
} from "node:fs";
import { dirname, join, parse, resolve } from "node:path";

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

/** Serialized ThemeExport v1 from the canonical Rust token owner (2021 color specification). */
export interface NativeThemeExport {
  schema_version: 1;
  spec_version: "2021";
  seed: string;
  variant: string;
  contrast_level: number;
  light: Record<string, string>;
  dark: Record<string, string>;
}

// DTO field names, not a color implementation. Palette key colors are excluded from ThemeExport.
const THEME_ROLES = new Set([
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
  "background",
  "onBackground",
  "surface",
  "onSurface",
  "surfaceVariant",
  "onSurfaceVariant",
  "surfaceDim",
  "surfaceBright",
  "surfaceContainerLowest",
  "surfaceContainerLow",
  "surfaceContainer",
  "surfaceContainerHigh",
  "surfaceContainerHighest",
  "surfaceTint",
  "outline",
  "outlineVariant",
  "inverseSurface",
  "inverseOnSurface",
  "shadow",
  "scrim",
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
]);
const NATIVE_VARIANTS = new Set([
  "monochrome",
  "neutral",
  "tonal-spot",
  "vibrant",
  "expressive",
  "rainbow",
  "fruit-salad",
]);
const MAX_THEME_BYTES = 1024 * 1024;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function artifactError(message: string): Error {
  return new Error(`@aphrody/m3: invalid native theme artifact: ${message}`);
}

/** Read bounded regular files, rejecting symlinks/junctions in every path component. */
function readThemeFile(path: string): string {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  let component = root;
  for (const part of absolute.slice(root.length).split(/[\\/]/).filter(Boolean)) {
    component = join(component, part);
    if (lstatSync(component).isSymbolicLink()) throw artifactError(`symbolic link ${component}`);
  }
  const fd = openSync(absolute, "r");
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_THEME_BYTES)
      throw artifactError(`file must be regular and at most ${MAX_THEME_BYTES} bytes: ${absolute}`);
    const buffer = Buffer.alloc(MAX_THEME_BYTES + 1);
    let bytes = 0;
    while (bytes < buffer.length) {
      const count = readSync(fd, buffer, bytes, buffer.length - bytes, null);
      if (count === 0) break;
      bytes += count;
    }
    if (bytes > MAX_THEME_BYTES)
      throw artifactError(`file exceeds ${MAX_THEME_BYTES} bytes: ${absolute}`);
    return buffer.subarray(0, bytes).toString("utf8");
  } finally {
    closeSync(fd);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Load the paired JSON/CSS native exports and verify all role values agree in both modes. */
export function readNativeTheme(path: string): { theme: NativeThemeExport; css: string } {
  const value: unknown = JSON.parse(readThemeFile(path));
  if (!isRecord(value) || value.schema_version !== 1 || value.spec_version !== "2021")
    throw artifactError("expected ThemeExport schema 1 and color specification 2021");
  if (
    typeof value.seed !== "string" ||
    !HEX_COLOR.test(value.seed) ||
    typeof value.variant !== "string" ||
    !NATIVE_VARIANTS.has(value.variant) ||
    typeof value.contrast_level !== "number" ||
    !Number.isFinite(value.contrast_level) ||
    value.contrast_level < -1 ||
    value.contrast_level > 1
  )
    throw artifactError("invalid seed, variant or contrast_level");
  for (const mode of ["light", "dark"] as const) {
    const roles = value[mode];
    if (
      !isRecord(roles) ||
      Object.keys(roles).length !== THEME_ROLES.size ||
      Object.entries(roles).some(
        ([role, color]) =>
          !THEME_ROLES.has(role) || typeof color !== "string" || !HEX_COLOR.test(color),
      )
    )
      throw artifactError(`${mode} must contain the 49 opaque system color roles`);
  }
  const theme = value as unknown as NativeThemeExport;
  const cssPath = path.replace(/\.json$/i, ".css");
  if (cssPath === path) throw artifactError("theme path must end in .json");
  const css = readThemeFile(cssPath);
  const declared = /Scheme:\s*([a-z-]+) from seed (#[0-9a-f]{6})\./i.exec(css);
  if (declared?.[1] !== theme.variant || declared?.[2]?.toLowerCase() !== theme.seed.toLowerCase())
    throw artifactError("CSS seed/variant metadata differs from JSON");
  const light = /:root\s*\{([^}]+)\}/.exec(css)?.[1];
  const dark = /:root\.dark\s*,\s*\.dark\s*\{([^}]+)\}/.exec(css)?.[1];
  const media = /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{([^}]+)\}/.exec(
    css,
  )?.[1];
  for (const [mode, block] of [
    ["light", light],
    ["dark", dark],
    ["dark", media],
  ] as const) {
    if (!block) throw artifactError(`missing ${mode} CSS block`);
    const declarations = [...block.matchAll(/--md-sys-color-([a-z-]+)\s*:\s*(#[0-9a-f]{6})\s*;/gi)];
    const colors = new Map(declarations.map(([, role, color]) => [role, color!.toLowerCase()]));
    if (
      declarations.length !== THEME_ROLES.size ||
      colors.size !== THEME_ROLES.size ||
      Object.entries(theme[mode]).some(
        ([role, color]) => colors.get(normalizeVariant(role)) !== color.toLowerCase(),
      )
    )
      throw artifactError(`${mode} JSON/CSS role values differ`);
  }
  return { theme, css };
}

/** Selected corpus override, otherwise the nearest enclosing workspace's native export. */
export function findNativeTheme(start: string): string | undefined {
  if (process.env.APHRODY_DESIGN_CORPUS)
    return join(resolve(process.env.APHRODY_DESIGN_CORPUS), "tokens.json");
  let dir = resolve(start);
  for (;;) {
    const path = join(dir, "var/mirrors/design-sync/tokens.json");
    if (existsSync(path)) return path;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** Only the fusion token sheet is exported in this artifact; other sheets retain their native owner. */
export function nativeThemeMatches(config: M3CssConfig, theme: NativeThemeExport): boolean {
  const requested = config.seed ?? "#6750a4";
  const seed = /^#[0-9a-f]{3}$/i.test(requested)
    ? `#${requested
        .slice(1)
        .split("")
        .map((c) => c + c)
        .join("")}`
    : requested;
  return (
    config.sheet === "tokens" &&
    seed.toLowerCase() === theme.seed.toLowerCase() &&
    normalizeVariant(config.variant ?? "tonal-spot").replaceAll("_", "-") === theme.variant &&
    (config.contrast ?? 0) === theme.contrast_level
  );
}

/** The subset of `@aphrody/bun` this package uses. `m3Css` is declared optional: older builds lack it. */
interface AphrodyBunModule {
  m3Css?: M3CssFn;
  isAphrodyFfiAvailable?: () => boolean;
  sassRustPlugin?: (options?: {
    loadPaths?: string[];
    style?: "expanded" | "compressed";
    quiet?: boolean;
  }) => {
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

/** Sheets committed by `@aphrody/m3-theme` (generated by the same Rust exporter for the default theme). */
const COMMITTED_SHEETS: ReadonlySet<M3Sheet> = new Set(["tokens", "tailwind", "spaceui"]);

/**
 * `m3Css` from `@aphrody/bun`, loaded on first call. When the native library cannot be loaded, the default theme
 * (including explicit equivalent baseline inputs) of a committed sheet is read from `@aphrody/m3-theme`; any other
 * request fails with the loader error.
 */
export async function defaultM3Css(): Promise<M3CssFn> {
  let mod: AphrodyBunModule;
  try {
    mod = await loadAphrodyBun();
    if (mod.isAphrodyFfiAvailable?.() === false)
      throw new Error("@aphrody/bun native library is unavailable");
  } catch (error) {
    return (config: M3CssConfig) => {
      const custom =
        (config.seed ?? "#6750a4").toLowerCase() !== "#6750a4" ||
        normalizeVariant(config.variant ?? "tonal-spot").replaceAll("_", "-") !== "tonal-spot" ||
        (config.contrast ?? 0) !== 0;
      if (custom || !COMMITTED_SHEETS.has(config.sheet)) {
        throw new Error(
          `@aphrody/m3: generating the ${config.sheet} sheet for a custom theme needs the @aphrody/bun native library`,
          { cause: error },
        );
      }
      return readFileSync(
        Bun.resolveSync(`@aphrody/m3-theme/${config.sheet}.css`, import.meta.dir),
        "utf8",
      );
    };
  }
  if (typeof mod.m3Css !== "function") {
    throw new Error(
      "@aphrody/m3: this build of @aphrody/bun does not export m3Css (rebuild crates/ui/bun)",
    );
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
