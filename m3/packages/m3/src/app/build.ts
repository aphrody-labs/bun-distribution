// SPDX-License-Identifier: Apache-2.0
// Production build of an `app/` directory, in three Bun.build passes:
//   1. rsc    — server components with the `react-server` condition; collects the client
//               references and the CSS imported by server modules.
//   2. client — the browser runtime plus one entry per client module (code splitting, ESM).
//   3. ssr    — the client modules again for server rendering, with the HTML runtime.
// Output (`outDir`): client/ (served at /_m3/), server/rsc, server/ssr, static/ and manifest.json.
import type { BunPlugin } from "bun";
import { cpSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { appPlugin, moduleDirective, moduleId, registerModule, type ReferenceMap } from "./plugin";
import { scanApp, type AppTree } from "./scan";

export interface AppBuildOptions {
  /** Project root (contains `app/`). */
  root: string;
  /** App directory relative to the root (default `app`, or `src/app` when present). */
  appDir?: string;
  /** Output directory (default `<root>/dist`). */
  outDir?: string;
  /** Development build: no minification, development React, inline source maps. */
  dev?: boolean;
  /** Extra plugins for the browser build (Tailwind, Sass, m3 virtual modules). */
  clientPlugins?: BunPlugin[];
  /** Extra plugins for both server builds. */
  serverPlugins?: BunPlugin[];
  /** Build id (default: a timestamp). Clients reload when it changes. */
  buildId?: string;
  /** `define` for every layer (`process.env.NODE_ENV` is set from `dev`). */
  define?: Record<string, string>;
  /** Map `next/*` imports to m3 (default true). */
  nextCompat?: boolean;
}

/** `manifest.json` of a build, read by the host. */
export interface AppManifest {
  version: 1;
  buildId: string;
  /** Browser runtime entry, relative to `client/`. */
  bootstrap: string;
  /** Stylesheets linked by every page, relative to `client/`. */
  css: string[];
  /** Browser bundles of each client module id, relative to `client/`. */
  clientModules: Record<string, string[]>;
  /** Server entries, relative to the output directory. */
  rscEntry: string;
  ssrEntry: string;
  /** `public/` and static metadata files: URL path to file relative to the output directory. */
  static: Record<string, string>;
  routes: { pattern: string; kind: "page" | "route" }[];
  /** The app has a middleware (`proxy.ts`): prerendered pages are not served before it. */
  middleware: boolean;
}

export interface AppBuildResult {
  manifest: AppManifest;
  outDir: string;
  tree: AppTree;
}

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", ".turbo", "out", "coverage"]);
const RUNTIME = join(import.meta.dir, "runtime");
const toPosix = (path: string) => path.replaceAll("\\", "/");
const js = (value: unknown) => JSON.stringify(value);

/** The app directory: `app/`, or `src/app/` when only that exists. */
export function resolveAppDir(root: string, appDir?: string): string {
  if (appDir) return appDir;
  if (!existsSync(join(root, "app")) && existsSync(join(root, "src", "app"))) return "src/app";
  return "app";
}

/** `"use server"` modules of the project sources (actions imported only by client modules too). */
export async function findServerModules(root: string, outDir: string): Promise<string[]> {
  const found: string[] = [];
  const glob = new Bun.Glob("**/*.{ts,tsx,js,jsx,mjs,mts}");
  const out = toPosix(relative(root, outDir));
  for await (const file of glob.scan({ cwd: root, onlyFiles: true })) {
    const rel = toPosix(file);
    const first = rel.split("/")[0]!;
    if (SKIP_DIRS.has(first) || rel.startsWith(`${out}/`) || rel.split("/").some(p => p === "node_modules")) continue;
    const abs = join(root, file);
    const source = await Bun.file(abs).text();
    if (source.includes("use server") && moduleDirective(source) === "server") found.push(abs);
  }
  return found;
}

function logs(result: Bun.BuildOutput, layer: string): void {
  if (result.success) return;
  const message = result.logs
    .map(l =>
      typeof l === "object" && l !== null
        ? `${l.name ?? ""}: ${l.message ?? ""} at ${JSON.stringify(l.position ?? {})}`
        : String(l),
    )
    .join("\n");
  throw new Error(`@aphrody/m3: ${layer} build failed\n${message}`);
}

/** Virtual entry modules served by a small plugin (namespace `m3-entry`). */
function entryPlugin(entries: Map<string, string>, resolveDir: string): BunPlugin {
  return {
    name: "@aphrody/m3/app:entries",
    setup(build) {
      build.onResolve({ filter: /^m3-entry\// }, args => ({
        path: args.path.slice("m3-entry/".length),
        namespace: "m3-entry",
      }));
      build.onLoad({ filter: /.*/, namespace: "m3-entry" }, args => {
        const contents = entries.get(args.path);
        if (contents === undefined) throw new Error(`@aphrody/m3: unknown entry ${args.path}`);
        return { contents, loader: "tsx", resolveDir };
      });
    },
  };
}

