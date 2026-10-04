// SPDX-License-Identifier: Apache-2.0
// @aphrody/m3-bun: build, serve, compile, package and deploy configs of M3 apps, with one Bun plugin.
export { createM3App, dirSource, embeddedSource, startM3Server, DEFAULT_CSP, cacheControl, pickEncoding, resolvePort } from "./server.ts";
export type { FileSource, M3App as M3AppHandle, M3AppOptions, M3ServerOptions } from "./server.ts";
export { defineM3Api, normalizeApi, routesToFetch } from "./api.ts";
export type { M3ApiModule, M3Handler, M3Methods, M3Request, M3Route, M3Routes } from "./api.ts";
export { COMPILE_TARGETS, compileTarget, defineM3Bun, findWorkspaceRoot, loadApp } from "./config.ts";
export type { CompileTargetName, M3App, M3BunConfig, M3BunDeploy } from "./config.ts";
export { m3Bun, m3BunExtras } from "./plugin.ts";
export type { M3BunPluginOptions } from "./plugin.ts";
export { tsM3Css } from "./theme-css.ts";
export { iconsRoot, parseIconSpecifier, readIcon } from "./icons.ts";
export { buildApp, hoistHtml, listBuild, minifyOptions, readManifest } from "./build.ts";
export type { BuildAppOptions, BuildManifest, BuildReport, MinifyLevel } from "./build.ts";
export { compileApp, defaultOutfile, renderEntry } from "./compile.ts";
export type { CompileOptions, CompileReport } from "./compile.ts";
export { archiveDir, buildRootfs, packageApp, parseLdd } from "./package.ts";
export type { PackageOptions, PackageReport, RootfsReport } from "./package.ts";
export { launch, runtimeSdkPath, smoke } from "./runtime.ts";
export type { LaunchOptions, Launched, SmokeReport } from "./runtime.ts";
export { runApp } from "./entry.ts";
export { TARGETS, contextFor, generateTargets, getTarget } from "./targets/index.ts";
export type { GeneratedTarget, Target, TargetContext } from "./targets/index.ts";
