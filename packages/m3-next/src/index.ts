// SPDX-License-Identifier: Apache-2.0
// @aphrody/m3-next: Next.js 16 App Router integration for the Material Design 3 layer.
//
// This entry is safe in every runtime (next.config, Server Components, Client Components, edge):
// it holds the config wrapper, the metadata / viewport helpers and the pure scheme helpers.
// React Server Components live in `@aphrody/m3-next/server`, the client boundary in
// `@aphrody/m3-next/client`.
import type { Metadata, NextConfig, Viewport } from "next";
import {
  schemeFromSeed,
  type ColorRoleMap,
  type SchemeVariant,
} from "@aphrody/m3-tokens/dynamic-color";

import {
  M3_BASELINE_SEED,
  M3_THEME_COOKIE,
  validateThemeCookieName,
  type M3ThemeMode,
} from "./constants";

export type { ColorRoleMap, SchemeVariant };
export * from "./constants";
// Crawler-facing files: sitemap.xml, robots.txt, llms.txt and a script-safe JSON-LD serializer.
export * from "./crawl";

/**
 * The published M3 packages a Next app compiles from source. They ship modern ESM with
 * `'use client'` boundaries and CSS side effects, so Next must bundle them (never externalise).
 */
export const M3_TRANSPILE_PACKAGES: readonly string[] = [
  "@aphrody/m3-next",
  "@aphrody/m3-baseui",
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
  "@aphrody/m3-baseui",
  "@base-ui/react",
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

/** Tauri static export (`output: "export"`); see {@link WithM3Options.tauri}. */
export interface M3TauriOptions {
  /** Dev server host the webview loads assets from; default `TAURI_DEV_HOST`, else none (desktop uses `localhost`). */
  devHost?: string;
  /** Dev server port (default 3000). */
  devPort?: number;
}

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
  /** React Compiler (`reactCompiler`); needs `babel-plugin-react-compiler` installed in the app. */
  reactCompiler?: boolean;
  /** Cache Components (`cacheComponents`): `use cache`, `cacheLife`, `cacheTag` and partial prerendering. */
  cacheComponents?: boolean;
  /** Typed routes (`typedRoutes`): `Link` hrefs and `redirect` are checked against `app/`. */
  typedRoutes?: boolean;
  /**
   * Static export for a Tauri webview: `output: "export"`, unoptimized images, trailing slashes, no Cache
   * Components, and `NEXT_PUBLIC_M3_STATIC=1` so `M3Html` / `M3Root` stop reading the request cookie (there is no server).
   * `true` always, `"auto"` when the Tauri CLI runs the build (`TAURI_ENV_PLATFORM` is set), or the options.
   * `proxy.ts`, route handlers and `cookies()` do not exist in an export; the theme preference lives in the cookie
   * the client writes and the pre-paint script reads.
   */
  tauri?: boolean | "auto" | M3TauriOptions;
}

function union(...lists: (readonly string[] | undefined)[]): string[] {
  return [...new Set(lists.flatMap((list) => list ?? []))];
}

/** `true` when the Tauri CLI drives this process (it sets `TAURI_ENV_PLATFORM` for `beforeBuildCommand` and `beforeDevCommand`). */
export function isTauriBuild(env: Record<string, string | undefined> = process.env): boolean {
  return env["TAURI_ENV_PLATFORM"] !== undefined || env["TAURI_ENV_ARCH"] !== undefined;
}

/**
 * Wrap a Next config for the M3 packages: transpile them, keep `@aphrody/bun` external on the
 * server, optimise barrel imports and enable React strict mode. User values are merged, never
 * dropped (an option never overrides a key the config sets); Turbopack (the Next 16 default for dev and
 * build) needs no loader for the M3 sheets because they are plain CSS processed by the app's PostCSS /
 * Tailwind v4 pipeline.
 */
