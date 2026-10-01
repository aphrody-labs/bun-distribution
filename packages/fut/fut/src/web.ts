// SPDX-License-Identifier: Apache-2.0
import { WebService, type CrawlPageReport } from "@aphrody/agent-browser/service";

/** Thin domain acquisition binding; native Web owns scheduling, retries and rendering. */
export async function fetchFutPage(url: string, render = true): Promise<CrawlPageReport> {
  const report = await new WebService().crawl([url], {
    maxPages: 3,
    maxDepth: 0,
    concurrency: 1,
    delayMs: 1000,
    allowedDomains: [new URL(url).hostname],
    includeHtml: true,
    render,
  });
  const page = report.pages[0];
  if (!page)
    throw new Error(
      `Aphrody Web acquisition failed for ${url}: ${report.errors[0]?.error ?? "no page"}`,
    );
  if (page.status < 200 || page.status >= 300) {
    throw new Error(`Aphrody Web acquisition failed for ${url}: HTTP ${page.status}`);
  }
  if (typeof page.html !== "string") {
    throw new Error(`Aphrody Web acquisition omitted captured HTML for ${url}`);
  }
  if (/Just a moment|cf-browser-verification|Cloudflare/i.test(page.title)) {
    throw new Error(`Aphrody Web encountered a challenge at ${url}`);
  }
  return page;
}

export async function fetchFutResponse(url: string): Promise<Response> {
  const page = await fetchFutPage(url);
  return new Response(page.html ?? "", { status: page.status });
}
