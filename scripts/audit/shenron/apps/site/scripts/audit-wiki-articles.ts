#!/usr/bin/env bun
/**
 * Fact-check structurel des articles wiki — lecture seule.
 *
 * Ce contrôle ne transforme jamais une prose douteuse en « vérité » : il marque
 * les fiches à relire quand l'article est sans bibliographie, cite un wiki de
 * fans ou emploie une tournure spéculative. Les faits sont ensuite vérifiés
 * contre le manga/databooks par un rédacteur, puis déposés via le workflow de
 * contribution modérée.
 *
 * Usage: bun apps/site/scripts/audit-wiki-articles.ts [--json] [--newvps]
 */
import { join } from "node:path";
import postgres from "postgres";
import { WIKI_TABLE_SPECS } from "../src/lib/wiki-tables";

const SPECULATIVE =
	/\b(probablement|sans doute|vraisemblablement|on suppose|il semblerait|peut-être)\b/i;
// Do not flag our own canonical `/wiki/...` URLs (the previous broad pattern
// matched `dragonballfr.com/wiki` and produced false positives). Restrict this
// detector to known external fan-wiki hostnames/markers.
const FAN_WIKI = /(?:fandom\.com|dragonballwiki(?:\.com|\.org)?|dragon[-_ ]?ball[-_ ]?wiki)/i;
const ARTICLE_TABLES = [
	"db_characters",
	"db_planets",
	"db_transformations",
	"db_races",
	"db_techniques",
	"db_sagas",
	"db_arcs",
	"db_movies",
	"db_games",
	"db_battles",
	"db_items",
	"db_dragons",
	"db_locations",
	"db_tournaments",
	"db_voice_actors",
	"db_soundtracks",
	"db_episodes",
].filter((table) => WIKI_TABLE_SPECS[table]?.mutableColumns.includes("article"));

async function databaseUrl(): Promise<string> {
	if (process.env.DATABASE_URL?.trim()) return process.env.DATABASE_URL.trim();
	const remote = await Bun.file(join(import.meta.dir, "../../../.env.remote-db"))
		.text()
		.catch(() => "");
	const remoteLine = remote
		.split("\n")
		.findLast((value) => value.startsWith("REMOTE_DATABASE_URL="));
	const remoteValue = remoteLine
		?.slice("REMOTE_DATABASE_URL=".length)
		.trim()
		.replace(/^["']|["']$/g, "");
	if (remoteValue) return remoteValue;
	const env = await Bun.file(join(import.meta.dir, "..", ".env"))
		.text()
		.catch(() => "");
	const line = env.split("\n").findLast((value) => value.startsWith("DATABASE_URL="));
	const value = line
		?.slice("DATABASE_URL=".length)
		.trim()
		.replace(/^["']|["']$/g, "");
	if (!value) throw new Error("DATABASE_URL introuvable.");
	return value;
}

/**
 * The development checkout has no local `shenron_site` cluster. `--newvps`
 * opens a short-lived SSH tunnel to the canonical PostgreSQL instance instead
 * of weakening pg_hba.conf or copying credentials into another file.
 */
async function connectThroughNewVps(url: string): Promise<{ url: string; close: () => void }> {
	if (!process.argv.includes("--newvps")) return { url, close: () => {} };
	// Avoid colliding with a tunnel left by a previous audit invocation.
	const localPort = 20000 + (process.pid % 20000);
	const tunnel = Bun.spawn(
		[
			"ssh",
			"-o",
			"ExitOnForwardFailure=yes",
			"-o",
			"ServerAliveInterval=30",
			"-N",
			"-L",
			`${localPort}:127.0.0.1:5432`,
			"newvps",
		],
		{ stdout: "ignore", stderr: "pipe" }
	);
	await new Promise((resolve) => setTimeout(resolve, 500));
	if (tunnel.exitCode !== null) throw new Error("Le tunnel SSH newvps n'a pas pu être établi.");
	const target = new URL(url);
	target.hostname = "127.0.0.1";
	target.port = String(localPort);
	return { url: target.toString(), close: () => tunnel.kill() };
}

type Finding = "missing_sources" | "fan_wiki_reference" | "speculation";
interface ArticleFinding {
	table: string;
	id: string;
	label: string;
	findings: Finding[];
}

/** Normalise jsonb and legacy text columns (some tables store JSON arrays as text). */
function parseSources(value: unknown): unknown[] {
	if (Array.isArray(value)) return value;
	if (typeof value !== "string" || value.trim() === "") return [];
	try {
		const parsed: unknown = JSON.parse(value);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

const tunneled = await connectThroughNewVps(await databaseUrl());
const sql = postgres(tunneled.url, { max: 2, prepare: false });
try {
	const findings: ArticleFinding[] = [];
	for (const table of ARTICLE_TABLES) {
		const columns = new Set(
			(
				await sql.unsafe(`
			SELECT column_name FROM information_schema.columns
			WHERE table_schema = 'bot' AND table_name = '${table}'
		`)
			).map((row) => String((row as unknown as { column_name: string }).column_name))
		);
		if (!columns.has("article")) continue;
		const labelColumn =
			["name", "title", "slug", "id"].find((column) => columns.has(column)) ?? "id";
		const sourceColumn = columns.has("article_sources") ? "article_sources" : "NULL::jsonb";
		const rows = await sql.unsafe(`
			SELECT id, COALESCE(${labelColumn}::text, id::text) AS label, article, ${sourceColumn} AS article_sources
			FROM bot.${table}
			WHERE COALESCE(visible, true) = true
			  AND article IS NOT NULL AND length(trim(article)) > 0
		`);
		for (const row of rows as Array<Record<string, unknown>>) {
			const article = String(row.article ?? "");
			const rawSources = row.article_sources;
			const sourceText =
				typeof rawSources === "string" ? rawSources : JSON.stringify(rawSources ?? "");
			const rowFindings: Finding[] = [];
			const sources = parseSources(rawSources);
			if (sources.length === 0) rowFindings.push("missing_sources");
			if (FAN_WIKI.test(`${article}\n${sourceText}`)) rowFindings.push("fan_wiki_reference");
			if (SPECULATIVE.test(article)) rowFindings.push("speculation");
			if (rowFindings.length)
				findings.push({
					table,
					id: String(row.id),
					label: String(row.label),
					findings: rowFindings,
				});
		}
	}

	const report = {
		schema: "shenron-wiki-article-factcheck/v1",
		generatedAt: new Date().toISOString(),
		tables: ARTICLE_TABLES,
		flagged: findings.length,
		findings,
		ok: findings.length === 0,
	};
	if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
	else {
		console.log(`${findings.length} article(s) à relire`);
		for (const finding of findings)
			console.log(
				`- ${finding.table}#${finding.id} ${finding.label}: ${finding.findings.join(", ")}`
			);
	}
	// Un rapport avec des alertes est un résultat utile, mais ne doit pas masquer
	// les erreurs de connexion ou de requête : le code de sortie reste 0.
} catch (error) {
	const message = error instanceof Error ? error.message : "erreur inconnue";
	console.error(`Fact-check wiki impossible : ${message}`);
	process.exitCode = 1;
} finally {
	await sql.end();
	tunneled.close();
}
