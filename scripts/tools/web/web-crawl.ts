// SPDX-License-Identifier: Apache-2.0
//! Crawl one or more seeds with the native `aphrody-web crawl` and print a summary or the raw
//! report. Defaults come from tools/config/web.json; flags override them.
//!
//!   bun scripts/tools/web/web-crawl.ts <seed>... [--max-pages N] [--max-depth N] [--allow-host H]
//!        [--no-robots] [--sitemaps] [--allow-private-network] [--json] [--out FILE]

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { repositoryRoot } from "../../../packages/web/agent-browser/src/config.ts";
import {
  WebService,
  type CrawlOptions,
  type CrawlReport,
} from "../../../packages/web/agent-browser/src/service.ts";

export function parseCrawlArgs(argv: string[]): {
  seeds: string[];
  options: CrawlOptions;
  json: boolean;
  out?: string;
} {
  const seeds: string[] = [];
  const options: CrawlOptions = {};
  let json = false;
  let out: string | undefined;
  const number = (flag: string, raw: string | undefined): number => {
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0)
      throw new Error(`${flag} needs a non-negative integer`);
    return value;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--max-pages") options.maxPages = number(arg, argv[++i]);
    else if (arg === "--max-depth") options.maxDepth = number(arg, argv[++i]);
    else if (arg === "--concurrency") options.concurrency = number(arg, argv[++i]);
    else if (arg === "--allow-host") (options.allowedDomains ??= []).push(argv[++i] ?? "");
    else if (arg === "--no-robots") options.obeyRobots = false;
    else if (arg === "--sitemaps") options.sitemaps = true;
    else if (arg === "--allow-private-network") options.allowPrivateNetwork = true;
    else if (arg === "--json") json = true;
    else if (arg === "--out") out = argv[++i];
    else if (arg.startsWith("-")) throw new Error(`unknown option ${arg}`);
    else seeds.push(arg);
  }
  if (seeds.length === 0) throw new Error("usage: web-crawl <seed>... [options]");
  return { seeds, options, json, out };
}

export function summarizeCrawl(report: CrawlReport): string {
  const lines = report.pages.map(
    (page) =>
      `${String(page.status).padEnd(4)} d${page.depth} ${String(page.wordCount).padStart(6)} words  ${page.url}${page.duplicate ? "  (duplicate)" : ""}`,
  );
  for (const error of report.errors) lines.push(`ERR  ${error.url}: ${error.error}`);
  const { stats } = report;
  lines.push(
    `\n${stats.pages} pages, ${report.errors.length} errors, robots blocked ${stats.robotsBlocked}, ${stats.elapsedMs} ms`,
  );
  return lines.join("\n");
}

if (import.meta.main) {
  const { seeds, options, json, out } = parseCrawlArgs(process.argv.slice(2));
  const service = new WebService();
  const report = await service.crawl(seeds, options);
  if (out) {
    const target = resolve(repositoryRoot(), out);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(json ? JSON.stringify(report, null, 2) : summarizeCrawl(report));
}
