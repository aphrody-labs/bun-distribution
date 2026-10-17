// SPDX-License-Identifier: Apache-2.0
// Vite-style `?url` imports, ported from `drive/apps/web/url-plugin.ts`. Bun has no query-suffix
// loaders, so the plugin decides the form explicitly:
//   - `.svg` is emitted as a file asset (Bun's `file` loader; `fonts/<name>.svg` in Tauri builds).
//     Every `.svg` loaded by the bundle is forced to the `file` loader, so a plain `import("x.svg")`
//     of the same path shares that module and neither bunfig `[loader]` nor import order matters.
//   - anything else is inlined as a data URL. `.scss` sources loaded this way are plain CSS with
//     `//` line comments, which are stripped; other bytes are passed through unchanged.
// Inline modules keep the `?url` suffix in their namespaced path. Bun 1.4 deduplicates modules by
// path across namespaces: without the suffix, a `?url` module and a plain import of the same file
// raced, and whichever loaded first won for both (the app-ui build flipped between 247 and 640
// files).
import type { PluginBuilder } from "bun";
import { dirname, extname, isAbsolute, resolve } from "node:path";

export const URL_NAMESPACE = "m3-url";
const URL_SUFFIX = "?url";

const MIME: Record<string, string> = {
  ".css": "text/css",
  ".scss": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".txt": "text/plain",
};

/** MIME type used for the data URL of `path`. */
export function mimeFor(path: string): string {
  return MIME[extname(path).toLowerCase()] ?? "application/octet-stream";
}

/** The `data:` URL a `?url` import of `path` evaluates to. */
export async function dataUrlFor(path: string): Promise<string> {
  let bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
  if (extname(path).toLowerCase() === ".scss") {
    const css = new TextDecoder().decode(bytes).replace(/^\s*\/\/.*$/gm, "");
    bytes = new TextEncoder().encode(css);
  }
  return `data:${mimeFor(path)};base64,${Buffer.from(bytes).toString("base64")}`;
}

/** Extensions whose `?url` import is emitted as a file asset instead of a data URL. */
export const FILE_URL_EXTENSIONS: readonly string[] = [".svg"];

/** How a `?url` import of `path` is bundled. */
export function urlImportForm(path: string): "file" | "inline" {
  return FILE_URL_EXTENSIONS.includes(extname(path).toLowerCase()) ? "file" : "inline";
}

/** Register the `?url` resolver and loaders on a plugin builder. */
export function setupUrlImports(build: PluginBuilder): void {
  build.onResolve({ filter: /\?url$/ }, args => {
    const spec = args.path.slice(0, -URL_SUFFIX.length);
    const path = isAbsolute(spec) ? spec : resolve(dirname(args.importer), spec);
    if (urlImportForm(path) === "file") return { path };
    return { path: `${path}${URL_SUFFIX}`, namespace: URL_NAMESPACE };
  });
  build.onLoad({ filter: /.*/, namespace: URL_NAMESPACE }, async args => {
    const path = args.path.endsWith(URL_SUFFIX) ? args.path.slice(0, -URL_SUFFIX.length) : args.path;
    return {
      contents: `export default ${JSON.stringify(await dataUrlFor(path))};`,
      loader: "js",
    };
  });
  build.onLoad({ filter: /\.svg$/i, namespace: "file" }, async args => ({
    contents: await Bun.file(args.path).bytes(),
    loader: "file",
  }));
}
