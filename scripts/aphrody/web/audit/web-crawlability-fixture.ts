// SPDX-License-Identifier: Apache-2.0
//! Entry of the crawlability fixture: server-renders representative pages of the m3 packages and
//! derives the crawler support files (robots.txt, sitemap.xml, llms.txt) from the page list.
//!
//! The pages themselves live in `web-crawlability-pages.tsx`. They are loaded lazily, after a Bun
//! plugin pins `react` / `react-dom` to the copy the UI packages use: this directory has no
//! `node_modules` of its own (isolated linker), and two Reacts would break hooks in the SSR output.

import { plugin } from "bun";
import { resolve } from "node:path";
import {
  m3LlmsTxt,
  m3RobotsTxt,
  m3SitemapXml,
} from "../../../packages/aphrody-migrated/m3/aphrody-m3/packages/m3-next/src/crawl.ts";
import type { PageKind, SitePage } from "./web-crawlability.ts";

/** Origin written into the pages; the CLI swaps it for the loopback origin when it serves them. */
export const FIXTURE_ORIGIN = "http://fixture.invalid";

const UI = resolve(import.meta.dir, "../../../packages/aphrody-migrated/m3/aphrody-m3/packages");
const PAGES_MODULE = resolve(
  import.meta.dir,
  "./web-crawlability-pages.tsx",
);
let installed = false;

/**
 * Bun runtime plugins cannot redirect bare specifiers (`onResolve` is not consulted for them), so
 * the pages file is transpiled here and its `react*` imports are pinned to absolute paths. The
 * swiper entry gets the same treatment as in m3-reader's test setup: it imports `react` without
 * declaring it, which the isolated linker cannot resolve from swiper's own folder.
 */
function installResolver(): void {
  if (installed) return;
  installed = true;
  const react = (spec: string, from: string) => JSON.stringify(Bun.resolveSync(spec, resolve(UI, from)));
  plugin({
    name: "web-crawlability-react",
    setup(build) {
      build.onLoad({ filter: /web-crawlability-pages\.tsx$/ }, async args => {
        // Classic JSX (`React.createElement`) because Transpiler output carries no runtime import.
        const transpiled = new Bun.Transpiler({
          loader: "tsx",
          tsconfig: { compilerOptions: { jsx: "react" } },
        }).transformSync(await Bun.file(args.path).text());
        const contents = `import React from ${react("react", "m3-primitives")};\n${transpiled}`.replace(
          /from\s*(["'])(react(?:-dom)?(?:\/[\w.-]+)*|react-hook-form)\1/g,
          (_whole, _quote, spec: string) =>
            `from ${react(spec, spec === "react-hook-form" ? "m3-forms" : "m3-primitives")}`,
        );
        return { contents, loader: "js" };
      });
      build.onLoad({ filter: /\/swiper@[^/]+\/node_modules\/swiper\/swiper-react\.mjs$/ }, async args => ({
        contents: (await Bun.file(args.path).text()).replace(
          /from\s+(["'])react\1/g,
          `from ${react("react", "m3-reader")}`,
        ),
        loader: "js",
      }));
    },
  });
}

export interface FixtureRoute {
  path: string;
  kind: PageKind;
  title: string;
  description: string;
}

/** Renders every fixture page (deterministic: no clock, no randomness, no network). */
export async function renderFixtureSite(): Promise<SitePage[]> {
  installResolver();
  // Runtime-only module: the plugin above transpiles it and pins its react* imports to the UI
  // packages' copies, which do not resolve from scripts/. Importing it by computed path keeps it
  // out of the scripts type program; its contract is the shape below.
  const pages = (await import(PAGES_MODULE)) as {
    renderPages(origin: string): Promise<SitePage[]>;
  };
  return await pages.renderPages(FIXTURE_ORIGIN);
}

/** Replaces the placeholder origin so canonical URLs, JSON-LD and the sitemap match the served origin. */
export function withOrigin(site: readonly SitePage[], origin: string): SitePage[] {
  return site.map(page => ({ ...page, html: page.html.replaceAll(FIXTURE_ORIGIN, origin) }));
}

const titleOf = (html: string) => /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? "";
const descriptionOf = (html: string) => /<meta name="description" content="([^"]*)"/.exec(html)?.[1] ?? "";

/** robots.txt, sitemap.xml and llms.txt for the site, built with the m3-next generators. */
export function crawlSupportFiles(
  site: readonly SitePage[],
  origin = FIXTURE_ORIGIN,
): Record<string, { type: string; body: string }> {
  return {
    "/robots.txt": {
      type: "text/plain; charset=utf-8",
      body: m3RobotsTxt({
        origin,
        rules: [{ userAgent: "*", allow: ["/"], disallow: ["/private/"] }],
      }),
    },
    "/sitemap.xml": {
      type: "application/xml; charset=utf-8",
      body: m3SitemapXml(
        site.map(page => ({ path: page.path, changefreq: "weekly" as const })),
        origin,
      ),
    },
    "/llms.txt": {
      type: "text/plain; charset=utf-8",
      body: m3LlmsTxt({
        origin,
        name: "Aphrody UI crawl fixture",
        summary:
          "Server-rendered pages of the Aphrody Material Design 3 component packages, used to check that crawlers and LLM agents can read them.",
        details:
          "Every page is plain HTML: navigation uses real links, controls carry accessible names and components expose stable data-testid and data-m3-component hooks.",
        sections: [
          {
            title: "Pages",
            links: site.map(page => ({
              title: titleOf(page.html) || page.path,
              path: page.path,
              notes: descriptionOf(page.html) || undefined,
            })),
          },
          {
            title: "Machine-readable",
            links: [{ title: "Sitemap", path: "/sitemap.xml" }],
            optional: true,
          },
        ],
      }),
    },
  };
}
