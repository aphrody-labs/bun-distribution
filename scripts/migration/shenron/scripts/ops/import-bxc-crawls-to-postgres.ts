#!/usr/bin/env bun

/**
 * Imports local BXC crawl records into PostgreSQL without promoting them to canon.
 *
 * Usage:
 *   DATABASE_URL=... bun scripts/ops/import-bxc-crawls-to-postgres.ts <bxc.sqlite...>
 */
import { createHash } from "node:crypto";
import postgres from "postgres";
import { Database } from "bun:sqlite";
import { decodeHtmlEntities, decodeHtmlEntitiesInMarkdown } from "../../../../../apps/shenron/site/src/lib/text/html-entities";

type BxcRow = {
	url: string;
	status: number | null;
	metadata: string | null;
	markdown: string | null;
	content: string | null;
	timestamp: string | null;
};

/** PostgreSQL `text` and `jsonb` reject NUL bytes found in malformed crawls. */
function databaseText(value: string): string {
	return value.replaceAll("\0", "");
}

function databaseJson(value: unknown): unknown {
	if (typeof value === "string") return databaseText(value);
	if (Array.isArray(value)) return value.map(databaseJson);
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>).map(([key, child]) => [
				databaseText(key),
				databaseJson(child),
			]),
		);
	}
	return value;
}

const databases = process.argv.slice(2);
if (databases.length === 0) throw new Error("Au moins une base BXC SQLite est requise.");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL est requis.");

const publisherHosts = new Set([
	"toei-animation.com",
	"shueisha.co.jp",
	"shonenjumpplus.com",
	"viz.com",
	"bandainamcoent.eu",
]);

function hasHost(host: string, domain: string): boolean {
	return host === domain || host.endsWith(`.${domain}`);
}

