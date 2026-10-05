#!/usr/bin/env bun
/**
 * Persistent content-session pipeline.
 *
 * It keeps a durable, secret-free checkpoint of each enrichment session:
 * completed BXC crawl databases are indexed, collected records are materialized
 * into attributed wiki pages, official news is published as a pointer, live
 * readers can be refreshed, and the resulting public coverage is measured from
 * PostgreSQL. Every step is independently retryable; a failed source never
 * erases a prior result.
 *
 * Usage:
 *   DATABASE_URL=... bun scripts/ops/run-content-session-pipeline.ts --apply
 *   DATABASE_URL=... bun scripts/ops/run-content-session-pipeline.ts --apply --refresh-players
 */
import { mkdir, readdir, rename, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";

const apply = process.argv.includes("--apply");
const refreshPlayers = process.argv.includes("--refresh-players");
const root = join(import.meta.dir, "../..");
const memoryDir = join(root, "data", "session-pipeline");
const memoryPath = join(memoryDir, "latest.json");
const bxcStateDir = process.env.BXC_STATE_DIR || join(homedir(), ".bxc");
async function databaseUrl(): Promise<string> {
	const direct = process.env.DATABASE_URL?.trim();
	if (direct) return direct;
	for (const path of [join(root, ".env"), join(root, "apps", "site", ".env")]) {
		const content = await readFile(path, "utf8").catch(() => "");
		const value = content
			.split("\n")
			.filter((line) => line.startsWith("DATABASE_URL="))
			.at(-1)
			?.slice("DATABASE_URL=".length)
			.trim()
			.replace(/^['"]|['"]$/g, "");
		if (value) return value;
	}
	throw new Error("DATABASE_URL is required");
}

type Step = {
	name: string;
	status: "ok" | "skipped" | "failed";
	detail: string;
	durationMs: number;
};
const steps: Step[] = [];

async function run(name: string, argv: string[]): Promise<void> {
	const started = Date.now();
	const proc = Bun.spawn(argv, {
		cwd: root,
		env: { ...process.env },
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	const code = await proc.exited;
	const detail = `${stdout}\n${stderr}`.trim().split("\n").filter(Boolean).at(-1) || `exit ${code}`;
	steps.push({
		name,
		status: code === 0 ? "ok" : "failed",
		detail: detail.slice(0, 400),
		durationMs: Date.now() - started,
	});
}

async function crawlDatabases(): Promise<string[]> {
	const entries = await readdir(bxcStateDir, { withFileTypes: true }).catch(() => []);
	const databases: string[] = [];
	for (const entry of entries) {
		if (
			!entry.isDirectory() ||
			(!entry.name.startsWith("dragonball-") && !entry.name.startsWith("toei-"))
		)
			continue;
		const candidate = join(bxcStateDir, entry.name, "bxc.sqlite");
		if (await Bun.file(candidate).exists()) databases.push(candidate);
	}
	return databases.toSorted();
}

const sql = postgres(await databaseUrl(), { max: 2, prepare: false, onnotice: () => {} });
try {
	const crawls = await crawlDatabases();
	if (apply && crawls.length) {
		await run("bxc-import", [
			process.execPath,
			"scripts/ops/import-bxc-crawls-to-postgres.ts",
			...crawls,
		]);
	} else {
		steps.push({
			name: "bxc-import",
			status: "skipped",
			detail: apply
				? "no completed BXC crawl database"
				: `${crawls.length} crawl databases pending`,
			durationMs: 0,
		});
	}

	if (apply && refreshPlayers) {
		await run("player-refresh", [
			process.execPath,
			"apps/bot/scripts/refresh-dead-embed-players.ts",
		]);
	} else {
		steps.push({
			name: "player-refresh",
			status: "skipped",
			detail: refreshPlayers ? "dry-run" : "not requested",
			durationMs: 0,
		});
	}

	// Writer: collected records become explicitly attributed source pages. This
	// does not infer lore or canon, and each write is versioned by the materializer.
	if (apply) {
		await run("wiki-materialize", [
			process.execPath,
			"apps/site/scripts/materialize-crawled-wiki-pages.ts",
			"--limit",
			"100",
			"--appliquer",
		]);
		await run("wiki-reconcile", [
			process.execPath,
			"apps/site/scripts/reconcile-crawled-editorial-content.ts",
			"--limit",
			"50000",
			"--appliquer",
		]);
	} else {
		steps.push({
			name: "wiki-materialize",
			status: "skipped",
			detail: "dry-run",
			durationMs: 0,
		});
		steps.push({
			name: "wiki-reconcile",
			status: "skipped",
			detail: "dry-run",
			durationMs: 0,
		});
	}

	// Journalist: publish only a short, attributed pointer to Dragon Ball
	// Official. The importer keeps the upstream text on its canonical URL.
	if (apply) {
		await run("official-news", [process.execPath, "apps/site/scripts/import-dbofficial-news.ts"]);
	} else {
		steps.push({
			name: "official-news",
			status: "skipped",
			detail: "dry-run",
			durationMs: 0,
		});
	}

	const [coverage] = await sql<
		{
			sources: number;
			episodes: number;
			episodePlayers: number;
			movies: number;
			moviePlayers: number;
			manga: number;
			mangaPages: number;
			databooks: number;
			databookContent: number;
		}[]
	>`
		SELECT
			(SELECT count(*)::int FROM public.external_source_records WHERE http_status BETWEEN 200 AND 299) AS sources,
			(SELECT count(*)::int FROM bot.db_episodes WHERE visible) AS episodes,
			(SELECT count(*)::int FROM bot.db_episodes WHERE visible AND jsonb_typeof(players) = 'array' AND jsonb_array_length(players) > 0) AS "episodePlayers",
			(SELECT count(*)::int FROM bot.db_movies WHERE visible) AS movies,
			(SELECT count(*)::int FROM bot.db_movies WHERE visible AND jsonb_typeof(players) = 'array' AND jsonb_array_length(players) > 0) AS "moviePlayers",
			(SELECT count(*)::int FROM bot.db_manga_chapters WHERE visible) AS manga,
			(SELECT count(*)::int FROM bot.db_manga_chapters WHERE visible AND jsonb_typeof(pages) = 'array' AND jsonb_array_length(pages) > 0) AS "mangaPages",
			(SELECT count(*)::int FROM bot.db_databooks WHERE visible) AS databooks,
			(SELECT count(*)::int FROM bot.db_databooks WHERE visible AND ((description IS NOT NULL AND btrim(description) <> '') OR (jsonb_typeof(pages) = 'array' AND jsonb_array_length(pages) > 0))) AS "databookContent"`;

	const report = {
		schema: "shenron-content-session/v1",
		at: new Date().toISOString(),
		apply,
		crawls,
		steps,
		coverage,
	};
	await mkdir(memoryDir, { recursive: true });
	const temporary = `${memoryPath}.${process.pid}.tmp`;
	await Bun.write(temporary, `${JSON.stringify(report, null, 2)}\n`);
	await rename(temporary, memoryPath);
	console.log(JSON.stringify(report));
} finally {
	await sql.end();
}
