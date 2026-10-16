// SPDX-License-Identifier: Apache-2.0
// @aphrody/m3: the Material Design 3 framework for Bun. Bun-side API; the browser entries are
// `@aphrody/m3/react` (M3App) and `@aphrody/m3/lit` (vanilla / Lit registration).
export { buildM3, rewriteHtmlReference, TAURI_LAYOUT } from "./build.js";
export type {
  BuildM3Options,
  BuildM3Output,
  BuildM3Result,
  BuildM3Tauri,
} from "./build.js";
export {
  CONFIG_FILES,
  defineM3Config,
  findM3Config,
  loadM3Config,
  resolveM3Config,
} from "./config.js";
export type {
  M3Config,
  M3TauriConfig,
  M3ThemeConfig,
  ResolvedM3Config,
} from "./config.js";
export { cssRequest, normalizeVariant } from "./native.js";
export { createM3Project } from "./new.js";
export type { M3CssConfig, M3CssFn, M3Sheet } from "./native.js";
export {
  findRepoRoot,
  fontLayout,
  fontPaths,
  M3_FONTS_UPSTREAM_DIR,
  resolveRepoRoot,
  SANS_FLEX_DIR,
  SYMBOL_STYLES,
  SYMBOLS_DIR,
} from "./paths.js";
export type { SymbolStyle } from "./paths.js";
export {
  fontsCss,
  M3_MODULES,
  M3_NAMESPACE,
  m3Plugin,
  SHEET_MODULES,
  SYMBOL_MODULES,
} from "./plugin.js";
export type { M3PluginOptions } from "./plugin.js";
export {
  buildRoutes,
  createProxy,
  fileRoutes,
  proxyRoutes,
  resolvePort,
  serveM3,
} from "./server.js";
export type { M3PageProps, M3RouteValue, ServeM3Options } from "./server.js";
export { BUNDLE_FILES, m3Tokens, SHEETS, writeTokenBundle } from "./tokens.js";
export type { M3TokensOptions, TokenBundleOptions } from "./tokens.js";
export {
  dataUrlFor,
  FILE_URL_EXTENSIONS,
  mimeFor,
  urlImportForm,
} from "./url-imports.js";
export * from "./i18n.js";
