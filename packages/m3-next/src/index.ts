// SPDX-License-Identifier: Apache-2.0
// @aphrody/m3-next: Next.js 16 App Router integration for the Material Design 3 layer.
//
// This entry is safe in every runtime (next.config, Server Components, Client Components, edge):
// it holds the config wrapper, the metadata / viewport helpers and the pure scheme helpers.
// React Server Components live in `@aphrody/m3-next/server`, the client boundary in
// `@aphrody/m3-next/client`.
import type { Metadata, NextConfig, Viewport } from "next";
import { schemeFromSeed, type ColorRoleMap, type SchemeVariant } from "@aphrody/m3-tokens/dynamic-color";

import { M3_BASELINE_SEED, type M3ThemeMode } from "./constants";

export type { ColorRoleMap, SchemeVariant };
export * from "./constants";

/**
 * The published M3 packages a Next app compiles from source. They ship modern ESM with
 * `'use client'` boundaries and CSS side effects, so Next must bundle them (never externalise).
 */
export const M3_TRANSPILE_PACKAGES: readonly string[] = [
  "@aphrody/m3-next",
  "@aphrody/m3-theme",
  "@aphrody/m3-tokens",
  "@aphrody/m3-motion",
  "@aphrody/m3-primitives",
  "@aphrody/m3-forms",
  "@aphrody/m3-ai",
  "@aphrody/m3-explorer",
  "@aphrody/m3-react",
  "@aphrody/material-web",
];

/** Barrel packages whose named imports Next rewrites to direct module imports. */
export const M3_OPTIMIZE_PACKAGE_IMPORTS: readonly string[] = [
  "@aphrody/m3-primitives",
  "@aphrody/m3-forms",
  "@aphrody/m3-ai",
  "@aphrody/m3-explorer",
  "@aphrody/m3-react",
];

/**
 * Server-only packages Next must load with the runtime `require` instead of bundling:
 * `@aphrody/bun` opens a native library through `bun:ffi`.
 */
export const M3_SERVER_EXTERNAL_PACKAGES: readonly string[] = ["@aphrody/bun"];

export interface WithM3Options {
  /** Extra packages to transpile next to {@link M3_TRANSPILE_PACKAGES}. */
  transpilePackages?: readonly string[];
  /** Rewrite barrel imports of the M3 component packages (default `true`). */
  optimizePackageImports?: boolean;
  /**
   * Turbopack project root. Set it to the workspace root in a monorepo whose packages live
   * outside the app directory (Next otherwise infers it from the nearest lockfile).
   */
  turbopackRoot?: string;
}

function union(...lists: (readonly string[] | undefined)[]): string[] {
  return [...new Set(lists.flatMap((list) => list ?? []))];
}

/**
 * Wrap a Next config for the M3 packages: transpile them, keep `@aphrody/bun` external on the
 * server, optimise barrel imports and enable React strict mode. User values are merged, never
 * dropped; Turbopack (the Next 16 default for dev and build) needs no loader for the M3 sheets
 * because they are plain CSS processed by the app's PostCSS / Tailwind v4 pipeline.
 */
export function withM3(config: NextConfig = {}, options: WithM3Options = {}): NextConfig {
  const { optimizePackageImports = true, turbopackRoot } = options;
  const transpile = union(config.transpilePackages, M3_TRANSPILE_PACKAGES, options.transpilePackages);
  const external = union(config.serverExternalPackages, M3_SERVER_EXTERNAL_PACKAGES).filter(
    (name) => !transpile.includes(name),
  );
  const next: NextConfig = {
    reactStrictMode: true,
    ...config,
    transpilePackages: transpile,
    serverExternalPackages: external,
  };
  if (optimizePackageImports) {
    next.experimental = {
      ...config.experimental,
      optimizePackageImports: union(config.experimental?.optimizePackageImports, M3_OPTIMIZE_PACKAGE_IMPORTS),
    };
  }
  if (turbopackRoot !== undefined || config.turbopack !== undefined) {
    next.turbopack = { ...config.turbopack, ...(turbopackRoot !== undefined ? { root: turbopackRoot } : {}) };
  }
  return next;
}

/** Parse a cookie value into a theme mode; anything else yields `fallback`. */
export function parseThemeMode(value: string | undefined | null, fallback: M3ThemeMode = "system"): M3ThemeMode {
  return value === "light" || value === "dark" || value === "system" ? value : fallback;
}

/** The `color-scheme` value for a mode: `system` lets the UA follow the OS. */
export function colorSchemeFor(mode: M3ThemeMode): "light" | "dark" | "light dark" {
  return mode === "system" ? "light dark" : mode;
}

export interface M3SchemeOptions {
  /** Source colour, `#rrggbb` (default {@link M3_BASELINE_SEED}). */
  seed?: string;
  /** Scheme variant (default `tonalSpot`). */
  variant?: SchemeVariant;
  /** Contrast level in `[-1, 1]` (default 0). */
  contrast?: number;
}

