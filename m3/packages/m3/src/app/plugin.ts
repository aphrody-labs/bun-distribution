// SPDX-License-Identifier: Apache-2.0
// The Bun.build plugin of the App Router. One instance per layer:
//   rsc    — server components (`react-server` condition): `"use client"` modules become client
//            references, `"use server"` modules register their exports as server actions.
//   ssr    — client components rendered to HTML: `"use server"` modules become action stubs.
//   client — the browser bundle: `"use server"` modules become action stubs.
// It also maps `next/*` imports to the m3 equivalents and turns static image imports into
// `{ src, width, height }` objects whose files are emitted next to the client assets.
import type { BunPlugin, PluginBuilder } from "bun";
import { mkdirSync, copyFileSync } from "node:fs";
import { basename, dirname, extname, join, relative } from "node:path";
import { imageSize } from "./image-size";

const toPosix = (path: string) => path.replaceAll("\\", "/");

export type Layer = "rsc" | "ssr" | "client";

/** Module ids (project-relative paths) mapped to their export names. */
export type ReferenceMap = Map<string, string[]>;

export interface AppPluginOptions {
  layer: Layer;
  /** Project root; module ids are paths relative to it. */
  root: string;
  /** Collected `"use client"` modules reached from the rsc layer. */
  clientRefs?: ReferenceMap;
  /** Collected `"use server"` modules. */
  serverRefs?: ReferenceMap;
  /** Map `next/link`, `next/navigation`, ... to `@aphrody/m3/app/*` (default true). */
  nextCompat?: boolean;
  /** Directory receiving imported images (served under `mediaUrl`). */
  mediaDir?: string;
  /** Public URL of `mediaDir`. */
  mediaUrl?: string;
  /** Server layers: CSS imported by server modules, collected for the client build (absolute paths). */
  cssFiles?: Set<string>;
}

/** `next/*` specifiers and the m3 modules replacing them (the rsc layer uses `.server` variants when present). */
export const NEXT_COMPAT: Readonly<Record<string, string>> = {
  "next/link": "link.tsx",
  "next/navigation": "navigation.ts",
  "next/headers": "headers.ts",
  "next/server": "server.ts",
  "next/image": "image.tsx",
  "next/cache": "cache.ts",
};
const SERVER_VARIANTS: Readonly<Record<string, string>> = { "navigation.ts": "navigation.server.ts" };

/** Absolute path of a react-server-dom-parcel entry, resolved from this package. */
const rsd = (entry: "server.node" | "client.browser" | "client.edge") =>
  toPosix(Bun.resolveSync(`react-server-dom-parcel/${entry}`, import.meta.dir));

/** Registry shared by the bundles of one realm (`parcelRequire` reads it). */
export const MODULES_KEY = "@aphrody/m3/app/modules";
const REGISTER = `(globalThis[Symbol.for(${JSON.stringify(MODULES_KEY)})] ??= new Map())`;

/** Module registering the namespace of `path` under `id` (client and ssr entries). */
export function registerModule(id: string, path: string): string {
  return `import * as __m3_ns from ${JSON.stringify(toPosix(path))};
${REGISTER}.set(${JSON.stringify(id)}, __m3_ns);
`;
}

