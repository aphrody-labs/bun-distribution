// SPDX-License-Identifier: Apache-2.0
// The `m3:*` sheet generators of m3-bun. The canonical one is the Rust token exporter: `m3Css` of `@aphrody/bun`,
// reached through the native bridge of `@aphrody/m3` (`defaultM3Css`). The Material Color Utilities port of
// `@aphrody/m3-tokens` is used only when a caller asks for it: `mcuM3Css`, `m3CssFor("mcu")`, or `tsM3Css` on a host
// without the native library. `tailwind` and `spaceui` are Rust-only sheets.
import type { M3CssConfig, M3CssFn } from "@aphrody/m3";
import type { NativeThemeExport } from "@aphrody/m3-tokens/native-theme";
import { cssFromSeed, schemeFromSeed, type SchemeVariant } from "@aphrody/m3-tokens/dynamic-color";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const VARIANTS: Record<string, SchemeVariant> = {
  "tonal-spot": "tonalSpot",
  tonalspot: "tonalSpot",
  content: "content",
  fidelity: "fidelity",
  expressive: "expressive",
  vibrant: "vibrant",
  neutral: "neutral",
  monochrome: "monochrome",
};

/** `tonal-spot` and `tonalSpot` both name the default scheme variant. */
export function schemeVariant(name: string | undefined): SchemeVariant {
  if (!name) return "tonalSpot";
  const variant = VARIANTS[name.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase()];
  if (!variant) throw new Error(`m3-bun: unknown scheme variant ${name} (${Object.keys(VARIANTS).join(", ")})`);
  return variant;
}

const staticSheets = (): string =>
  ["@aphrody/m3-tokens/m3-tokens.css", "@aphrody/m3-tokens/expressive.css"]
    .map(specifier => readFileSync(Bun.resolveSync(specifier, import.meta.dir), "utf8"))
    .join("\n");

/** The Material Color Utilities generator of `@aphrody/m3-tokens`: no native library, `tokens` and `scheme` only. */
export const mcuM3Css: M3CssFn = (config: M3CssConfig): string => {
  const seed = config.seed ?? "#6750a4";
  const options = {
    variant: schemeVariant(config.variant),
    ...(config.contrast !== undefined ? { contrastLevel: config.contrast } : {}),
  };
  switch (config.sheet) {
    case "tokens":
      return `${staticSheets()}\n${cssFromSeed(seed, options)}`;
    case "scheme": {
      const roles = schemeFromSeed(seed, { ...options, dark: config.dark ?? false });
      return `:root {\n${Object.entries(roles)
        .map(([name, value]) => `  ${name}: ${value};`)
        .join("\n")}\n}\n`;
    }
    default:
      throw new Error(
        `m3-bun: the ${config.sheet} sheet needs the Rust m3Css (@aphrody/bun); import @aphrody/m3-tailwind/preset.css or pass \`css\` to the plugin`,
      );
  }
};

interface AphrodyBun {
  m3Css?: M3CssFn;
  isAphrodyFfiAvailable?: () => boolean;
}

interface M3NativeBridge {
  defaultM3Css(): Promise<M3CssFn>;
  loadAphrodyBun(): Promise<AphrodyBun>;
  findNativeTheme(start: string): string | undefined;
  readNativeTheme(path: string): { theme: NativeThemeExport; css: string };
  nativeThemeMatches(config: M3CssConfig, theme: NativeThemeExport): boolean;
}

// `@aphrody/m3` keeps its native bridge out of its export map: its `package.json` locates the module, and
// `@aphrody/bun` resolves from there because it is a dependency of `@aphrody/m3`, not of this package.
const bridgeFile = (): string =>
  join(dirname(Bun.resolveSync("@aphrody/m3/package.json", import.meta.dir)), "src", "native.ts");

let bridge: Promise<M3NativeBridge> | undefined;
const nativeBridge = (): Promise<M3NativeBridge> => (bridge ??= import(bridgeFile()) as Promise<M3NativeBridge>);

const usable = (mod: AphrodyBun): M3CssFn | undefined =>
  typeof mod.m3Css === "function" && mod.isAphrodyFfiAvailable?.() !== false ? mod.m3Css : undefined;

