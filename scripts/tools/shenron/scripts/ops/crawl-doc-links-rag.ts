#!/usr/bin/env bun

/**
 * Resumable BXC markdown crawl for every URL listed in data/doc-links.json.
 *
 * Usage:
 *   bun scripts/ops/crawl-doc-links-rag.ts
 *   bun scripts/ops/crawl-doc-links-rag.ts --concurrency 4
 *   bun scripts/ops/crawl-doc-links-rag.ts --rebuild
 *   bun scripts/ops/crawl-doc-links-rag.ts --dry-run
 *
 * The default mode only captures Markdown and writes its provenance manifest.
 * `--rebuild` is deliberately required before the corpus is merged and the RAG
 * refresh workflow is invoked.
 */
import { createHash } from "node:crypto";
import { embedHealthUrl } from "@shenron/pipeline/ai/config";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..");
const LINKS_PATH = join(ROOT, "data", "doc-links.json");
const RAW_DIR = join(ROOT, "apps", "bot", "data", "rag", "raw", "doc-links");
const MANIFEST_PATH = join(ROOT, "data", "rag", "crawls", "doc-links-manifest.json");
const SHARD_PATH = join(ROOT, "data", "rag", "crawls", "doc-links-shard.json");
const DEFAULT_CONCURRENCY = 6;
const MAX_CONCURRENCY = 12;
const REQUEST_TIMEOUT_MS = 45_000;
const MANIFEST_SCHEMA = "shenron-doc-links-crawl/v1";

type CrawlStatus = "pending" | "completed" | "failed";

type CrawlRecord = {
	url: string;
	status: CrawlStatus;
	attempts: number;
	updatedAt: string;
	file?: string;
	chars?: number;
	contentSha256?: string;
	retrievedAt?: string;
	provenance?: {
		sourceList: string;
		extractor: "bxc scrape";
		format: "markdown";
		profile: string;
	};
	lastError?: string;
};

type CrawlManifest = {
	schema: typeof MANIFEST_SCHEMA;
	sourceList: string;
	updatedAt: string;
	records: Record<string, CrawlRecord>;
};

type CrawlOptions = {
	concurrency: number;
	rebuild: boolean;
	rebuildOnly: boolean;
	dryRun: boolean;
	force: boolean;
	host: string | null;
	profile: string;
};

type CorpusDocument = {
	id: string;
	name: string;
	url: string;
	chars: number;
	markdown: string;
};

function usage(): string {
	return "Usage: bun scripts/ops/crawl-doc-links-rag.ts [--concurrency N] [--profile static|fast|http|stealth|max] [--host hostname] [--force] [--rebuild|--rebuild-only] [--dry-run]";
}

export function parseOptions(argv: string[]): CrawlOptions {
	let concurrency = DEFAULT_CONCURRENCY;
	let rebuild = false;
	let rebuildOnly = false;
	let dryRun = false;
	let force = false;
	let host: string | null = null;
	let profile = "stealth";

	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		if (arg === "--rebuild") rebuild = true;
		else if (arg === "--rebuild-only") {
			rebuild = true;
			rebuildOnly = true;
		}
		else if (arg === "--dry-run") dryRun = true;
		else if (arg === "--force") force = true;
		else if (arg === "--help" || arg === "-h") throw new Error(usage());
		else if (arg === "--concurrency" || arg === "--profile" || arg === "--host") {
			const value = argv[++index];
			if (!value) throw new Error(`Missing value for ${arg}.\n${usage()}`);
			if (arg === "--concurrency") {
				concurrency = Number(value);
			} else if (arg === "--host") {
				host = value.toLowerCase();
			} else {
				profile = value;
			}
		} else {
			throw new Error(`Unknown argument: ${arg}.\n${usage()}`);
		}
	}

	if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > MAX_CONCURRENCY) {
		throw new Error(`--concurrency must be an integer from 1 to ${MAX_CONCURRENCY}.`);
	}
	if (!new Set(["static", "fast", "http", "stealth", "max"]).has(profile)) {
		throw new Error("--profile must be one of: static, fast, http, stealth, max.");
	}
	if (host && !/^[a-z0-9.-]+$/.test(host)) throw new Error("--host must be a hostname.");
	return { concurrency, rebuild, rebuildOnly, dryRun, force, host, profile };
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function rawPath(url: string): string {
	return join(RAW_DIR, `${sha256(url)}.md`);
}

function docId(url: string): string {
	return `doc-link-${sha256(url)}`;
}

function now(): string {
	return new Date().toISOString();
}

function emptyManifest(): CrawlManifest {
	return {
		schema: MANIFEST_SCHEMA,
		sourceList: relative(ROOT, LINKS_PATH),
		updatedAt: now(),
		records: {},
	};
}

async function writeJsonAtomically(path: string, value: unknown): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const temporaryPath = `${path}.tmp-${process.pid}-${crypto.randomUUID()}`;
	await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
	await rename(temporaryPath, path);
}

