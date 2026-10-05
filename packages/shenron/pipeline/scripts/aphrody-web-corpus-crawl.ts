#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/** Run Shenron's Dragon Ball corpus plan through Aphrody Web's Rust crawl owner. */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";

type Target = {
	id: string;
	enabled?: boolean;
	mode?: string;
	seeds: string[];
	allowedDomains?: string[];
	includePatterns?: string[];
	excludePatterns?: string[];
	maxDepth?: number;
	perHostDelayMs?: number;
	maxInFlightPerHost?: number;
	lang?: string;
	kind?: string;
	goal?: string;
};
type CrawlPlan = {
	respectRobots?: boolean;
	defaults?: { maxDepth?: number; maxPages?: number; maxConcurrency?: number; maxInFlightPerHost?: number; perHostDelayMs?: number };
	targets: Target[];
};
type CrawlPage = { url: string; title?: string; markdown?: string };
type CrawlReport = { pages?: CrawlPage[]; errors?: Array<{ url: string; error: string }> };
type CorpusDoc = { id: string; name: string; url: string; markdown: string; lang?: string; kind?: string };

const root = resolve(import.meta.dir, "../../../..");
const dataDir = resolve(root, "crates/ai/rag-eval/datasets/dragonball");
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const configPath = process.env.APHRODY_CORPUS_CRAWL_CONFIG?.trim() || join(dataDir, "crawl.config.json");
const crawlDir = resolve(process.env.APHRODY_CORPUS_CRAWL_DIR?.trim() || join(process.env.APHRODY_HOME?.trim() || join(homedir(), ".aphrody"), "workspaces/dbfr/crawl"));
const aphrody = process.env.APHRODY_WEB_BIN?.trim() || Bun.which("aphrody");
if (!aphrody) throw new Error("Aphrody Web Rust CLI introuvable; définir APHRODY_WEB_BIN ou installer aphrody");
const plan = JSON.parse(await readFile(configPath, "utf8")) as CrawlPlan;
if (!Array.isArray(plan.targets) || !plan.defaults) throw new Error(`Invalid Aphrody Web crawl plan: ${configPath}`);

function commandFor(target: Target): string[] {
	const defaults = plan.defaults!;
	const command = [aphrody!, "web", "crawl", ...target.seeds, "--sqlite", join(crawlDir, "frontier", "aphrody-web", `${target.id}.sqlite`),
		"--max-depth", String(target.maxDepth ?? defaults.maxDepth ?? 2),
		"--max-requests", String(Number(process.env.APHRODY_CORPUS_MAX_REQUESTS) || defaults.maxPages || 500),
		"--concurrency", String(Math.max(1, Math.min(target.maxInFlightPerHost ?? defaults.maxConcurrency ?? 1, 8))),
		"--max-per-host", String(target.maxInFlightPerHost ?? defaults.maxInFlightPerHost ?? 1),
		"--max-retries", "3", "--json"];
	if (target.allowedDomains?.length) command.push("--allowed-domains", target.allowedDomains.join(","));
	for (const pattern of target.includePatterns ?? []) command.push("--include-url-regex", pattern);
	for (const pattern of target.excludePatterns ?? []) command.push("--exclude-url-regex", pattern);
	if (target.perHostDelayMs !== undefined) command.push("--per-host-delay", String(target.perHostDelayMs));
	if (plan.respectRobots) command.push("--obey-robots");
	if (target.goal) command.push("--goal", target.goal);
	if (target.maxDepth === undefined && defaults.maxDepth === undefined) command.push("--max-depth", "2");
	return command;
}

function mediawikiCommandFor(target: Target): string[] {
	const seed = new URL(target.seeds[0]!);
	const match = seed.pathname.match(/^(.*\/wiki)\/[^/]+\/?$/);
	if (!match) throw new Error(`${target.id}: seed MediaWiki must use a /wiki/<title> path`);
	const articlePath = `${match[1]!}/$1`;
	const apiPath = `${match[1]!.replace(/\/wiki$/, "")}/api.php`;
	const command = [aphrody!, "web", "mediawiki", "--api-url", new URL(apiPath, seed.origin).href,
		"--article-path", articlePath, "--max-pages", String(Number(process.env.APHRODY_CORPUS_MAX_REQUESTS) || plan.defaults!.maxPages || 200),
		"--batch-size", "50", "--request-interval-ms", String(target.perHostDelayMs ?? plan.defaults!.perHostDelayMs ?? 250)];
	for (const pattern of target.includePatterns ?? []) command.push("--include-url-regex", pattern);
	for (const pattern of target.excludePatterns ?? []) command.push("--exclude-url-regex", pattern);
	return command;
}

const targets = plan.targets.filter((target) => target.enabled !== false);
if (!targets.length) throw new Error("Aucun target de crawl Aphrody Web activé");
await mkdir(join(crawlDir, "corpus"), { recursive: true });
await mkdir(join(crawlDir, "frontier", "aphrody-web"), { recursive: true });

let failed = false;
for (const target of targets) {
	const command = target.mode === "mediawiki" ? mediawikiCommandFor(target) : commandFor(target);
	if (dryRun) {
		console.log(JSON.stringify({ target: target.id, command }));
		continue;
	}
	const child = Bun.spawn(command, { cwd: root, stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
	]);
	if (exitCode !== 0) {
		failed = true;
		console.error(`${target.id}: Aphrody Web crawl exited ${exitCode}: ${stderr.trim() || stdout.trim()}`);
		continue;
	}
	let report: CrawlReport;
	try { report = JSON.parse(stdout) as CrawlReport; }
	catch (error) { throw new Error(`Aphrody Web returned invalid JSON for ${target.id}`, { cause: error }); }
	const path = join(crawlDir, "corpus", `${target.id}.jsonl`);
	const existing = new Map<string, CorpusDoc>();
	for (const line of (await readFile(path, "utf8").catch(() => "")).split(/\r?\n/)) {
		if (!line.trim()) continue;
		const row = JSON.parse(line) as CorpusDoc;
		if (row.id && row.url && row.markdown) existing.set(row.id, row);
	}
	for (const page of report.pages ?? []) {
		if (!page.markdown?.trim()) continue;
		if (target.includePatterns?.length && !target.includePatterns.some((pattern) => new RegExp(pattern).test(page.url))) continue;
		if (target.excludePatterns?.some((pattern) => new RegExp(pattern).test(page.url))) continue;
		const hash = createHash("sha256").update(page.url).digest("hex").slice(0, 16);
		const row: CorpusDoc = {
			id: `${target.id}-${hash}`, name: page.title?.trim() || page.url, url: page.url,
			markdown: page.markdown, ...(target.lang ? { lang: target.lang } : {}), ...(target.kind ? { kind: target.kind } : {}),
		};
		existing.set(row.id, row);
	}
	const temp = `${path}.${process.pid}.tmp`;
	await writeFile(temp, [...existing.values()].map((row) => JSON.stringify(row)).join("\n") + (existing.size ? "\n" : ""), { flag: "w", mode: 0o600 });
	await rename(temp, path);
	console.log(`${target.id}: ${report.pages?.length ?? 0} pages, ${existing.size} corpus docs${report.errors?.length ? `, ${report.errors.length} crawl errors` : ""}`);
}
if (failed) process.exitCode = 1;