/** The Rust `m3Css`, or `undefined` when `@aphrody/bun` or its native library cannot be loaded on this host. */
export async function nativeM3Css(): Promise<M3CssFn | undefined> {
  try {
    return usable(await (await nativeBridge()).loadAphrodyBun());
  } catch {
    return undefined;
  }
}

export type M3CssEngine = "native" | "mcu";

/**
 * The sheet generator of an engine. `native` (default) serves the Rust artifacts: with `start`, the ThemeExport above
 * it for the theme it was exported for (`tokens` from its CSS, `scheme` from its roles), then `defaultM3Css` of
 * `@aphrody/m3` (the Rust `m3Css`, or the committed sheets of `@aphrody/m3-theme` for the default theme; any other
 * request then fails and names the missing library). `mcu` is {@link mcuM3Css}.
 */
export async function m3CssFor(engine: M3CssEngine = "native", start?: string): Promise<M3CssFn> {
  if (engine === "mcu") return mcuM3Css;
  if (engine !== "native") throw new Error(`m3-bun: unknown css engine ${String(engine)} (native, mcu)`);
  const native = await nativeBridge();
  const generate = await native.defaultM3Css();
  const artifact = start ? await themeArtifact(start) : undefined;
  if (!artifact) return generate;
  return config => {
    if (config.sheet === "tokens" && exportedFor(native, artifact, config)) return artifact.css;
    if (config.sheet === "scheme" && exportedFor(native, artifact, config))
      return exportedScheme(artifact.theme, config.dark);
    return generate(config);
  };
}

let syncNative: M3CssFn | null | undefined;

/** The Rust `m3Css` loaded synchronously (`require`), once per process; `null` when it is unavailable. */
function nativeSync(): M3CssFn | null {
  if (syncNative !== undefined) return syncNative;
  try {
    syncNative = usable(createRequire(bridgeFile())("@aphrody/bun") as AphrodyBun) ?? null;
  } catch {
    syncNative = null;
  }
  return syncNative;
}

/**
 * A synchronous `M3CssFn` for `m3Bun({ css })`: the Rust `m3Css` when the native library loads, else
 * {@link mcuM3Css}. Passing it is the caller's explicit choice of the TypeScript fallback.
 */
export const tsM3Css: M3CssFn = (config: M3CssConfig): string => (nativeSync() ?? mcuM3Css)(config);

interface ThemeArtifact {
  path: string;
  theme: NativeThemeExport;
  css: string;
}

/** The ThemeExport pair above `start` (`var/mirrors/design-sync/tokens.{json,css}`, or `$APHRODY_DESIGN_CORPUS`). */
async function themeArtifact(start: string): Promise<ThemeArtifact | undefined> {
  const native = await nativeBridge();
  const path = native.findNativeTheme(start);
  if (!path || !(await Bun.file(path).exists())) return undefined;
  return { path, ...native.readNativeTheme(path) };
}

const exportedFor = (native: M3NativeBridge, artifact: ThemeArtifact, config: M3CssConfig): boolean =>
  native.nativeThemeMatches({ ...config, sheet: "tokens" }, artifact.theme);

/**
 * The ThemeExport of the Rust token owner above `start`, validated against its CSS twin, when it was exported for
 * this seed, variant and contrast.
 */
export async function nativeThemeExport(
  start: string,
  theme: Omit<M3CssConfig, "sheet">,
): Promise<{ path: string; theme: NativeThemeExport } | undefined> {
  const artifact = await themeArtifact(start);
  if (!artifact || !exportedFor(await nativeBridge(), artifact, { ...theme, sheet: "tokens" })) return undefined;
  return { path: artifact.path, theme: artifact.theme };
}

const kebab = (role: string): string => role.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

/** A `scheme` sheet (one mode) from the roles of a ThemeExport, colours unchanged. */
export function exportedScheme(theme: NativeThemeExport, dark = false): string {
  const roles = Object.entries(theme[dark ? "dark" : "light"]).map(
    ([role, value]) => `  --md-sys-color-${kebab(role)}: ${value};`,
  );
  return [":root {", ...roles, "}", ""].join("\n");
}
