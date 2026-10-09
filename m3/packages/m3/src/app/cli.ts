// SPDX-License-Identifier: Apache-2.0
// `m3 dev | build | start` in App Router mode (an `app/` directory, or `app` in m3.config.ts).
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { findM3Config, loadM3Config } from "../config";
import { m3Plugin } from "../plugin";
import { buildApp, resolveAppDir } from "./build";
import { devApp } from "./dev";
import { serveApp } from "./host";
import { prerenderApp } from "./prerender";

export interface AppProject {
  root: string;
  appDir: string;
  outDir: string;
  port?: number;
  define?: Record<string, string>;
  theme?: import("../config").M3ThemeConfig;
  fontsRoot?: string;
}

/** The App Router project at `cwd`, or `undefined` when the project uses an HTML entry. */
export async function findAppProject(cwd: string, configFile?: string): Promise<AppProject | undefined> {
  if (configFile || findM3Config(cwd)) {
    const config = await loadM3Config(cwd, configFile);
    if (!config.app) return undefined;
    return {
      root: config.dir,
      appDir: config.app,
      outDir: config.outdir,
      port: config.port,
      define: config.define,
      theme: config.theme,
      fontsRoot: config.root,
    };
  }
  const appDir = resolveAppDir(cwd);
  return existsSync(join(cwd, appDir)) ? { root: cwd, appDir, outDir: join(cwd, "dist") } : undefined;
}

const clientPlugins = (project: AppProject) => [
  m3Plugin({ theme: project.theme, root: project.fontsRoot, configDir: project.root }),
];

export interface AppCommandFlags {
  port?: number;
  outdir?: string;
  dev?: boolean;
  /** Skip static generation in `build`. */
  prerender?: boolean;
}

/** `m3 build` of an App Router project into `options.outDir`, with its console report. */
export async function buildAppProject(
  project: AppProject,
  options: { outDir: string; dev?: boolean; prerender?: boolean },
): Promise<void> {
  const { outDir } = options;
  const started = performance.now();
  const { manifest } = await buildApp({
    root: project.root,
    appDir: project.appDir,
    outDir,
    dev: options.dev === true,
    define: project.define,
    clientPlugins: clientPlugins(project),
  });
  const built = Math.round(performance.now() - started);
  console.log(
    `m3 build: ${manifest.routes.length} routes, ${Object.keys(manifest.clientModules).length} client modules in ${built} ms`,
  );
  if (options.prerender !== false) {
    const { pages, dynamic } = await prerenderApp(outDir);
    for (const page of pages) console.log(`  ○ ${page}`);
    for (const page of dynamic) console.log(`  λ ${page.path}  (${page.reason})`);
  }
  console.log(`m3 build: ${outDir} in ${Math.round(performance.now() - started)} ms`);
}

/** Run `dev`, `build` or `start` for an App Router project; resolves to the exit code. */
export async function runAppCommand(
  command: "dev" | "build" | "start",
  project: AppProject,
  flags: AppCommandFlags,
): Promise<number> {
  const outDir = flags.outdir ? resolve(project.root, flags.outdir) : project.outDir;
  const port = flags.port ?? (Bun.env.PORT ? undefined : project.port);
  if (command === "dev") {
    const started = performance.now();
    const dev = await devApp({
      root: project.root,
      appDir: project.appDir,
      port,
      clientPlugins: clientPlugins(project),
    });
    console.log(`m3 dev: ${dev.url} (ready in ${Math.round(performance.now() - started)} ms)`);
    return 0;
  }
  if (command === "build") {
    await buildAppProject(project, { outDir, dev: flags.dev, prerender: flags.prerender });
    return 0;
  }
  if (!existsSync(join(outDir, "manifest.json"))) throw new Error(`m3 start: no build in ${outDir} (run m3 build)`);
  const server = await serveApp({ outDir, port });
  console.log(`m3 start: ${server.url}`);
  return 0;
}
