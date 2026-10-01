#!/usr/bin/env bun
import { tempPath } from "@aphrody/paths";
/**
 * Crawls public, text-based documentary sources and indexes the resulting RAG corpus.
 * Usage: bun scripts/bxc-crawl-massive.ts
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { join, resolve } from "node:path";
import os from "node:os";
import { embedHealthUrl } from "@shenron/pipeline/ai/config";

// Paths
const ROOT = join(import.meta.dirname, "..");
const DOC_LINKS_PATH = join(ROOT, "data/doc-links.json");
const RAG_RAW_DIR = join(ROOT, "apps/bot/data/rag/raw/google-doc");
const SHARD_PATH = tempPath("shard-google-doc.json");
const DB_PROD = join(ROOT, "apps/bot/data/bot.db");
const candidateRoots = [
	process.env.BXC_DIR,
	process.env.BXC_ROOT,
	resolve(ROOT, "..", "aphrody-web", "apps", "bxc"),
	join(os.homedir(), "bxc"),
].filter((p): p is string => Boolean(p));
const BXC_DIR = candidateRoots.find((p) => existsSync(p)) ?? join(os.homedir(), "bxc");
const BXC_BIN = process.env.BXC_BIN?.trim() || (existsSync(join(BXC_DIR, "bin", "bxc")) ? join(BXC_DIR, "bin", "bxc") : join(BXC_DIR, "bin", "bxc.mjs"));

// Bounded concurrency avoids overwhelming source hosts.
const CONCURRENCY = 6;
const DOCUMENTARY_HOSTS = new Set([
	"web.archive.org",
	"www.neoseeker.com",
]);

function isUsableMarkdown(markdown: string): boolean {
	if (markdown.length <= 50) return false;
	const replacementCharacters = (markdown.match(/�/g) ?? []).length;
	return replacementCharacters / markdown.length < 0.005;
}

// Ensure BXC is available before starting.
const onPath = Bun.which("bxc") != null;
const hasBin = existsSync(BXC_BIN);
if (!onPath && !hasBin) {
	console.error("BXC is not installed.");
	process.exit(1);
}

async function execBxcScrape(url: string): Promise<string | null> {
	const cmd = [];
	if (onPath) {
		cmd.push("bxc");
	} else {
		cmd.push(BXC_BIN);
	}
	cmd.push("scrape", url, "--markdown", "--profile", "stealth");

	try {
		const proc = Bun.spawn(cmd, {
			stdout: "pipe",
			stderr: "ignore",
		});

		// Abort a stalled source request after 30 seconds.
		const timeout = setTimeout(() => {
			try {
				proc.kill();
			} catch {}
		}, 30000);

		const stdout = await new Response(proc.stdout).text();
		const code = await proc.exited;
		clearTimeout(timeout);

		if (code === 0 && isUsableMarkdown(stdout)) {
			return stdout;
		}
	} catch {
		// Individual sources are best-effort.
	}
	return null;
}

function getSlug(urlStr: string): string {
	try {
		const url = new URL(urlStr);
		let path = url.pathname.replace(/^\/|\/$/g, "");
		if (url.search) {
			path += "-" + url.search.replace(/[^a-zA-Z0-9]/g, "-");
		}
		if (url.hash) {
			path += "-" + url.hash.replace(/[^a-zA-Z0-9]/g, "-");
		}
		if (!path) return "index";
		return path
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "");
	} catch {
		return "page-" + Math.random().toString(36).substring(2, 8);
	}
}

async function runCmd(cmd: string[], cwd = ROOT): Promise<void> {
	console.log(`[EXEC] ${cmd.join(" ")}`);
	const proc = Bun.spawn(cmd, {
		cwd,
		env: { ...process.env },
		stdout: "inherit",
		stderr: "inherit",
	});
	const code = await proc.exited;
	if (code !== 0) {
		throw new Error(`Commande échouée (code: ${code}): ${cmd.join(" ")}`);
	}
}

async function embeddingsAvailable(): Promise<boolean> {
	try {
		// Résolveur unique (APHRODY_AI_EMBED_BASE_URL puis alias) ; aucune adresse par défaut.
		const url = embedHealthUrl(process.env);
		if (!url) return false;
		const response = await fetch(url, {
			signal: AbortSignal.timeout(1500),
		});
		return response.ok;
	} catch {
		return false;
	}
}

async function main() {
	console.log("=== DOCUMENTARY CRAWL AND RAG INDEX PIPELINE ===");

	if (!existsSync(DOC_LINKS_PATH)) {
		console.error(`Document link file not found: ${DOC_LINKS_PATH}`);
		process.exit(1);
	}

	const data = JSON.parse(readFileSync(DOC_LINKS_PATH, "utf-8"));
	const urls: string[] = data.urls || [];
	console.log(`Total URLs: ${urls.length}`);

	// Exclude media, scan-reading, and non-documentary hosts. Sources are stored
	// only when BXC yields readable text, never as proxied assets.
	const filteredUrls = urls.filter((url) => {
		try {
			return DOCUMENTARY_HOSTS.has(new URL(url).hostname.toLowerCase());
		} catch {
			return false;
		}
	});
	console.log(`Eligible documentary URLs: ${filteredUrls.length}`);

	mkdirSync(RAG_RAW_DIR, { recursive: true });

	const shardDocs: any[] = [];
	const queue = [...filteredUrls];

	console.log(`\n[1/4] Crawling with concurrency ${CONCURRENCY}...`);

	async function worker() {
		while (queue.length > 0) {
			const url = queue.shift();
			if (!url) continue;

			const slug = getSlug(url);
			const host = new URL(url).hostname;
			const fileId = `gdoc-${slug}`;
			const mdPath = join(RAG_RAW_DIR, `${slug}.md`);

			console.log(`[*] Scraping [${host}] ${url}...`);
			const markdown = await execBxcScrape(url);
			if (markdown) {
				writeFileSync(mdPath, markdown, "utf-8");
				shardDocs.push({
					id: fileId,
					name: `Source Google Doc: ${slug}`,
					url: url,
					chars: markdown.length,
					markdown: markdown,
				});
				console.log(`  ✓ Collected (${markdown.length} chars) -> ${slug}.md`);
			} else {
				console.log(`  ✗ Empty or failed: ${url}`);
			}
			// Small courtesy delay between requests to the same worker.
			await new Promise((r) => setTimeout(r, 500));
		}
	}

	// Lancer les workers de concurrence
	const workers = Array.from({ length: CONCURRENCY }, () => worker());
	await Promise.all(workers);

	console.log(`\n[2/4] Writing crawl shard: ${shardDocs.length} documents.`);
	writeFileSync(SHARD_PATH, JSON.stringify({ docs: shardDocs }, null, 2), "utf-8");

	console.log("\n[3/4] Merging documents into corpus.json...");
	await runCmd(["bun", "apps/bot/scripts/merge-corpus-shards.ts", SHARD_PATH]);

	console.log("\n[4/4] Rebuilding the SQLite RAG index...");
	// Build on a database copy, then swap only after successful completion.
	if (existsSync(DB_PROD)) {
		console.log("[RAG] Creating a consistent production database copy...");
		if (existsSync(tempPath("rag.db"))) {
			try {
				const { unlinkSync } = await import("node:fs");
				unlinkSync(tempPath("rag.db"));
			} catch {}
		}
		const { Database } = await import("bun:sqlite");
		const db = new Database(DB_PROD);
		db.run(`VACUUM INTO '${tempPath("rag.db").replaceAll("'", "''")}'`);
		db.close();
	}
	process.env.RAG_DB = tempPath("rag.db");
	const withVectors = await embeddingsAvailable();
	if (!withVectors) console.warn("[RAG] Embedding service unavailable; building the lexical FTS index only.");
	await runCmd(["bun", "apps/bot/scripts/rag-build.ts", ...(withVectors ? [] : ["--no-vectors"])]);

	// Replace the RAG database only after the index build succeeds.
	if (existsSync(tempPath("rag.db"))) {
		console.log(`[RAG] Replacing ${DB_PROD} with the rebuilt database...`);
		const dbBackup = `${DB_PROD}.bak`;
		if (existsSync(DB_PROD)) {
			copyFileSync(DB_PROD, dbBackup);
		}
		copyFileSync(tempPath("rag.db"), DB_PROD);
		console.log("RAG database updated.");
	}

	console.log("\n=== PIPELINE COMPLETED ===");
}

main().catch((err) => {
	console.error("Fatal pipeline error:", err);
	process.exit(1);
});
