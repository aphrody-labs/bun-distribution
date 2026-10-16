// SPDX-License-Identifier: Apache-2.0
// Cloudflare. Workers with static assets (`wrangler.jsonc`: the build directory is served by the platform, the
// Worker answers /api/* and /healthz through `routesToFetch`, SPA fallback on) and a Pages variant (`_headers`,
// `_redirects`, one catch-all function). The API is the same Bun routes module the other targets use; Workers
// cannot run Bun APIs, so a route that needs `Bun.file` or `bun:sqlite` must be rewritten for the Worker.
import { GENERATED_NOTE, type GeneratedFile } from "../util.ts";
import type { Target, TargetContext } from "./types.ts";

export const wranglerJsonc = (c: TargetContext): string => `// ${GENERATED_NOTE}
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": ${JSON.stringify(c.name)},
  "main": "src/worker.ts",
  "compatibility_date": "2026-10-01",
  "assets": {
    "directory": ${JSON.stringify(`./${c.outdir}`)},
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*", "/healthz"]
  }${c.domain ? `,\n  "routes": [{ "pattern": ${JSON.stringify(c.domain)}, "custom_domain": true }]` : ""}
}
`;

export const workerSource = (c: TargetContext): string => `// ${GENERATED_NOTE}
// Cloudflare Worker: /api/* and /healthz from the app's routes, everything else from the static assets.
import { normalizeApi, routesToFetch } from "@aphrody/m3-bun/api";
${c.api ? `import api from ${JSON.stringify(`../${c.api}`)};` : "const api = {};"}

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

const handler = routesToFetch(normalizeApi(api).routes);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/healthz") return Response.json({ ok: true, name: ${JSON.stringify(c.name)}, version: ${JSON.stringify(c.version)} });
    const response = await handler(request);
    return response ?? env.ASSETS.fetch(request);
  },
};
`;

export const pagesFunction = (c: TargetContext): string => `// ${GENERATED_NOTE}
// Cloudflare Pages Functions: functions/[[path]].ts answers /api/* and /healthz; static files are served by Pages first.
import { normalizeApi, routesToFetch } from "@aphrody/m3-bun/api";
${c.api ? `import api from ${JSON.stringify(`../${c.api}`)};` : "const api = {};"}

const handler = routesToFetch(normalizeApi(api).routes);

export const onRequest = async ({ request, next }: { request: Request; next(): Promise<Response> }): Promise<Response> => {
  const { pathname } = new URL(request.url);
  if (pathname === "/healthz") return Response.json({ ok: true, name: ${JSON.stringify(c.name)}, version: ${JSON.stringify(c.version)} });
  return (await handler(request)) ?? next();
};
`;

export const cloudflare: Target = {
  id: "cloudflare",
  title: "Cloudflare",
  description:
    "Workers with static assets (wrangler.jsonc, src/worker.ts) and a Pages variant (_headers, _redirects, functions/[[path]].ts)",
  generate(c): GeneratedFile[] {
    return [
      { path: "wrangler.jsonc", content: wranglerJsonc(c) },
      { path: "src/worker.ts", content: workerSource(c) },
      {
        path: "pages/_headers",
        content: `# ${GENERATED_NOTE}\n/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n/chunk-*\n  Cache-Control: public, max-age=31536000, immutable\n/index.html\n  Cache-Control: no-cache\n`,
      },
      {
        path: "pages/_redirects",
        content: `# ${GENERATED_NOTE}\n/* /index.html 200\n`,
      },
      { path: "pages/functions/[[path]].ts", content: pagesFunction(c) },
    ];
  },
};
