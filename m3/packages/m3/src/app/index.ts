// SPDX-License-Identifier: Apache-2.0
// `@aphrody/m3/app`: the App Router of m3 — Next.js `app/` conventions with React Server Components,
// server actions, streaming SSR and static generation on Bun.build + Bun.serve.
export { buildApp, findServerModules, resolveAppDir } from "./build";
export type { AppBuildOptions, AppBuildResult, AppManifest } from "./build";
export { buildAppProject, findAppProject, runAppCommand } from "./cli";
export type { AppCommandFlags, AppProject } from "./cli";
export {
  compileAppRouter,
  DOCKER_BASE_IMAGE,
  dockerAppRouter,
  embeddedFiles,
  renderDockerfile,
  renderDockerServer,
  renderExecutableEntry,
} from "./compile";
export type {
  CompileAppRouterOptions,
  CompileAppRouterReport,
  DockerAppRouterOptions,
  DockerAppRouterReport,
  ExecutableEntryParams,
} from "./compile";
export { devApp } from "./dev";
export type { DevApp, DevAppOptions } from "./dev";
export { directorySource, embeddedSource, loadApp, loadAppSource, serveApp, serveEmbeddedApp } from "./host";
export type {
  AppHandler,
  AppSource,
  EmbeddedBuild,
  LoadAppOptions,
  ServeAppOptions,
  ServeEmbeddedAppOptions,
} from "./host";
export { appPlugin, moduleDirective, NEXT_COMPAT } from "./plugin";
export type { AppPluginOptions, Layer } from "./plugin";
export { prerenderApp } from "./prerender";
export type { PrerenderResult } from "./prerender";
export { fillPattern, findRoute, matchRoute, parsePattern, scanApp } from "./scan";
export type { AppRoute, AppTree, MetadataRoute, Params, Segment } from "./scan";
export type { Metadata, Viewport } from "./runtime/metadata";
