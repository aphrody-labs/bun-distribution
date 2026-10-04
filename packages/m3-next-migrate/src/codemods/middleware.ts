// SPDX-License-Identifier: Apache-2.0
// middleware.ts -> proxy.ts (Next 16 renames the file convention and the exported function; the proxy runs on the
// Node.js runtime, so the edge runtime flag has to go).
import { type CodemodResult, unchanged } from "./types";

/** `middleware.ts`, `src/middleware.js`, ... but not `app/middleware.ts` or `lib/middleware.ts`. */
export const isMiddlewareFile = (path: string): boolean =>
  /^(src\/)?middleware\.(ts|js|mts|mjs|cts|cjs)$/.test(path);

export function middlewareToProxy(source: string, path: string): CodemodResult {
  let code = source;
  const changes: string[] = [];
  const warnings: string[] = [];

  const before = code;
  code = code
    .replace(/(\bexport\s+(?:default\s+)?(?:async\s+)?function\s+)middleware\b/g, "$1proxy")
    .replace(/(\bexport\s+(?:const|let|var)\s+)middleware\b/g, "$1proxy")
    .replace(/\bexport\s*\{([^}]*)\}/g, (all, names: string) =>
      all.replace(names, names.replace(/\bmiddleware\b/g, "proxy")),
    )
    .replace(/(\bexport\s+default\s+)middleware\b(?!\s*\()/g, "$1proxy");
  if (code !== before) changes.push("renamed the exported function middleware -> proxy");

  // Declarations that the export refers to (`function middleware() {}` then `export { middleware }`).
  if (/\bfunction\s+middleware\b/.test(code) && /\bexport\s*\{[^}]*\bproxy\b/.test(code)) {
    code = code.replace(/\bfunction\s+middleware\b/g, "function proxy");
  }

  const edge = /^[ \t]*export\s+const\s+runtime\s*=\s*(["'`])edge\1\s*;?[ \t]*\n?/m;
  if (edge.test(code)) {
    code = code.replace(edge, "");
    changes.push('removed `export const runtime = "edge"` (proxy runs on the Node.js runtime)');
  }
  if (/\bNextFetchEvent\b/.test(code))
    warnings.push(
      "NextFetchEvent: proxy takes (request) only; move waitUntil work to after() from next/server",
    );
  if (/\bexperimental-edge\b/.test(code))
    warnings.push("the edge runtime is not available in proxy.ts");

  const rename = path.replace(/middleware(\.[cm]?[jt]s)$/, "proxy$1");
  changes.push(`${path} -> ${rename}`);
  return code === source && rename === path
    ? unchanged(source)
    : { code, changes, warnings, rename };
}