/** `"use client"` / `"use server"` when it is a directive of the module prologue. */
export function moduleDirective(source: string): "client" | "server" | undefined {
  let i = 0;
  const n = source.length;
  for (;;) {
    while (i < n && /\s/.test(source[i]!)) i++;
    if (source.startsWith("//", i)) {
      const end = source.indexOf("\n", i);
      i = end === -1 ? n : end + 1;
      continue;
    }
    if (source.startsWith("/*", i)) {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (source.startsWith("#!", i) && i === 0) {
      const end = source.indexOf("\n");
      i = end === -1 ? n : end + 1;
      continue;
    }
    const quote = source[i];
    if (quote !== '"' && quote !== "'") return undefined;
    const end = source.indexOf(quote, i + 1);
    if (end === -1) return undefined;
    const value = source.slice(i + 1, end);
    if (value === "use client") return "client";
    if (value === "use server") return "server";
    i = end + 1;
    while (i < n && (source[i] === " " || source[i] === "\t")) i++;
    if (source[i] === ";") i++;
  }
}

const LOADERS: Record<string, "tsx" | "ts" | "jsx" | "js"> = {
  ".tsx": "tsx",
  ".ts": "ts",
  ".mts": "ts",
  ".cts": "ts",
  ".jsx": "jsx",
  ".js": "js",
  ".mjs": "js",
  ".cjs": "js",
};

const transpilers = new Map<string, Bun.Transpiler>();
/** Export names of a module (ESM `export` statements). */
export function exportNames(source: string, path: string): string[] {
  const loader = LOADERS[extname(path)] ?? "tsx";
  let t = transpilers.get(loader);
  if (!t) transpilers.set(loader, (t = new Bun.Transpiler({ loader })));
  return t.scan(source).exports;
}

export const moduleId = (root: string, path: string) => toPosix(relative(root, path));

const IDENT = /^[A-Za-z_$][\w$]*$/;
const jsString = (value: string) => JSON.stringify(value);

/** rsc layer: replace a client module with references. */
export function clientReferenceModule(id: string, names: readonly string[]): string {
  const lines = [
    `import { createClientReference as __ref } from ${jsString(rsd("server.node"))};`,
    `const __bundles = (globalThis.__m3_client_bundles?.(${jsString(id)})) ?? [];`,
  ];
  for (const name of names) {
    const value = `__ref(${jsString(id)}, ${jsString(name)}, __bundles)`;
    if (name === "default") lines.push(`export default ${value};`);
    else if (IDENT.test(name)) lines.push(`export const ${name} = ${value};`);
  }
  return lines.join("\n");
}

/** ssr/client layers: replace an action module with references calling the server. */
export function serverStubModule(id: string, names: readonly string[], layer: "ssr" | "client"): string {
  const from = rsd(layer === "client" ? "client.browser" : "client.edge");
  const lines = [`import { createServerReference as __ref } from ${jsString(from)};`];
  for (const name of names) {
    const value = `__ref(${jsString(id)}, ${jsString(name)})`;
    if (name === "default") lines.push(`export default ${value};`);
    else if (IDENT.test(name)) lines.push(`export const ${name} = ${value};`);
  }
  return lines.join("\n");
}

/** rsc layer: keep an action module and register every function export. */
export function serverRegistration(id: string, path: string, names: readonly string[]): string {
  return [
    "",
    `import { registerServerReference as __m3_rsr } from ${jsString(rsd("server.node"))};`,
    `import * as __m3_self from ${jsString(`./${basename(path)}`)};`,
    `${REGISTER}.set(${jsString(id)}, __m3_self);`,
    `for (const __m3_name of ${JSON.stringify(names)}) {`,
    `  const __m3_fn = __m3_self[__m3_name];`,
    `  if (typeof __m3_fn === "function") __m3_rsr(__m3_fn, ${jsString(id)}, __m3_name);`,
    `}`,
  ].join("\n");
}

const IMAGE = /\.(png|jpe?g|gif|webp|avif|svg|ico)$/i;

export function appPlugin(options: AppPluginOptions): BunPlugin {
  const { layer, root } = options;
  return {
    name: `@aphrody/m3/app:${layer}`,
    setup(build: PluginBuilder) {
      if (options.nextCompat !== false) {
        build.onResolve({ filter: /^next\/(link|navigation|headers|server|image|cache)$/ }, args => {
          const file = NEXT_COMPAT[args.path]!;
          return { path: join(import.meta.dir, (layer === "rsc" && SERVER_VARIANTS[file]) || file) };
        });
      }

      if (layer !== "client") {
        // Server bundles never emit CSS: the rsc layer hands it to the client build, the ssr layer
        // reaches the same files through the client components built for the browser.
        build.onResolve({ filter: /\.(css|scss|sass)$/ }, args => {
          if (args.kind !== "import-statement" && args.kind !== "require-call") return undefined;
          let path: string;
          if (args.path.startsWith("m3:")) path = args.path;
          else if (args.path.startsWith(".") || args.path.startsWith("/"))
            path = join(dirname(args.importer), args.path);
          else {
            try {
              path = Bun.resolveSync(args.path, dirname(args.importer));
            } catch {
              return undefined;
            }
          }
          if (layer === "rsc") options.cssFiles?.add(path);
          return { path, namespace: "m3-css" };
        });
        build.onLoad({ filter: /.*/, namespace: "m3-css" }, () => ({ contents: "", loader: "js" }));
      }

      if (options.mediaDir && options.mediaUrl) {
        const mediaDir = options.mediaDir;
        const mediaUrl = options.mediaUrl.replace(/\/$/, "");
        build.onResolve({ filter: IMAGE }, args => {
          // CSS `url()` and HTML references keep Bun's own asset handling.
          if (args.kind !== "import-statement" && args.kind !== "dynamic-import" && args.kind !== "require-call")
            return undefined;
          if (!args.path.startsWith(".") && !args.path.startsWith("/")) return undefined;
          return { path: join(dirname(args.importer), args.path), namespace: "m3-image" };
        });
        build.onLoad({ filter: /.*/, namespace: "m3-image" }, async args => {
          const bytes = new Uint8Array(await Bun.file(args.path).arrayBuffer());
          const hash = Bun.hash(bytes).toString(36).slice(0, 8);
          const ext = extname(args.path);
          const name = `${basename(args.path, ext)}-${hash}${ext}`;
          mkdirSync(mediaDir, { recursive: true });
          copyFileSync(args.path, join(mediaDir, name));
          const size = imageSize(bytes, ext);
          const value = { src: `${mediaUrl}/${name}`, width: size?.width, height: size?.height };
          return { contents: `export default ${JSON.stringify(value)};`, loader: "js" };
        });
      }

      build.onLoad({ filter: /\.(m|c)?(j|t)sx?$/ }, async args => {
        if (args.namespace !== "file") return undefined;
        const source = await Bun.file(args.path).text();
        if (!source.includes("use client") && !source.includes("use server")) return undefined;
        const directive = moduleDirective(source);
        if (!directive) return undefined;
        const id = moduleId(root, args.path);
        const names = exportNames(source, args.path);
        if (directive === "client") {
          if (layer !== "rsc") return undefined;
          options.clientRefs?.set(id, names);
          return { contents: clientReferenceModule(id, names), loader: "js", resolveDir: dirname(args.path) };
        }
        options.serverRefs?.set(id, names);
        if (layer === "rsc") {
          const loader = LOADERS[extname(args.path)] ?? "tsx";
          return {
            contents: source + serverRegistration(id, args.path, names),
            loader,
            resolveDir: dirname(args.path),
          };
        }
        return { contents: serverStubModule(id, names, layer), loader: "js", resolveDir: dirname(args.path) };
      });
    },
  };
}