async function readManifest(): Promise<CrawlManifest> {
	if (!existsSync(MANIFEST_PATH)) return emptyManifest();
	const parsed: unknown = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
	if (
		typeof parsed !== "object" ||
		parsed === null ||
		(parsed as { schema?: unknown }).schema !== MANIFEST_SCHEMA ||
		typeof (parsed as { records?: unknown }).records !== "object" ||
		(parsed as { records?: unknown }).records === null
	) {
		throw new Error(`Invalid crawl manifest: ${MANIFEST_PATH}`);
	}
	return parsed as CrawlManifest;
}

async function readUrls(): Promise<string[]> {
	const parsed: unknown = JSON.parse(await readFile(LINKS_PATH, "utf8"));
	const urls = (parsed as { urls?: unknown }).urls;
	if (!Array.isArray(urls) || !urls.every((url) => typeof url === "string")) {
		throw new Error(`${LINKS_PATH} must contain a string array at .urls.`);
	}
	const uniqueUrls = [...new Set(urls)];
	for (const url of uniqueUrls) {
		try {
			const parsedUrl = new URL(url);
			if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") throw new Error();
		} catch {
			throw new Error(`Invalid HTTP(S) URL in ${LINKS_PATH}: ${url}`);
		}
	}
	return uniqueUrls;
}

export function isUsableMarkdown(markdown: string): boolean {
	if (markdown.trim().length <= 50) return false;
	const replacementCharacters = (markdown.match(/�/g) ?? []).length;
	return replacementCharacters / markdown.length < 0.005;
}

async function validateCompletedRecord(record: CrawlRecord): Promise<boolean> {
	if (record.status !== "completed" || !record.file || !record.contentSha256 || !record.chars) {
		return false;
	}
	const absolutePath = join(ROOT, record.file);
	try {
		const markdown = await readFile(absolutePath, "utf8");
		return (
			markdown.length === record.chars &&
			sha256(markdown) === record.contentSha256 &&
			isUsableMarkdown(markdown)
		);
	} catch {
		return false;
	}
}

async function reconcileCompletedRecords(manifest: CrawlManifest, urls: string[]): Promise<number> {
	let reset = 0;
	for (const url of urls) {
		const record = manifest.records[url];
		if (!record || record.status !== "completed") continue;
		if (await validateCompletedRecord(record)) continue;
		manifest.records[url] = {
			url,
			status: "pending",
			attempts: record.attempts,
			updatedAt: now(),
			lastError: "Completed record content is missing or does not match its provenance hash.",
		};
		reset++;
	}
	return reset;
}

function bxcCommand(): string {
	const configured = process.env.BXC_BIN;
	if (configured && existsSync(configured)) return configured;
	const onPath = Bun.which("bxc");
	if (onPath) return onPath;
	throw new Error("BXC CLI not found. Install BXC or set BXC_BIN to its executable path.");
}

async function scrapeMarkdown(
	command: string,
	url: string,
	profile: string,
	force: boolean
): Promise<string> {
	const args = [command, "scrape", url, "--markdown", "--profile", profile];
	if (force) args.push("--force");
	const process = Bun.spawn(args, {
		stdout: "pipe",
		stderr: "pipe",
	});
	const timeout = setTimeout(() => process.kill(), REQUEST_TIMEOUT_MS);
	const [stdout, stderr, code] = await Promise.all([
		new Response(process.stdout).text(),
		new Response(process.stderr).text(),
		process.exited,
	]);
	clearTimeout(timeout);
	if (code !== 0) throw new Error(`BXC exited ${code}: ${stderr.trim().slice(0, 500)}`);
	if (!isUsableMarkdown(stdout)) throw new Error("BXC returned empty or unusable Markdown.");
	return stdout;
}

async function runCommand(command: string[]): Promise<void> {
	console.log(`[EXEC] ${command.join(" ")}`);
	const process = Bun.spawn(command, { cwd: ROOT, stdout: "inherit", stderr: "inherit" });
	const code = await process.exited;
	if (code !== 0) throw new Error(`Command failed (${code}): ${command.join(" ")}`);
}

async function embeddingsAvailable(): Promise<boolean> {
	try {
		// Résolveur unique (APHRODY_AI_EMBED_BASE_URL puis alias) ; aucune adresse par défaut.
		const url = embedHealthUrl(process.env);
		if (!url) return false;
		const response = await fetch(url, {
			signal: AbortSignal.timeout(1_500),
		});
		return response.ok;
	} catch {
		return false;
	}
}

async function writeShard(manifest: CrawlManifest, urls: string[]): Promise<number> {
	const docs: CorpusDocument[] = [];
	for (const url of urls) {
		const record = manifest.records[url];
		if (!record || !(await validateCompletedRecord(record)) || !record.file || !record.chars)
			continue;
		const markdown = await readFile(join(ROOT, record.file), "utf8");
		docs.push({
			id: docId(url),
			name: `Document link: ${new URL(url).hostname}`,
			url,
			chars: markdown.length,
			markdown,
		});
	}
	await writeJsonAtomically(SHARD_PATH, {
		schema: "shenron-doc-links-rag-shard/v1",
		generatedAt: now(),
		provenanceManifest: relative(ROOT, MANIFEST_PATH),
		docs,
	});
	return docs.length;
}

