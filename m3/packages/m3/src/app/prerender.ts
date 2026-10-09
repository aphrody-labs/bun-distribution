// SPDX-License-Identifier: Apache-2.0
// Static generation: render every static page (and the `generateStaticParams` of dynamic ones) at
// build time. A page that reads request data (`cookies()`, `headers()`, `searchParams`,
// `connection()`) or exports `dynamic = "force-dynamic"` stays rendered per request.
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadApp } from "./host";

export interface PrerenderResult {
  /** Prerendered URL paths. */
  pages: string[];
  /** Pages left dynamic, with the reason. */
  dynamic: { path: string; reason: string }[];
}

const fileBase = (path: string) => (path === "/" ? "index" : path.slice(1));

export async function prerenderApp(outDir: string, origin = "http://localhost"): Promise<PrerenderResult> {
  const app = await loadApp(outDir);
  const result: PrerenderResult = { pages: [], dynamic: [] };
  const index: Record<string, { html: string; rsc: string }> = {};
  for (const path of await app.prerenderPaths()) {
    try {
      const rendered = await app.render(new Request(new URL(path, origin)), { prerender: true, skipMiddleware: true });
      if (rendered.dynamic) {
        result.dynamic.push({ path, reason: "uses request data" });
        continue;
      }
      if (rendered.response.status !== 200 || !rendered.rsc) {
        result.dynamic.push({ path, reason: `status ${rendered.response.status}` });
        continue;
      }
      const base = fileBase(path);
      const html = `${base}.html`;
      const rsc = `${base}.rsc`;
      const target = join(outDir, "prerender", html);
      mkdirSync(dirname(target), { recursive: true });
      await Bun.write(target, await rendered.response.text());
      await Bun.write(join(outDir, "prerender", rsc), rendered.rsc);
      index[path] = { html, rsc };
      result.pages.push(path);
    } catch (error) {
      result.dynamic.push({ path, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  await Bun.write(join(outDir, "prerender", "index.json"), JSON.stringify(index, null, 2));
  return result;
}
