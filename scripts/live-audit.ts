#!/usr/bin/env bun
/**
 * Live production audit, run after every deploy (pipeline stage `live`).
 *
 *   bun scripts/live-audit.ts [--site <host>] [--skip-crawl] [--ssh <alias>] [--json]
 *
 * 1. routes  — every public route of config/nginx-routes.json answers < 400 on its probe path.
 * 2. crawl   — Aphrody Web (aphrody-web/apps/bxc, profile http) crawls each site of
 *              config/live-audit.json; every crawled page must be 2xx and free of error markers.
 * 3. links   — internal links found in crawled pages but not crawled are fetched (broken links).
 * 4. assets  — every img/script/style/font/og:image referenced by crawled pages is fetched;
 *              first-party failures are errors, third-party failures are warnings.
 * 5. pages   — @aphrody/bxc-test TestPage (profile http) loads the key pages of each site and
 *              asserts a title, the expected text and no error marker.
 * 6. server  — with --ssh, the journal of each site's server units during the run must hold
 *              no error line (Next `⨯`, EROFS, missing column, …).
 *
 * Never starts a desktop browser. Exit code 1 when any error is found; the JSON report is
 * written under var/runs/live-audit/.
 */

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

type Page = { path: string; expectText?: string };
type Site = { host: string; seeds: string[]; maxPages: number; maxDepth: number; firstPartyHosts: string[]; serverUnits: string[]; pages: Page[] };
type Config = { sites: Site[]; errorMarkers: string[]; serverErrorPatterns: string[] };
type Route = { host: string; service: string; probePath?: string; paths?: string[] };
type Finding = { level: "error" | "warning"; check: string; site: string; detail: string };

const root = resolve(import.meta.dir, "..");
const workspace = resolve(root, "..");
const bxcRoot = process.env.APHRODY_WEB_ROOT ?? join(workspace, "aphrody-web", "apps", "bxc");
const bxcDb = process.env.BXC_DB_PATH ?? join(homedir(), "aphrody", "var", "bxc", "data", "bxc.sqlite");
const argv = Bun.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const option = (name: string) => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : undefined; };
const config = (await Bun.file(join(root, "config", "live-audit.json")).json()) as Config;
const routes = ((await Bun.file(join(root, "config", "nginx-routes.json")).json()) as { routes: Route[] }).routes;
const onlySite = option("--site");
const sites = config.sites.filter((site) => !onlySite || site.host === onlySite);
const findings: Finding[] = [];
const startedAt = Date.now();
const add = (level: Finding["level"], check: string, site: string, detail: string) => findings.push({ level, check, site, detail });

async function status(url: string): Promise<number | string> {
	try {
		let response = await fetch(url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(30_000) });
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
	await Promise.all(Array.from({ length: Math.min(size, queue.length) }, async () => {
		while (queue.length) await work(queue.shift() as T);
	}));
}

const failed = (code: number | string) => typeof code === "string" || code >= 400;
const hostOf = (url: string) => { try { return new URL(url).host; } catch { return ""; } };

// 1. routes
await pool(routes.filter((route) => !onlySite || route.host.endsWith(onlySite)), 8, async (route) => {
	const path = route.probePath ?? (route.paths?.includes("/health") ? "/health" : "/");
	const code = await status(`https://${route.host}${path}`);
	if (failed(code)) add("error", "route", route.host, `${code} https://${route.host}${path} (${route.service})`);
});