function rscEntry(tree: AppTree, serverModules: readonly string[], buildId: string): string {
  const root = tree.root;
  const ids = new Set<string>();
  for (const route of tree.routes) {
    ids.add(route.file);
    for (const segment of route.segments) for (const file of Object.values(segment.files)) if (file) ids.add(file);
  }
  for (const file of Object.values(tree.rootSegment.files)) if (file) ids.add(file);
  for (const meta of tree.metadata) if (meta.kind !== "static") ids.add(meta.file);
  if (tree.middleware) ids.add(tree.middleware);
  const actions = serverModules.map(abs => moduleId(root, abs));
  for (const id of actions) ids.add(id);
  const loaders = [...ids].map(id => `  ${js(id)}: () => import(${js(toPosix(join(root, id)))}),`).join("\n");
  const runtime = js(toPosix(join(RUNTIME, "rsc.tsx")));
  return [
    `import { setApp } from ${runtime};`,
    `export * from ${runtime};`,
    `export function registerRsc() {`,
    `  setApp({`,
    `    buildId: ${js(buildId)},`,
    `    routes: ${js(tree.routes)},`,
    `    metadata: ${js(tree.metadata)},`,
    `    rootSegment: ${js(tree.rootSegment)},`,
    `    middleware: ${js(tree.middleware)},`,
    `    actions: ${js(actions)},`,
    `    loaders: {\n${loaders}\n    },`,
    `  });`,
    `}`,
    `registerRsc();`,
  ].join("\n");
}

function ssrEntry(root: string, clientRefs: ReferenceMap): string {
  const runtime = js(toPosix(join(RUNTIME, "ssr.tsx")));
  const loaders = [...clientRefs.keys()]
    .map(id => `  ${js(id)}: () => import(${js(toPosix(join(root, id)))}),`)
    .join("\n");
  return [
    `import { setClientModules } from ${runtime};`,
    `export * from ${runtime};`,
    `export function registerSsr() {`,
    `  setClientModules({\n${loaders}\n  });`,
    `}`,
    `registerSsr();`,
  ].join("\n");
}