export function withM3(config: NextConfig = {}, options: WithM3Options = {}): NextConfig {
  const { optimizePackageImports = true, turbopackRoot } = options;
  const transpile = union(
    config.transpilePackages,
    M3_TRANSPILE_PACKAGES,
    options.transpilePackages,
  );
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
      optimizePackageImports: union(
        config.experimental?.optimizePackageImports,
        M3_OPTIMIZE_PACKAGE_IMPORTS,
      ),
    };
  }
  if (turbopackRoot !== undefined || config.turbopack !== undefined) {
    next.turbopack = {
      ...config.turbopack,
      ...(turbopackRoot !== undefined ? { root: turbopackRoot } : {}),
    };
  }
  if (options.reactCompiler !== undefined) next.reactCompiler ??= options.reactCompiler;
  if (options.typedRoutes !== undefined) next.typedRoutes ??= options.typedRoutes;
  if (options.cacheComponents !== undefined) next.cacheComponents ??= options.cacheComponents;

  const tauri = options.tauri === "auto" ? isTauriBuild() : options.tauri;
  if (tauri !== undefined && tauri !== false) {
    const { devHost = process.env["TAURI_DEV_HOST"], devPort = 3000 }: M3TauriOptions =
      tauri === true ? {} : tauri;
    next.output ??= "export";
    next.trailingSlash ??= true;
    next.images = { unoptimized: true, ...config.images };
    // A static export has no server to render the shell on demand.
    if (config.cacheComponents === undefined) next.cacheComponents = false;
    next.env = { NEXT_PUBLIC_M3_STATIC: "1", ...config.env };
    if (devHost !== undefined && process.env["NODE_ENV"] !== "production")
      next.assetPrefix ??= `http://${devHost}:${devPort}`;
  }
  return next;
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
  for (const match of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g))
    vars[match[1]!] = match[2]!.trim();
  return vars;
}

/**
 * Inline script that applies the theme before first paint, so Tailwind `dark:` utilities and the M3 roles never
 * flash. It reads the preference cookie (`light`, `dark` or `system`; absent means `system`) and sets the `.dark` /
 * `.light` classes and `color-scheme` on `<html>`; `system` resolves `prefers-color-scheme`. Because the cookie is
 * read in the browser, the shell can stay static (Cache Components, Tauri static export) and still honour a saved
 * preference.
 */
export function colorSchemeScript(cookieName: string = M3_THEME_COOKIE): string {
  const name = JSON.stringify(`${validateThemeCookieName(cookieName)}=`);
  return (
    "(function(){try{var d=document.documentElement," +
    `p=${name},c=document.cookie.split(/;\\s*/).find(function(v){return v.indexOf(p)===0}),v=c?c.slice(p.length):"",m=/^(light|dark|system)$/.test(v)?v:"system";` +
    "if(m==='system'){var s=window.matchMedia('(prefers-color-scheme: dark)').matches;" +
    "d.classList.remove('light');d.classList.toggle('dark',s);d.style.colorScheme=s?'dark':'light'}" +
    "else{d.classList.toggle('dark',m==='dark');d.classList.toggle('light',m==='light');d.style.colorScheme=m}" +
    "}catch(e){}})();"
  );
}

/** {@link colorSchemeScript} for the default cookie name. */
export const M3_COLOR_SCHEME_SCRIPT = colorSchemeScript();

/** Typefaces to map onto the M3 reference typefaces: a CSS `font-family` value or a `var(--font-...)` reference. */
export interface M3Typefaces {
  /** `--md-ref-typeface-brand`: display, headline and title-large. */
  brand?: string;
  /** `--md-ref-typeface-plain`: title, body and label. */
  plain?: string;
  /** `--md-ref-typeface-code`. */
  code?: string;
}

/**
 * The `:root` rule that points the M3 reference typefaces at the fonts an app loads, typically `next/font` variables:
 *
 *   const roboto = Roboto_Flex({ subsets: ["latin"], variable: "--font-roboto" });   // module scope, as next/font requires
 *   <M3Html className={roboto.variable} typefaces={{ brand: "var(--font-roboto)", plain: "var(--font-roboto)" }} />
 *
 * Values are CSS-escaped for a `<style>` element; an empty object yields an empty string.
 */
export function m3TypefaceCss(typefaces: M3Typefaces): string {
  const rules = (["brand", "plain", "code"] as const)
    .filter((role) => typefaces[role] !== undefined)
    .map((role) => {
      const value = typefaces[role]!.replace(/[<>{};]/g, "").trim();
      return `  --md-ref-typeface-${role}: ${value};`;
    });
  return rules.length > 0 ? `:root {\n${rules.join("\n")}\n}` : "";
}
