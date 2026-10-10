// SPDX-License-Identifier: Apache-2.0
// The crawler files of a served build, from its file list, with the generators of `@aphrody/m3-next`: `/sitemap.xml`
// (the HTML pages and the Markdown documents), `/robots.txt` and `/llms.txt` (the Markdown documents, whose `.md` URL
// answers the raw source to non-browser clients). A file of the same name in the build wins.
import type { M3Routes } from "./api.ts";
import { loadOptional } from "./server-optional.ts";

type M3Next = typeof import("@aphrody/m3-next");

export interface M3CrawlOptions {
  /** Public origin, `https://example.com`: the files hold absolute URLs. */
  origin: string;
  /** Site name, the H1 of `/llms.txt` (default: the app name). */
  name?: string;
  /** One-paragraph summary of `/llms.txt`. */
  summary?: string;
  /** Path prefixes kept out of the sitemap and disallowed in `/robots.txt`. */
  disallow?: readonly string[];
}

/** Public URL path of a served file: `/a/index.html` -> `/a/`, `/b.html` -> `/b`, `/c.md` -> `/c.md`; else undefined. */
export function pagePath(file: string): string | undefined {
  if (file.endsWith("/index.html")) return file.slice(0, -"index.html".length);
  if (file.endsWith(".html")) return file.slice(0, -".html".length);
  if (file.endsWith(".md")) return file;
  return undefined;
}

const next = () => loadOptional<M3Next>("@aphrody/m3-next", "crawl");
const text = (body: string, type: string) =>
  new Response(body, { headers: { "Content-Type": type, "Cache-Control": "public, max-age=3600" } });

/** `/sitemap.xml`, `/robots.txt` and `/llms.txt` routes for the files `paths` (URL paths of the build). */
export function crawlRoutes(paths: readonly string[], options: M3CrawlOptions & { name: string }): M3Routes {
  const disallow = options.disallow ?? [];
  const pages = paths
    .map(pagePath)
    .filter((path): path is string => path !== undefined)
    .filter(path => !disallow.some(prefix => path.startsWith(prefix)));
  const routes: M3Routes = {};
  if (!paths.includes("/sitemap.xml"))
    routes["/sitemap.xml"] = async () =>
      text((await next()).m3SitemapXml(pages, options.origin), "application/xml; charset=utf-8");
  if (!paths.includes("/robots.txt"))
    routes["/robots.txt"] = async () =>
      text(
        (await next()).m3RobotsTxt({
          origin: options.origin,
          rules: [{ userAgent: "*", allow: ["/"], ...(disallow.length ? { disallow } : {}) }],
        }),
        "text/plain; charset=utf-8",
      );
  if (!paths.includes("/llms.txt"))
    routes["/llms.txt"] = async () => {
      const docs = pages.filter(path => path.endsWith(".md"));
      const html = pages.filter(path => !path.endsWith(".md"));
      const sections = [
        ...(docs.length ? [{ title: "Docs", links: docs.map(path => ({ title: path, path })) }] : []),
        ...(html.length ? [{ title: "Pages", links: html.map(path => ({ title: path, path })), optional: true }] : []),
      ];
      return text(
        (await next()).m3LlmsTxt({
          origin: options.origin,
          name: options.name,
          ...(options.summary ? { summary: options.summary } : {}),
          sections,
        }),
        "text/markdown; charset=utf-8",
      );
    };
  return routes;
}