async function main(): Promise<void> {
	const options = parseOptions(process.argv.slice(2));
	const urls = await readUrls();
	const manifest = await readManifest();
	const reset = await reconcileCompletedRecords(manifest, urls);
	const completedRecords = await Promise.all(
		urls.map((url) => validateCompletedRecord(manifest.records[url] ?? ({} as CrawlRecord)))
	);
	const completed = completedRecords.filter(Boolean).length;

	console.log(
		JSON.stringify(
			{
				schema: MANIFEST_SCHEMA,
				urls: urls.length,
				completed,
				pending: urls.length - completed,
				invalidatedCompletedRecords: reset,
				concurrency: options.concurrency,
				profile: options.profile,
				force: options.force,
				host: options.host,
				rebuild: options.rebuild,
				rebuildOnly: options.rebuildOnly,
				dryRun: options.dryRun,
				manifest: relative(ROOT, MANIFEST_PATH),
			},
			null,
			2
		)
	);
	if (options.dryRun) return;

	await mkdir(RAW_DIR, { recursive: true });
	await writeJsonAtomically(MANIFEST_PATH, manifest);
	// Workers finish in a nondeterministic order. Serialize atomic replacements so
	// a slower worker cannot replace a newer manifest snapshot with an older one.
	let manifestWrite = Promise.resolve();
	function persistManifest(): Promise<void> {
		const snapshot = structuredClone(manifest);
		manifestWrite = manifestWrite.then(() => writeJsonAtomically(MANIFEST_PATH, snapshot));
		return manifestWrite;
	}
	const command = bxcCommand();
	const queue = (options.rebuildOnly ? [] : urls).filter(
		(url) =>
			manifest.records[url]?.status !== "completed" &&
			(!options.host || new URL(url).hostname.toLowerCase() === options.host)
	);
	let cursor = 0;
	let crawled = 0;
	let failed = 0;

	async function worker(): Promise<void> {
		while (true) {
			const url = queue[cursor++];
			if (!url) return;
			const previous = manifest.records[url];
			console.log(`[CRAWL] ${url}`);
			try {
				const markdown = await scrapeMarkdown(command, url, options.profile, options.force);
				const path = rawPath(url);
				await writeFile(path, markdown, "utf8");
				manifest.records[url] = {
					url,
					status: "completed",
					attempts: (previous?.attempts ?? 0) + 1,
					updatedAt: now(),
					file: relative(ROOT, path),
					chars: markdown.length,
					contentSha256: sha256(markdown),
					retrievedAt: now(),
					provenance: {
						sourceList: relative(ROOT, LINKS_PATH),
						extractor: "bxc scrape",
						format: "markdown",
						profile: options.profile,
					},
				};
				crawled++;
				console.log(`[DONE] ${markdown.length} chars ${url}`);
			} catch (error) {
				manifest.records[url] = {
					url,
					status: "failed",
					attempts: (previous?.attempts ?? 0) + 1,
					updatedAt: now(),
					lastError: error instanceof Error ? error.message : String(error),
				};
				failed++;
				console.error(`[FAILED] ${url}: ${manifest.records[url].lastError}`);
			} finally {
				manifest.updatedAt = now();
				await persistManifest();
			}
		}
	}

	await Promise.all(
		Array.from({ length: Math.min(options.concurrency, queue.length) }, () => worker())
	);
	console.log(JSON.stringify({ crawled, failed, skippedCompleted: completed }, null, 2));

	if (!options.rebuild) {
		console.log(
			"Crawl complete. The corpus and RAG were not rebuilt; pass --rebuild to do so explicitly."
		);
		return;
	}

	const documents = await writeShard(manifest, urls);
	if (documents === 0)
		throw new Error("No verified completed captures are available to rebuild the RAG.");
	console.log(`[REBUILD] Merging ${documents} provenance-verified documents into the corpus.`);
	await runCommand(["bun", "apps/bot/scripts/merge-corpus-shards.ts", SHARD_PATH]);
	console.log("[REBUILD] Running the isolated RAG refresh workflow.");
	const refresh = ["bun", "packages/pipeline/scripts/rag-refresh.ts"];
	if (process.env.RAG_BACKEND !== "aphrody" && !(await embeddingsAvailable())) {
		console.warn("[REBUILD] Embedding sidecar unavailable; refreshing the lexical BM25 index only.");
		refresh.push("--no-vectors");
	}
	await runCommand(refresh);
}

if (import.meta.main) {
	main().catch((error) => {
		console.error(`[FATAL] ${error instanceof Error ? error.message : String(error)}`);
		process.exit(1);
	});
}
