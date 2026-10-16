// SPDX-License-Identifier: Apache-2.0
// Vercel: static output (the `m3-bun build` directory) plus the API as one function. The function reuses the
// app's Bun routes through `routesToFetch`, so the API is written once. `bunVersion` selects the Bun runtime.
// Copy the files into the project root; nothing is deployed from here.
import { GENERATED_NOTE, type GeneratedFile } from "../util.ts";
import type { Target, TargetContext } from "./types.ts";

export const vercelJson = (c: TargetContext) => ({
  $schema: "https://openapi.vercel.sh/vercel.json",
  bunVersion: "1.x",
  framework: null,
  installCommand: "bun install --frozen-lockfile",
  buildCommand: `${c.cli} build`,
  outputDirectory: c.outdir,
  rewrites: [
    ...(c.api ? [{ source: "/api/(.*)", destination: "/api" }] : []),
    { source: "/healthz", destination: "/api" },
    { source: "/((?!assets/|chunk-|api/).*)", destination: "/index.html" },
  ],
  headers: [
    {
      source: "/(.*)",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        {
          key: "Permissions-Policy",
          value: "camera=(), microphone=(), geolocation=()",
        },
      ],
    },
    {
      source: "/chunk-(.*)",
      headers: [
        { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
      ],
    },
    {
      source: "/index.html",
      headers: [{ key: "Cache-Control", value: "no-cache" }],
    },
  ],
});

export const apiFunction = (c: TargetContext): string => `// ${GENERATED_NOTE}
// Vercel function: the app's Bun routes as one fetch handler. Place at <project>/api/index.ts.
import { normalizeApi, routesToFetch } from "@aphrody/m3-bun/api";
${c.api ? `import api from ${JSON.stringify(`../${c.api}`)};` : "const api = {};"}

const handler = routesToFetch(normalizeApi(api).routes);

export default {
  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/healthz") return Response.json({ ok: true, name: ${JSON.stringify(c.name)}, version: ${JSON.stringify(c.version)} });
    return (await handler(request)) ?? new Response("Not Found", { status: 404 });
  },
};
`;

export const vercel: Target = {
  id: "vercel",
  title: "Vercel",
  description:
    "vercel.json (static output, SPA rewrites, headers, Bun runtime) and an api/index.ts function over the app's routes",
  generate(c): GeneratedFile[] {
    return [
      {
        path: "vercel.json",
        content: `${JSON.stringify(vercelJson(c), null, 2)}\n`,
      },
      { path: "api/index.ts", content: apiFunction(c) },
    ];
  },
};