for (const site of sites) {
	const origin = `https://${site.host}`;
	const firstParty = new Set(site.firstPartyHosts);
	const siteStart = Date.now();

	// 2. crawl through Aphrody Web
	if (!flag("--skip-crawl")) {
		if (!existsSync(join(bxcRoot, "src", "cli", "index.ts"))) throw new Error(`Aphrody Web introuvable: ${bxcRoot}`);
		const crawl = Bun.spawn([
			"bun", "src/cli/index.ts", "crawl", ...site.seeds.map((seed) => origin + seed),
			"--profile", "http", "--allowed-domains", site.host, "--max-requests", String(site.maxPages),
			"--max-depth", String(site.maxDepth), "--concurrency", "8", "--max-retries", "1",
			"--queue", `live-audit-${site.host}-${siteStart}`,
		], { cwd: bxcRoot, stdout: "ignore", stderr: "pipe", env: { ...process.env, BXC_DB_PATH: bxcDb } });
		const code = await crawl.exited;
		if (code !== 0) add("error", "crawl", site.host, `bxc crawl exit ${code}: ${(await new Response(crawl.stderr).text()).slice(-300)}`);
	}

	const pages: { url: string; status: string; content: string; metadata: string }[] = existsSync(bxcDb)
		? (new Database(bxcDb, { readonly: true })
			.query("select url, status, content, metadata from scrapes where (url = ? or url like ?) and fetched_at >= ?")
			.all(origin, `${origin}/%`, flag("--skip-crawl") ? startedAt - 24 * 3600_000 : siteStart) as never)
		: [];
	if (!flag("--skip-crawl") && pages.length === 0) add("error", "crawl", site.host, "aucune page crawlée");
	const crawled = new Set(pages.map((page) => new URL(page.url).pathname));
	const assets = new Map<string, string>();
	const links = new Map<string, string>();

	for (const page of pages) {
		if (!/^2\d\d$/.test(String(page.status))) add("error", "page", site.host, `${page.status} ${page.url}`);
		const html = page.content ?? "";
		const marker = config.errorMarkers.find((text) => html.includes(text));
		if (marker) add("error", "page", site.host, `« ${marker} » sur ${page.url}`);
		for (const match of html.matchAll(/\s(?:src|href|content)="([^"#]+)"/g)) {
			const raw = match[1].replaceAll("&amp;", "&");
			if (!/^(https?:|\/)/.test(raw) || raw.startsWith("//")) continue;
			let url: URL;
			try { url = new URL(raw, page.url); } catch { continue; }
			const isAsset = /\.(png|jpe?g|webp|avif|gif|svg|ico|css|js|mjs|woff2?|ttf|mp4|webm|glb|json)$/i.test(url.pathname)
				|| url.pathname.startsWith("/_next/") || url.pathname.startsWith("/storage/v1/") || url.pathname.startsWith("/api/og");
			if (isAsset) { if (!assets.has(url.href)) assets.set(url.href, page.url); }
			else if (url.host === site.host && !url.pathname.startsWith("/api/") && !crawled.has(url.pathname) && !links.has(url.href)) links.set(url.href, page.url);
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
		if (failed(code)) add(firstParty.has(hostOf(url)) ? "error" : "warning", "asset", site.host, `${code} ${url} ← ${from}`);
	});

	// 5. key pages through @aphrody/bxc-test
	const { TestPage } = await import(join(workspace, "aphrody-web", "packages", "bxc-test", "src", "index.ts"));
	for (const spec of site.pages) {
		const page = await TestPage.create({ profile: "http" });
		try {
			await page.goto(origin + spec.path);
			const [title, content] = await Promise.all([page.title(), page.content()]);
			if (!title?.trim()) add("error", "render", site.host, `titre vide sur ${spec.path}`);
			if (spec.expectText && !content.includes(spec.expectText)) add("error", "render", site.host, `« ${spec.expectText} » absent de ${spec.path}`);
			const marker = config.errorMarkers.find((text) => content.includes(text));
			if (marker) add("error", "render", site.host, `« ${marker} » sur ${spec.path}`);
		} catch (error) {
			add("error", "render", site.host, `${spec.path}: ${String(error).slice(0, 160)}`);
		} finally {
			await page.close();
		}
	}

	// 6. server-side errors logged while the audit ran
	const ssh = option("--ssh");
	if (ssh && site.serverUnits.length) {
		const since = new Date(siteStart - 5_000).toISOString().replace("T", " ").slice(0, 19);
		const units = site.serverUnits.map((unit) => `-u ${unit}`).join(" ");
		const pattern = config.serverErrorPatterns.map((text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
		const journal = Bun.spawn(["ssh", "-o", "BatchMode=yes", ssh, `journalctl ${units} --since '${since} UTC' --no-pager -q -o cat | grep -E '${pattern}' | sort | uniq -c | sort -rn | head -40`], { stdout: "pipe", stderr: "pipe" });
		const lines = (await new Response(journal.stdout).text()).trim();
		await journal.exited;
		for (const line of lines ? lines.split("\n") : []) add("error", "server", site.host, line.trim().slice(0, 240));
	}
}

const errors = findings.filter((finding) => finding.level === "error");
const report = { startedAt: new Date(startedAt).toISOString(), durationMs: Date.now() - startedAt, errors: errors.length, warnings: findings.length - errors.length, findings };
const outDir = join(root, "var", "runs", "live-audit");
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, `${new Date(startedAt).toISOString().replace(/[:.]/g, "-")}.json`);
await Bun.write(outFile, JSON.stringify(report, null, 2));

if (flag("--json")) console.log(JSON.stringify(report));
else {
	const summary = new Map<string, number>();
	for (const finding of findings) summary.set(`${finding.level} ${finding.check} ${finding.site}`, (summary.get(`${finding.level} ${finding.check} ${finding.site}`) ?? 0) + 1);
	for (const [key, count] of [...summary].sort()) console.log(`${String(count).padStart(6)}  ${key}`);
	for (const finding of errors.slice(0, 40)) console.log(`✗ [${finding.check}] ${finding.detail}`);
	console.log(`${errors.length === 0 ? "✓" : "✗"} live audit: ${errors.length} erreur(s), ${report.warnings} avertissement(s) — ${outFile}`);
}
process.exit(errors.length === 0 ? 0 : 1);
