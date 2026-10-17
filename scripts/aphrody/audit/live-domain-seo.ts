#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/** Read-only public SEO audit. No credentials, provider writes or browser cookies. */
import { resolve4, resolveNs } from "node:dns/promises";

type Finding = {
  url: string;
  check: string;
  severity: "error" | "warning";
  detail: string;
};
const findings: Finding[] = [];
const base = new URL(process.argv[2] ?? "https://aphrody.com");
const limit = Number(process.argv[3] ?? 12);
if (
  base.protocol !== "https:" ||
  base.username ||
  base.password ||
  !Number.isInteger(limit) ||
  limit < 1 ||
  limit > 500
) {
  throw new Error("Usage: bun scripts/audit/live-domain-seo.ts [https://domain] [route limit 1..500]");
}
base.pathname = "/";
base.search = "";
base.hash = "";
const issue = (url: string, check: string, detail: string, severity: Finding["severity"] = "error") =>
  findings.push({ url, check, severity, detail });
async function read(url: string) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(15000),
    redirect: "follow",
  });
  const text = await response.text();
  if (!response.ok) issue(url, "http", `HTTP ${response.status}`);
  return { response, text };
}
function attrs(tag: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of tag.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))
    result[match[1]!.toLowerCase()] = match[2] ?? match[3] ?? "";
  return result;
}
function headTags(html: string, tag: string) {
  const head = /<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(html)?.[1] ?? "";
  return [...head.matchAll(new RegExp(`<${tag}\\b[^>]*>`, "gi"))].map(match => attrs(match[0]));
}
const robotsUrl = new URL("robots.txt", base).href;
const sitemapUrl = new URL("sitemap.xml", base).href;
const [dns, robots, sitemap] = await Promise.all([
  Promise.all([resolveNs(base.hostname), resolve4(base.hostname)])
    .then(([ns, a]) => ({ ns, a }))
    .catch((error: unknown) => ({ error: String(error) })),
  read(robotsUrl),
  read(sitemapUrl),
]);
if (!robots.text.includes(`Sitemap: ${sitemapUrl}`))
  issue(robotsUrl, "sitemap-discovery", "Expected canonical sitemap declaration");
if (/Disallow:\s*\/\s*$/m.test(robots.text))
  issue(robotsUrl, "crawl", "Contains root disallow; inspect applicable user-agent group", "warning");
const routes = [...new Set([...sitemap.text.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/g)].map(match => match[1]!.trim()))];
if (!routes.length) issue(sitemapUrl, "sitemap", "No URL entries found (sitemap indexes require separate inspection)");
const sampled = routes.slice(0, limit);
const titles = new Map<string, string>();
if ("error" in dns) issue(base.href, "dns", dns.error);
for (const url of sampled) {
  // Below the declared public nginx rate limit; avoid exhausting its burst.
  // eslint-disable-next-line no-await-in-loop
  await Bun.sleep(100);
  const route = new URL(url);
  if (route.origin !== base.origin || route.protocol !== "https:") {
    issue(url, "origin", "Sitemap URL differs from canonical HTTPS origin");
    continue;
  }
  try {
    // Keep the public production audit bounded to one route request at a time.
    // eslint-disable-next-line no-await-in-loop
    const { response, text } = await read(url);
    if (!response.ok) continue;
    if (!(response.headers.get("content-type") ?? "").includes("text/html"))
      issue(url, "content-type", "Expected HTML route");
    if (response.url !== url) issue(url, "sitemap-redirect", `Redirects to ${response.url}`, "warning");
    const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(text)?.[1]?.trim() ?? "";
    if (!title) issue(url, "title", "Missing nonempty title");
    else if (titles.has(title)) issue(url, "title", `Duplicate title with ${titles.get(title)}`, "warning");
    titles.set(title, url);
    const metas = headTags(text, "meta");
    if (!metas.some(meta => meta.name?.toLowerCase() === "description" && meta.content?.trim()))
      issue(url, "description", "Missing description");
    if (metas.some(meta => meta.name?.toLowerCase() === "robots" && /noindex/i.test(meta.content ?? "")))
      issue(url, "indexability", "Sitemap route declares noindex");
    const canonicals = headTags(text, "link").filter(link => link.rel?.toLowerCase() === "canonical");
    if (canonicals.length !== 1 || canonicals[0]?.href !== url)
      issue(url, "canonical", "Expected exactly one self-referencing canonical URL");
    if (!/<html\b[^>]*\blang\s*=\s*["'][^"']+["']/i.test(text)) issue(url, "language", "Missing HTML language");
    if (!/<h1\b[^>]*>[\s\S]*?<\/h1>/i.test(text)) issue(url, "heading", "Missing H1", "warning");
    if (/noindex/i.test(response.headers.get("x-robots-tag") ?? ""))
      issue(url, "indexability", "HTTP header declares noindex");
  } catch (error) {
    issue(url, "request", String(error));
  }
}
console.log(
  JSON.stringify(
    {
      origin: base.origin,
      observedAt: new Date().toISOString(),
      dns,
      sitemapRoutes: routes.length,
      auditedRoutes: sampled.length,
      findings,
      limits: "Public HTTP/DNS sample only; no ranking, performance, provider access or desktop qualification.",
    },
    null,
    2,
  ),
);
process.exitCode = findings.some(finding => finding.severity === "error") ? 1 : 0;
