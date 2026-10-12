#!/usr/bin/env bun
/**
 * Live production audit, run after every deploy (pipeline stage `live`).
 *
 *   bun scripts/audit/live-audit.ts [--site <host>] [--skip-crawl] [--ssh <alias>] [--json]
 *
 * 1. routes  — every public route of yolo tools/config/host/nginx/routes.json answers < 400 on its probe path.
 * 2. crawl   — the native Aphrody Web crawler scans each active site of
 *              tools/config/live-audit.json; every crawled page must be 2xx and free of error markers.
 * 3. links   — internal links found in crawled pages but not crawled are fetched (broken links).
 * 4. assets  — every img/script/style/font/og:image referenced by crawled pages is fetched;
 *              first-party failures are errors, third-party failures are warnings.
 * 5. pages   — @aphrody/web-test TestPage loads the key pages of each site and
 *              asserts a title, the expected text and no error marker.
 * 6. server  — with --ssh, the journal of each site's server units during the run must hold
 *              no error line (Next `⨯`, EROFS, missing column, …).
 *
 * Never starts a desktop browser. Exit code 1 when any error is found; the JSON report is
 * written under var/runs/live-audit/.
 */
// Audit sites and browser pages run in order; the bounded pool handles independent requests.
// oxlint-disable no-await-in-loop

import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseCrawlReport, type CrawlPage } from "./live-audit-report.ts";

type Page = { path: string; expectText?: string };
type Site = {
  host: string;
  seeds: string[];
  maxPages: number;
  maxDepth: number;
  firstPartyHosts: string[];
  serverUnits: string[];
  pages: Page[];
  status?: string;
};
type Config = { sites: Site[]; errorMarkers: string[]; serverErrorPatterns: string[] };
type Route = {
  host: string;
  service: string;
  probePath?: string;
  paths?: string[];
  status?: string;
};
type Finding = { level: "error" | "warning"; check: string; site: string; detail: string };

const root = resolve(import.meta.dir, "..", "..");
const webBin = process.env.APHRODY_WEB_BIN ?? "aphrody-web";
const crawlState = join(
  process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"),
  "aphrody",
  "live-audit",
);
const argv = Bun.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const option = (name: string) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};
const config = (await Bun.file(join(root, "tools", "config", "live-audit.json")).json()) as Config;
const routes = (
  (await Bun.file(
    join(process.env.YOLO_ROOT ?? root, "tools", "config", "host", "nginx", "routes.json"),
  ).json()) as { routes: Route[] }
).routes;
const onlySite = option("--site");
const sites = config.sites.filter(
  (site) => site.status !== "retired" && (!onlySite || site.host === onlySite),
);
if (onlySite && sites.length === 0)
  throw new Error(`unknown or retired live-audit site: ${onlySite}`);
const findings: Finding[] = [];
const startedAt = Date.now();
const add = (level: Finding["level"], check: string, site: string, detail: string) =>
  findings.push({ level, check, site, detail });

async function status(url: string): Promise<number | string> {
  try {
    let response = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 405 || response.status === 501 || response.status === 403) {
      response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(30_000) });
      await response.arrayBuffer();
    }
    return response.status;
  } catch (error) {
    return `ERR ${String(error).slice(0, 80)}`;
  }
}

async function pool<T>(items: T[], size: number, work: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(size, queue.length) }, async () => {
      while (queue.length) await work(queue.shift() as T);
    }),
  );
}

const failed = (code: number | string) => typeof code === "string" || code >= 400;
const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
};

// 1. routes
await pool(
  routes.filter(
    (route) => route.status !== "retired" && (!onlySite || route.host.endsWith(onlySite)),
  ),
  8,
  async (route) => {
    const path = route.probePath ?? (route.paths?.includes("/health") ? "/health" : "/");
    const code = await status(`https://${route.host}${path}`);
    if (failed(code))
      add("error", "route", route.host, `${code} https://${route.host}${path} (${route.service})`);
  },
);

