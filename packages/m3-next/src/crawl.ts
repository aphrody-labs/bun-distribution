// SPDX-License-Identifier: Apache-2.0
// Crawler-facing files for an App Router site: sitemap.xml, robots.txt, llms.txt and a
// script-safe JSON-LD serializer. Pure functions (no React, no Node, no Next): call them from a
// route handler (`app/sitemap.xml/route.ts`), from a build script, or from a test.
//
//   export const GET = () => new Response(m3SitemapXml(routes, "https://example.com"), { headers: { "content-type": "application/xml" } });

const SITEMAP_NS = "http://www.sitemaps.org/schemas/sitemap/0.9";
/** The Sitemaps protocol limit for one file (a sitemap index is needed beyond it). */
export const M3_SITEMAP_MAX_URLS = 50_000;

export type M3ChangeFrequency =
  "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";

export interface M3Route {
  /** Path (`/docs`), or an absolute URL on the same origin. */
  path: string;
  /** `YYYY-MM-DD` or a full W3C datetime; a `Date` is serialized to ISO 8601. */
  lastmod?: string | Date;
  changefreq?: M3ChangeFrequency;
  /** 0 to 1 (serialized with one decimal). */
  priority?: number;
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function parseOrigin(origin: string): URL {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new TypeError(
      `origin ${JSON.stringify(origin)} is not an absolute URL`,
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new TypeError(`origin ${origin} must be http or https`);
  return url;
}

/** Absolute URL of a route on `origin`; throws when the route points at another origin. */
export function m3AbsoluteUrl(path: string, origin: string): string {
  const base = parseOrigin(origin);
  const url = new URL(path, base);
  if (url.origin !== base.origin)
    throw new RangeError(`route ${path} is not on origin ${base.origin}`);
  url.hash = "";
  return url.href;
}

function singleLine(value: string, what: string): string {
  if (/[\r\n]/.test(value))
    throw new TypeError(`${what} must not contain a line break`);
  return value.trim();
}

function lastmodValue(value: string | Date): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime()))
      throw new RangeError("lastmod is an invalid Date");
    return value.toISOString();
  }
  if (!/^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:\d{2}))?$/.test(value))
    throw new RangeError(
      `lastmod ${JSON.stringify(value)} is not a W3C datetime`,
    );
  return value;
}

/**
 * A Sitemaps 0.9 document. Routes are resolved against `origin`, de-duplicated by absolute URL
 * (the last definition wins) and sorted by URL so the output is stable whatever the input order.
 */
export function m3SitemapXml(
  routes: readonly (string | M3Route)[],
  origin: string,
): string {
  const entries = new Map<string, M3Route>();
  for (const route of routes) {
    const item = typeof route === "string" ? { path: route } : route;
    entries.set(m3AbsoluteUrl(item.path, origin), item);
  }
  if (entries.size > M3_SITEMAP_MAX_URLS)
    throw new RangeError(
      `a sitemap holds at most ${M3_SITEMAP_MAX_URLS} URLs, got ${entries.size}`,
    );
  const urls = [...entries]
    // oxlint-disable-next-line unicorn/no-array-sort -- Sort the owned copy without requiring ES2023 in consumers.
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([loc, route]) => {
      const lines = [`    <loc>${xmlEscape(loc)}</loc>`];
      if (route.lastmod !== undefined)
        lines.push(`    <lastmod>${lastmodValue(route.lastmod)}</lastmod>`);
      if (route.changefreq !== undefined)
        lines.push(`    <changefreq>${route.changefreq}</changefreq>`);
      if (route.priority !== undefined) {
        if (!(route.priority >= 0 && route.priority <= 1))
          throw new RangeError(`priority ${route.priority} is outside 0..1`);
        lines.push(`    <priority>${route.priority.toFixed(1)}</priority>`);
      }
      return `  <url>\n${lines.join("\n")}\n  </url>`;
    });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="${SITEMAP_NS}">\n${urls.join("\n")}${urls.length ? "\n" : ""}</urlset>\n`;
}

export interface M3RobotsRule {
  userAgent: string | readonly string[];
  allow?: readonly string[];
  /** An empty string allows everything for the group. */
  disallow?: readonly string[];
  /** Seconds between requests (honoured by some crawlers, ignored by Google). */
  crawlDelay?: number;
}

export interface M3RobotsOptions {
  origin: string;
  /** Default: every crawler may fetch everything. */
  rules?: readonly M3RobotsRule[];
  /** Sitemap paths or absolute URLs; default `["/sitemap.xml"]`. Pass `[]` for none. */
  sitemaps?: readonly string[];
}

/** A robots.txt (RFC 9309) with one group per rule and absolute `Sitemap:` lines. */
export function m3RobotsTxt(options: M3RobotsOptions): string {
  const rules = options.rules ?? [{ userAgent: "*", allow: ["/"] }];
  const groups = rules.map((rule) => {
    const agents = (
      typeof rule.userAgent === "string"
        ? [rule.userAgent]
        : [...rule.userAgent]
    ).map((agent) => singleLine(agent, "user agent"));
    if (agents.length === 0 || agents.some((agent) => agent === ""))
      throw new TypeError(
        "a robots.txt group needs at least one non-empty user agent",
      );
    const lines = agents.map((agent) => `User-agent: ${agent}`);
    for (const path of rule.allow ?? [])
      lines.push(`Allow: ${singleLine(path, "Allow path")}`);
    for (const path of rule.disallow ?? [])
      lines.push(`Disallow: ${singleLine(path, "Disallow path")}`);
    if (rule.crawlDelay !== undefined) {
      if (!(rule.crawlDelay >= 0))
        throw new RangeError(`crawlDelay ${rule.crawlDelay} must be >= 0`);
      lines.push(`Crawl-delay: ${rule.crawlDelay}`);
    }
    return lines.join("\n");
  });
  const sitemaps = (options.sitemaps ?? ["/sitemap.xml"]).map(
    (path) => `Sitemap: ${m3AbsoluteUrl(path, options.origin)}`,
  );
  return `${[...groups, ...(sitemaps.length ? [sitemaps.join("\n")] : [])].join("\n\n")}\n`;
}

export interface M3LlmsLink {
  title: string;
  /** Path on `origin`, or an absolute URL (any origin). */
  path: string;
  /** Short description after the link. */
  notes?: string;
}

export interface M3LlmsSection {
  title: string;
  links: readonly M3LlmsLink[];
  /** Emitted under the reserved `## Optional` heading (readers may skip it for a shorter context). */
  optional?: boolean;
}