function classify(url: string): string {
	const parsed = new URL(url);
	const host = parsed.hostname.toLowerCase();
	if (hasHost(host, "dragon-ball-official.com")) return "reference";
	if ([...publisherHosts].some((domain) => hasHost(host, domain))) return "publisher";
	if (hasHost(host, "archive.org") || hasHost(host, "web.archive.org")) return "archive";
	if (hasHost(host, "jajanken.net")) return "statistics";
	if (/\.(?:mp4|webm|m3u8|mp3|wav|webp|png|jpe?g|gif|avif)(?:$|[?#])/i.test(url)) return "media";
	return "reference";
}

/**
 * BXC keeps `<title>` as raw HTML text: its character references are decoded
 * once here (URLs untouched), so every consumer reads plain text. The URL
 * fallback is an identifier and is never decoded.
 */
function parseTitle(metadata: string | null, fallback: string): string {
	const title = parseMetadata(metadata).title;
	const decoded = typeof title === "string" ? decodeHtmlEntities(title, { preserveUrls: true }).trim() : "";
	return decoded ? databaseText(decoded).slice(0, 1_000) : databaseText(fallback);
}

/** Métadonnées BXC conservées telles quelles, dont `crawlSource` après consolidation. */
function parseMetadata(metadata: string | null): Record<string, unknown> {
	if (!metadata) return {};
	try {
		const parsed: unknown = JSON.parse(metadata);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (databaseJson(parsed) as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}

/** Assets référencés dans les contenus BXC : indexés comme documents `media`. */
function extractMediaUrls(content: string | null): string[] {
	if (!content) return [];
	const urls = new Set<string>();
	const pattern = /https?:\/\/[^\s"'<>\\]+?\.(?:avif|gif|jpe?g|m4a|mp3|ogg|png|svg|wav|webm|webp)(?:\?[^\s"'<>\\]*)?/gi;
	for (const match of content.matchAll(pattern)) {
		const url = match[0].replace(/[),.;]+$/, "");
		try {
			const parsed = new URL(url);
			if (parsed.protocol === "http:" || parsed.protocol === "https:") urls.add(parsed.href);
		} catch {
			// Un lien malformé ne doit pas interrompre l'indexation de la campagne.
		}
	}
	return [...urls];
}

function mediaTitle(url: string): string {
	try {
		const name = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).at(-1) || url);
		// Asset URLs lifted from raw HTML attributes carry `&amp;` into file names.
		return databaseText(decodeHtmlEntities(name)).slice(0, 1_000);
	} catch {
		return url;
	}
}

const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 8 });
let imported = 0;
const concurrency = Math.min(8, Math.max(1, Number.parseInt(process.env.BXC_IMPORT_CONCURRENCY ?? "8", 10) || 8));

async function importRow(row: BxcRow): Promise<void> {
	// Decoded before whitespace is collapsed, while code fences are still on their own lines.
	const text = decodeHtmlEntitiesInMarkdown(row.markdown || row.content || "", { preserveUrls: true });
	const excerpt = databaseText(text.replace(/\s+/g, " ").trim()).slice(0, 8_000);
	const contentHash = createHash("sha256").update(row.markdown || row.content || row.url).digest("hex");
	const provenance = parseMetadata(row.metadata);
	await sql`
		INSERT INTO public.external_source_records
			(url, kind, title, excerpt, http_status, content_hash, fetched_at, canonical_eligible)
		VALUES
			(${row.url}, ${classify(row.url)}, ${parseTitle(row.metadata, row.url)}, ${excerpt}, ${row.status ?? 0}, ${contentHash}, ${row.timestamp ?? new Date().toISOString()}, false)
		ON CONFLICT (url) DO UPDATE SET
			kind = EXCLUDED.kind,
			title = EXCLUDED.title,
			excerpt = EXCLUDED.excerpt,
			http_status = EXCLUDED.http_status,
			content_hash = EXCLUDED.content_hash,
			fetched_at = EXCLUDED.fetched_at
	`;
	await sql`
		INSERT INTO public.external_source_provenance (url, provenance, updated_at)
		VALUES (${row.url}, ${sql.json(provenance)}::jsonb, now())
		ON CONFLICT (url) DO UPDATE SET provenance = EXCLUDED.provenance, updated_at = EXCLUDED.updated_at
	`;
	imported++;

	for (const mediaUrl of extractMediaUrls(row.markdown || row.content)) {
		await sql`
			INSERT INTO public.external_source_records
				(url, kind, title, excerpt, http_status, content_hash, fetched_at, canonical_eligible)
			VALUES
				(${mediaUrl}, 'media', ${mediaTitle(mediaUrl)}, ${`Asset BXC discovered from ${row.url}`}, ${row.status ?? 0}, ${createHash("sha256").update(mediaUrl).digest("hex")}, ${row.timestamp ?? new Date().toISOString()}, false)
			ON CONFLICT (url) DO UPDATE SET
				kind = EXCLUDED.kind,
				title = EXCLUDED.title,
				excerpt = EXCLUDED.excerpt,
				http_status = EXCLUDED.http_status,
				content_hash = EXCLUDED.content_hash,
				fetched_at = EXCLUDED.fetched_at
		`;
		await sql`
			INSERT INTO public.external_source_provenance (url, provenance, updated_at)
			VALUES (${mediaUrl}, ${sql.json({ ...provenance, parentUrl: row.url })}::jsonb, now())
			ON CONFLICT (url) DO UPDATE SET provenance = EXCLUDED.provenance, updated_at = EXCLUDED.updated_at
		`;
		imported++;
	}
}

try {
	// Le moteur de recherche BXC n'est pas optionnel : les pages restent dans
	// leur classe de provenance, mais titre + extrait reçoivent un index GIN pour
	// l'API et l'interface, quelle que soit la source.
	await sql`
		CREATE TABLE IF NOT EXISTS public.external_source_records (
			url text PRIMARY KEY,
			kind text NOT NULL,
			title text NOT NULL,
			excerpt text NOT NULL,
			http_status integer NOT NULL,
			content_hash text NOT NULL,
			fetched_at timestamptz NOT NULL DEFAULT now(),
			canonical_eligible boolean NOT NULL DEFAULT false,
			search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(excerpt, ''))) STORED
		)
	`;
	try {
		await sql`
			ALTER TABLE public.external_source_records
			ADD COLUMN IF NOT EXISTS search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(excerpt, ''))) STORED
		`;
		await sql`
			CREATE INDEX IF NOT EXISTS external_source_records_search_vector_idx
			ON public.external_source_records
			USING gin (search_vector)
		`;
		await sql`
			CREATE INDEX IF NOT EXISTS external_source_records_kind_fetched_idx
			ON public.external_source_records (kind, fetched_at DESC)
		`;
	} catch (error) {
		// Une table éditoriale peut appartenir à un rôle de migration distinct :
		// l'import reste possible avec ses droits INSERT/UPDATE existants.
		if (!(error && typeof error === "object" && "code" in error && error.code === "42501")) throw error;
	}
	await sql`
		CREATE TABLE IF NOT EXISTS public.external_source_provenance (
			url text PRIMARY KEY,
			provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
			updated_at timestamptz NOT NULL DEFAULT now()
		)
	`;
	const running = new Set<Promise<void>>();
	for (const path of databases) {
		const database = new Database(path, { readonly: true });
		const rows = database
			.query<BxcRow, []>(
				"SELECT url, status, metadata, markdown, content, timestamp FROM scrapes ORDER BY id",
			)
			.all();
		database.close();

		for (const row of rows) {
			const task = importRow(row);
			running.add(task);
			void task.then(
				() => running.delete(task),
				() => running.delete(task),
			);
			if (running.size >= concurrency) await Promise.race(running);
		}
	}
	await Promise.all(running);
	console.log(JSON.stringify({ imported, databases: databases.length }));
} finally {
	await sql.end();
}