/** Build the app. */
export async function buildApp(options: AppBuildOptions): Promise<AppBuildResult> {
  const root = options.root;
  const appDir = resolveAppDir(root, options.appDir);
  const outDir = options.outDir ?? join(root, "dist");
  const dev = options.dev ?? false;
  const buildId = options.buildId ?? Date.now().toString(36);
  const tree = scanApp(root, appDir);
  const define = { "process.env.NODE_ENV": js(dev ? "development" : "production"), ...options.define };
  const mediaDir = join(outDir, "client", "media");
  const shared = { root, nextCompat: options.nextCompat, mediaDir, mediaUrl: "/_m3/media" };

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  // 1. rsc
  const clientRefs: ReferenceMap = new Map();
  const serverRefs: ReferenceMap = new Map();
  const cssFiles = new Set<string>();
  const serverModules = await findServerModules(root, outDir);
  const entries = new Map<string, string>([["rsc", rscEntry(tree, serverModules, buildId)]]);
  const rsc = await Bun.build({
    entrypoints: ["m3-entry/rsc"],
    root,
    outdir: join(outDir, "server", "rsc"),
    target: "bun",
    format: "esm",
    splitting: true,
    conditions: ["react-server"],
    naming: { entry: "[name].[ext]", chunk: "[name]-[hash].[ext]", asset: "[name]-[hash].[ext]" },
    sourcemap: dev ? "inline" : "linked",
    minify: !dev,
    define,
    plugins: [
      entryPlugin(entries, root),
      appPlugin({ ...shared, layer: "rsc", clientRefs, serverRefs, cssFiles }),
      ...(options.serverPlugins ?? []),
    ],
    throw: false,
  });
  logs(rsc, "rsc");

  // 2. client + 3. ssr
  const clientIds = [...clientRefs.keys()];
  const clientEntries = new Map<string, string>([["boot", `import ${js(toPosix(join(RUNTIME, "client.tsx")))};`]]);
  clientIds.forEach((id, i) => clientEntries.set(`c${i}`, registerModule(id, join(root, id))));
  [...cssFiles].forEach((file, i) => clientEntries.set(`s${i}`, `import ${js(toPosix(file))};`));
  entries.set("ssr", ssrEntry(root, clientRefs));

  const [client, ssr] = await Promise.all([
    Bun.build({
      entrypoints: [...clientEntries.keys()].map(name => `m3-entry/${name}`),
      root,
      outdir: join(outDir, "client"),
      target: "browser",
      format: "esm",
      splitting: true,
      naming: { entry: "[name]-[hash].[ext]", chunk: "chunk-[hash].[ext]", asset: "[name]-[hash].[ext]" },
      sourcemap: dev ? "inline" : "linked",
      minify: !dev,
      define,
      plugins: [
        entryPlugin(clientEntries, root),
        appPlugin({ ...shared, layer: "client", serverRefs }),
        ...(options.clientPlugins ?? []),
      ],
      throw: false,
    }),
    Bun.build({
      entrypoints: ["m3-entry/ssr"],
      root,
      outdir: join(outDir, "server", "ssr"),
      target: "bun",
      format: "esm",
      splitting: true,
      naming: { entry: "[name].[ext]", chunk: "[name]-[hash].[ext]", asset: "[name]-[hash].[ext]" },
      sourcemap: dev ? "inline" : "linked",
      minify: !dev,
      define,
      plugins: [
        entryPlugin(entries, root),
        appPlugin({ ...shared, layer: "ssr", serverRefs }),
        ...(options.serverPlugins ?? []),
      ],
      throw: false,
    }),
  ]);
  logs(client, "client");
  logs(ssr, "ssr");

  const clientDir = join(outDir, "client");
  const entryFile = (name: string) => {
    const output = client.outputs.find(
      o => o.kind === "entry-point" && basename(o.path).startsWith(`${name}-`) && o.path.endsWith(".js"),
    );
    if (!output) throw new Error(`@aphrody/m3: client entry ${name} missing from the build output`);
    return toPosix(relative(clientDir, output.path));
  };
  const clientModules: Record<string, string[]> = {};
  clientIds.forEach((id, i) => (clientModules[id] = [entryFile(`c${i}`)]));
  const css = client.outputs.filter(o => o.path.endsWith(".css")).map(o => toPosix(relative(clientDir, o.path)));

  const staticFiles: Record<string, string> = {};
  const publicDir = join(root, "public");
  if (existsSync(publicDir) && statSync(publicDir).isDirectory()) {
    cpSync(publicDir, join(outDir, "static"), { recursive: true });
    for await (const file of new Bun.Glob("**/*").scan({ cwd: publicDir, onlyFiles: true }))
      staticFiles[`/${toPosix(file)}`] = `static/${toPosix(file)}`;
  }
  for (const meta of tree.metadata) {
    if (meta.kind !== "static") continue;
    const target = join(outDir, "static", basename(meta.file));
    mkdirSync(join(outDir, "static"), { recursive: true });
    cpSync(join(root, meta.file), target);
    staticFiles[meta.pathname] = `static/${basename(meta.file)}`;
  }

  const manifest: AppManifest = {
    version: 1,
    buildId,
    bootstrap: entryFile("boot"),
    css,
    clientModules,
    rscEntry: "server/rsc/rsc.js",
    ssrEntry: "server/ssr/ssr.js",
    static: staticFiles,
    routes: tree.routes.map(r => ({ pattern: r.pattern, kind: r.kind })),
    middleware: !!tree.middleware,
  };
  await Bun.write(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  return { manifest, outDir, tree };
}
