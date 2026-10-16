// SPDX-License-Identifier: Apache-2.0

export type CrawlPage = { url: string; status: number; html: string };
export type CrawlError = { url: string; error: string };
export type CrawlReport = { pages: CrawlPage[]; errors: CrawlError[] };

/** Validate the JSON contract of the native `aphrody-web crawl` command. */
export function parseCrawlReport(raw: string): CrawlReport {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object")
    throw new Error("crawl report must be an object");
  const report = value as Record<string, unknown>;
  if (
    report.schema !== "aphrody-web.crawl/1" ||
    !Array.isArray(report.pages) ||
    !Array.isArray(report.errors)
  ) {
    throw new Error("unsupported native crawl report");
  }
  const pages = report.pages.map((entry): CrawlPage => {
    if (!entry || typeof entry !== "object")
      throw new Error("invalid crawl page");
    const page = entry as Record<string, unknown>;
    if (
      typeof page.url !== "string" ||
      typeof page.status !== "number" ||
      (page.status >= 200 && page.status < 400 && typeof page.html !== "string")
    ) {
      throw new Error("successful crawl page is missing URL, status, or HTML");
    }
    return {
      url: page.url,
      status: page.status,
      html: typeof page.html === "string" ? page.html : "",
    };
  });
  const errors = report.errors.map((entry): CrawlError => {
    if (!entry || typeof entry !== "object")
      throw new Error("invalid crawl error");
    const error = entry as Record<string, unknown>;
    if (typeof error.url !== "string" || typeof error.error !== "string")
      throw new Error("invalid crawl error");
    return { url: error.url, error: error.error };
  });
  return { pages, errors };
}