/** The M3 colour roles of one scheme, computed in JS (material-color-utilities). */
export function m3SchemeColors(options: M3SchemeOptions & { dark?: boolean } = {}): ColorRoleMap {
  const { seed = M3_BASELINE_SEED, variant = "tonalSpot", contrast = 0, dark = false } = options;
  return schemeFromSeed(seed, { dark, variant, contrastLevel: contrast });
}

/** The `theme-color` pair of a scheme: the `surface` role in light and in dark. */
export function m3ThemeColors(options: M3SchemeOptions = {}): { light: string; dark: string } {
  const surface = "--md-sys-color-surface";
  const light = m3SchemeColors({ ...options, dark: false })[surface];
  const dark = m3SchemeColors({ ...options, dark: true })[surface];
  if (!light || !dark) throw new Error("m3ThemeColors: the scheme has no surface role");
  return { light, dark };
}

export interface M3ViewportOptions extends M3SchemeOptions {
  /** Forced mode; `system` (default) emits one theme-color per `prefers-color-scheme`. */
  mode?: M3ThemeMode;
  /** Merged over the generated viewport. */
  viewport?: Viewport;
}

/**
 * A Next `Viewport` whose `theme-color` is the scheme surface and whose `color-scheme` matches
 * the mode. Use it as `export const viewport = generateM3Viewport({ seed })` or return it from
 * `generateViewport()` after reading the theme cookie.
 */
export function generateM3Viewport(options: M3ViewportOptions = {}): Viewport {
  const { mode = "system", viewport, ...scheme } = options;
  const colors = m3ThemeColors(scheme);
  const themeColor: Viewport["themeColor"] =
    mode === "system"
      ? [
          { media: "(prefers-color-scheme: light)", color: colors.light },
          { media: "(prefers-color-scheme: dark)", color: colors.dark },
        ]
      : colors[mode];
  return {
    width: "device-width",
    initialScale: 1,
    colorScheme: mode === "system" ? "light dark" : mode,
    themeColor,
    ...viewport,
  };
}

export interface M3MetadataOptions {
  /** Application name: the default title, the title template suffix and `applicationName`. */
  name: string;
  description?: string;
  /** Absolute site URL, the base of every relative metadata URL. */
  url?: string | URL;
  /** Merged over the generated metadata. */
  metadata?: Metadata;
}

/**
 * Baseline `Metadata` for an M3 app: `title.template` (`%s · name`), `applicationName`, the
 * `metadataBase`, an installable web-app capable flag and no automatic telephone links.
 */
export function generateM3Metadata(options: M3MetadataOptions): Metadata {
  const { name, description, url, metadata } = options;
  return {
    title: { default: name, template: `%s · ${name}` },
    applicationName: name,
    ...(description !== undefined ? { description } : {}),
    ...(url !== undefined ? { metadataBase: typeof url === "string" ? new URL(url) : url } : {}),
    appleWebApp: { capable: true, title: name, statusBarStyle: "default" },
    formatDetection: { telephone: false },
    ...metadata,
  };
}

function block(selector: string, vars: ColorRoleMap, colorScheme: string, indent = ""): string {
  const body = Object.entries(vars)
    .map(([name, value]) => `${indent}  ${name}: ${value};`)
    .join("\n");
  return `${indent}${selector} {\n${indent}  color-scheme: ${colorScheme};\n${body}\n${indent}}`;
}

/**
 * The stylesheet M3Html inlines: light roles on `:root`, dark roles under
 * `prefers-color-scheme: dark` unless `.light` forces light, dark roles on `:root.dark`, light
 * roles on `:root.light`. The class selectors outrank the `:root` blocks of `tokens.css`, so a
 * forced mode wins over the OS preference whatever the stylesheet order.
 */
export function m3SchemeStylesheet(light: ColorRoleMap, dark: ColorRoleMap): string {
  return [
    block(":root", light, "light"),
    `@media (prefers-color-scheme: dark) {\n${block(":root:not(.light)", dark, "dark", "  ")}\n}`,
    block(":root.dark", dark, "dark"),
    block(":root.light", light, "light"),
  ].join("\n\n");
}

/**
 * Custom-property declarations of the first `:root { ... }` block of a sheet (the Rust `scheme`
 * sheet is one such block). `color-scheme` is skipped: {@link m3SchemeStylesheet} writes it.
 */
export function rootDeclarations(css: string): ColorRoleMap {
  const body = /:root\s*\{([^}]*)\}/.exec(css.replace(/\/\*[\s\S]*?\*\//g, ""))?.[1];
  if (body === undefined) throw new Error("rootDeclarations: no :root block in the sheet");
  const vars: ColorRoleMap = {};
  for (const match of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) vars[match[1]!] = match[2]!.trim();
  return vars;
}

/**
 * Inline script for `system` mode: resolve `prefers-color-scheme` into the `.dark` class and the
 * `color-scheme` property before first paint, so Tailwind `dark:` utilities never flash.
 */
export const M3_COLOR_SCHEME_SCRIPT =
  "(function(){try{var d=document.documentElement;if(d.classList.contains('light'))return;" +
  "var m=window.matchMedia('(prefers-color-scheme: dark)').matches;" +
  "d.classList.toggle('dark',m);d.style.colorScheme=m?'dark':'light'}catch(e){}})();";
