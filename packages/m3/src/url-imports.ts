// SPDX-License-Identifier: Apache-2.0
// Vite-style `?url` imports, ported from `drive/apps/web/url-plugin.ts`. Bun has no query-suffix
// loaders, so the asset is inlined as a data URL. `.scss` sources loaded this way are plain CSS
// with `//` line comments, which are stripped; anything else is passed through byte for byte.
import type { PluginBuilder } from "bun";
import { readFile } from "node:fs/promises";
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
  let bytes = new Uint8Array(await readFile(path));
  if (extname(path).toLowerCase() === ".scss") {
    const css = new TextDecoder().decode(bytes).replace(/^\s*\/\/.*$/gm, "");
    bytes = new TextEncoder().encode(css);
  }
  return `data:${mimeFor(path)};base64,${Buffer.from(bytes).toString("base64")}`;
}

/** Register the `?url` resolver and loader on a plugin builder. */
export function setupUrlImports(build: PluginBuilder): void {
  build.onResolve({ filter: /\?url$/ }, (args) => {
    const spec = args.path.slice(0, -URL_SUFFIX.length);
    return {
      path: isAbsolute(spec) ? spec : resolve(dirname(args.importer), spec),
      namespace: URL_NAMESPACE,
    };
  });
  build.onLoad({ filter: /.*/, namespace: URL_NAMESPACE }, async (args) => ({
    contents: `export default ${JSON.stringify(await dataUrlFor(args.path))};`,
    loader: "js",
  }));
}
