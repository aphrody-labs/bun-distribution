// SPDX-License-Identifier: Apache-2.0
// @aphrody/m3: the Material Design 3 framework for Bun. Bun-side API; the browser entries are
// `@aphrody/m3/react` (M3App) and `@aphrody/m3/lit` (vanilla / Lit registration).
export { buildM3, rewriteHtmlReference, TAURI_LAYOUT } from "./build";
export type { BuildM3Options, BuildM3Output, BuildM3Result, BuildM3Tauri } from "./build";
export {
  CONFIG_FILES,
  defineM3Config,
  findM3Config,
  loadM3Config,
  resolveM3Config,
} from "./config";
export type { M3Config, M3TauriConfig, M3ThemeConfig, ResolvedM3Config } from "./config";
export { cssRequest, normalizeVariant } from "./native";
export { createM3Project } from "./new";
export type { M3CssConfig, M3CssFn, M3Sheet } from "./native";
export {
  findRepoRoot,
  fontLayout,
  fontPaths,
  M3_FONTS_UPSTREAM_DIR,
  resolveRepoRoot,
  SANS_FLEX_DIR,
  SYMBOL_STYLES,
  SYMBOLS_DIR,
} from "./paths";
export type { SymbolStyle } from "./paths";
export {
  fontsCss,
  M3_MODULES,
  M3_NAMESPACE,
  m3Plugin,
  SHEET_MODULES,
  SYMBOL_MODULES,
} from "./plugin";
export type { M3PluginOptions } from "./plugin";
export { buildRoutes, createProxy, fileRoutes, proxyRoutes, resolvePort, serveM3 } from "./server";
export type { M3PageProps, M3RouteValue, ServeM3Options } from "./server";
export { BUNDLE_FILES, m3Tokens, SHEETS, writeTokenBundle } from "./tokens";
export type { M3TokensOptions, TokenBundleOptions } from "./tokens";
export { dataUrlFor, FILE_URL_EXTENSIONS, mimeFor, urlImportForm } from "./url-imports";
export * from "./i18n";