export interface M3LlmsOptions {
  origin: string;
  /** The H1: the only required part of the format. */
  name: string;
  /** One-paragraph summary, emitted as a blockquote. */
  summary?: string;
  /** Free paragraphs after the summary (no headings). */
  details?: string | readonly string[];
  sections?: readonly M3LlmsSection[];
}

const markdownText = (value: string) =>
  singleLine(value, "llms.txt text").replace(/([[\]\\])/g, "\\$1");

/** An `/llms.txt` following https://llmstxt.org: H1, blockquote summary, details, then `##` link lists. */
export function m3LlmsTxt(options: M3LlmsOptions): string {
  const name = singleLine(options.name, "name");
  if (name === "") throw new TypeError("llms.txt needs a non-empty name");
  const blocks = [`# ${name}`];
  if (options.summary)
    blocks.push(
      options.summary
        .split(/\r?\n/)
        .map((line) => `> ${line.trim()}`)
        .join("\n"),
    );
  const details =
    typeof options.details === "string"
      ? [options.details]
      : [...(options.details ?? [])];
  for (const paragraph of details) {
    if (/^\s*#/m.test(paragraph))
      throw new TypeError("llms.txt details must not contain headings");
    blocks.push(paragraph.trim());
  }
  const sections = options.sections ?? [];
  const link = (item: M3LlmsLink) => {
    const url = /^[a-z][a-z0-9+.-]*:/i.test(item.path)
      ? new URL(item.path).href
      : m3AbsoluteUrl(item.path, options.origin);
    return `- [${markdownText(item.title)}](${url})${item.notes ? `: ${singleLine(item.notes, "notes")}` : ""}`;
  };
  const ordered = [
    ...sections.filter((section) => !section.optional),
    ...sections.filter((section) => section.optional),
  ];
  const optional = ordered.filter((section) => section.optional);
  for (const section of ordered.filter((s) => !s.optional))
    blocks.push(
      `## ${markdownText(section.title)}\n\n${section.links.map(link).join("\n")}`,
    );
  if (optional.length > 0)
    blocks.push(
      `## Optional\n\n${optional
        .flatMap((section) => section.links)
        .map(link)
        .join("\n")}`,
    );
  return `${blocks.join("\n\n")}\n`;
}

/**
 * JSON for an inline `<script type="application/ld+json">`: `<`, `>`, `&` and the JS line
 * separators are escaped so the payload can never close the tag or be reparsed as markup.
 */
export function m3JsonLd(data: unknown): string {
  const json = JSON.stringify(data);
  if (json === undefined)
    throw new TypeError("m3JsonLd: value is not serializable");
  return json
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