for (const site of sites) {
  const origin = `https://${site.host}`;
  const firstParty = new Set(site.firstPartyHosts);
  const siteStart = Date.now();

  // 2. crawl through the native Rust Web owner. Cache one report per host for --skip-crawl.
  const crawlFile = join(crawlState, `${site.host}.json`);
  let pages: CrawlPage[] = [];
  try {
    let raw: string;
    if (flag("--skip-crawl")) {
      if (!existsSync(crawlFile) || Date.now() - statSync(crawlFile).mtimeMs > 24 * 3600_000) {
        throw new Error("no native crawl report from the last 24 hours");
      }
      raw = readFileSync(crawlFile, "utf8");
    } else {
      const crawl = Bun.spawn(
        [
          webBin,
          "crawl",
          ...site.seeds.map((seed) => origin + seed),
          "--format",
          "json",
          "--include-html",
          "--include-links",
          "--allowed-domain",
          site.host,
          "--max-pages",
          String(site.maxPages),
          "--max-depth",
          String(site.maxDepth),
          "--concurrency",
          "8",
          "--max-retries",
          "1",
          "--quiet",
        ],
        { windowsHide: true, cwd: root, stdout: "pipe", stderr: "pipe" },
      );
      const [code, stdout, stderr] = await Promise.all([
        crawl.exited,
        new Response(crawl.stdout).text(),
        new Response(crawl.stderr).text(),
      ]);
      if (code !== 0) throw new Error(`native crawl exit ${code}: ${stderr.slice(-300)}`);
      raw = stdout;
    }
    const report = parseCrawlReport(raw);
    pages = report.pages.filter((page) => new URL(page.url).host === site.host);
    for (const error of report.errors)
      add("error", "crawl", site.host, `${error.url}: ${error.error}`);
    if (!flag("--skip-crawl")) {
      mkdirSync(crawlState, { recursive: true });
      writeFileSync(crawlFile, raw, { mode: 0o600 });
      chmodSync(crawlFile, 0o600);
    }
  } catch (error) {
    add("error", "crawl", site.host, String(error).slice(0, 300));
  }
  if (!flag("--skip-crawl") && pages.length === 0)
    add("error", "crawl", site.host, "aucune page crawlée");
  const crawled = new Set(pages.map((page) => new URL(page.url).pathname));
  const assets = new Map<string, string>();
  const links = new Map<string, string>();

  for (const page of pages) {
    if (page.status < 200 || page.status >= 300)
      add("error", "page", site.host, `${page.status} ${page.url}`);
    const html = page.html;
    const marker = config.errorMarkers.find((text) => html.includes(text));
    if (marker) add("error", "page", site.host, `« ${marker} » sur ${page.url}`);
    for (const [, captured] of html.matchAll(/\s(?:src|href|content)="([^"#]+)"/g)) {
      if (captured === undefined) continue;
      const raw = captured.replaceAll("&amp;", "&");
      if (!/^(https?:|\/)/.test(raw) || raw.startsWith("//")) continue;
      let url: URL;
      try {
        url = new URL(raw, page.url);
      } catch {
        continue;
      }
      const isAsset =
        /\.(png|jpe?g|webp|avif|gif|svg|ico|css|js|mjs|woff2?|ttf|mp4|webm|glb|json)$/i.test(
          url.pathname,
        ) ||
        url.pathname.startsWith("/_next/") ||
        url.pathname.startsWith("/storage/v1/") ||
        url.pathname.startsWith("/api/og");
      if (isAsset) {
        if (!assets.has(url.href)) assets.set(url.href, page.url);
      } else if (
        url.host === site.host &&
        !url.pathname.startsWith("/api/") &&
        !crawled.has(url.pathname) &&
        !links.has(url.href)
      )
        links.set(url.href, page.url);
    }
  }

  // 3. internal links not reached by the crawl
  await pool([...links], 16, async ([url, from]) => {
    const code = await status(url);
    if (failed(code)) add("error", "link", site.host, `${code} ${url} ← ${from}`);
  });

  // 4. assets
  await pool([...assets], 24, async ([url, from]) => {
    const code = await status(url);
    if (failed(code))
      add(
        firstParty.has(hostOf(url)) ? "error" : "warning",
        "asset",
        site.host,
        `${code} ${url} ← ${from}`,
      );
  });

  // 5. key pages through the monorepo's native Web test owner.
  const { TestPage } = await import("@aphrody/web-test");
  for (const spec of site.pages) {
    let page: Awaited<ReturnType<typeof TestPage.create>> | undefined;
    try {
      page = await TestPage.create({ profile: "http" });
      const navigation = await page.goto(origin + spec.path);
      if (!navigation.ok)
        add("error", "render", site.host, `${navigation.status} sur ${spec.path}`);
      const [title, content] = await Promise.all([page.title(), page.content()]);
      if (!title?.trim()) add("error", "render", site.host, `titre vide sur ${spec.path}`);
      if (spec.expectText && !content.includes(spec.expectText))
        add("error", "render", site.host, `« ${spec.expectText} » absent de ${spec.path}`);
      const marker = config.errorMarkers.find((text) => content.includes(text));
      if (marker) add("error", "render", site.host, `« ${marker} » sur ${spec.path}`);
    } catch (error) {
      add("error", "render", site.host, `${spec.path}: ${String(error).slice(0, 160)}`);
    } finally {
      try {
        await page?.close();
      } catch (error) {
        add(
          "error",
          "render",
          site.host,
          `${spec.path}: fermeture: ${String(error).slice(0, 120)}`,
        );
      }
    }
  }

  // 6. server-side errors logged while the audit ran
  const ssh = option("--ssh");
  if (ssh && site.serverUnits.length) {
    const since = new Date(siteStart - 5_000).toISOString().replace("T", " ").slice(0, 19);
    const units = site.serverUnits.map((unit) => `-u ${unit}`).join(" ");
    const pattern = config.serverErrorPatterns
      .map((text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|");
    const journal = Bun.spawn(
      [
        "ssh",
        "-o",
        "BatchMode=yes",
        ssh,
        `journalctl ${units} --since '${since} UTC' --no-pager -q -o cat | grep -E '${pattern}' | sort | uniq -c | sort -rn | head -40`,
      ],
      { windowsHide: true, stdout: "pipe", stderr: "pipe" },
    );
    const lines = (await new Response(journal.stdout).text()).trim();
    await journal.exited;
    for (const line of lines ? lines.split("\n") : [])
      add("error", "server", site.host, line.trim().slice(0, 240));
  }
}

const errors = findings.filter((finding) => finding.level === "error");
const report = {
  startedAt: new Date(startedAt).toISOString(),
  durationMs: Date.now() - startedAt,
  errors: errors.length,
  warnings: findings.length - errors.length,
  findings,
};
const outDir = join(root, "var", "runs", "live-audit");
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, `${new Date(startedAt).toISOString().replace(/[:.]/g, "-")}.json`);
await Bun.write(outFile, JSON.stringify(report, null, 2));

if (flag("--json")) console.log(JSON.stringify(report));
else {
  const summary = new Map<string, number>();
  for (const finding of findings)
    summary.set(
      `${finding.level} ${finding.check} ${finding.site}`,
      (summary.get(`${finding.level} ${finding.check} ${finding.site}`) ?? 0) + 1,
    );
  for (const [key, count] of [...summary].toSorted())
    console.log(`${String(count).padStart(6)}  ${key}`);
  for (const finding of errors.slice(0, 40)) console.log(`✗ [${finding.check}] ${finding.detail}`);
  console.log(
    `${errors.length === 0 ? "✓" : "✗"} live audit: ${errors.length} erreur(s), ${report.warnings} avertissement(s) — ${outFile}`,
  );
}
process.exit(errors.length === 0 ? 0 : 1);
