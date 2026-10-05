#!/usr/bin/env bun
/**
 * Build review-ready, primary-source evidence bundles for WikiPage candidates.
 *
 * This is deliberately a read-only preparation tool.  It does not update a
 * WikiPage, generate prose, or infer a fact from an OCR match.  A bundle is
 * only a reproducible pointer to a source page whose text contains an exact
 * candidate name (or an explicit alias).  An empty bundle is a valid outcome.
 *
 * Usage:
 *   bun scripts/ops/wiki-corpus-enricher.ts --input candidates.json --output bundles.json
 *   bun scripts/ops/wiki-corpus-enricher.ts --input candidates.json --stdout
 *
 * Input is either an array of candidates or `{ "candidates": [...] }`.
 * A candidate needs `id`, `title`, and `slug`; optional `aliases` and `nameJa`
 * widen exact matching only.  No candidate field is treated as a claim.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { rename } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";
import { defautDePlanche } from "../../../../../apps/shenron/site/src/lib/databooks-defauts";

export type WikiPageCandidate = {
	id: string;
	title: string;
	slug: string;
	aliases?: string[];
	nameJa?: string | null;
};

export type CorpusRecord = {
	kind: "manga" | "databook";
	/** Stable location in the primary-source corpus, never an inferred fact. */
	locator: { series?: string; volume?: string; page: number; databookId?: number };
	document: string;
	sourceUrl: string;
	text: string;
	/** Databook pages require a human-reviewed transcription; manga rows are source OCR. */
	verified: boolean;
};

export type Evidence = {
	id: string;
	kind: "manga" | "databook";
	document: string;
	locator: CorpusRecord["locator"];
	sourceUrl: string;
	matchedTerm: string;
	excerpt: string;
	/** SHA-256 of the complete source transcription, not merely the excerpt. */
	textSha256: string;
};

export type EvidenceBundle = {
	candidate: Pick<WikiPageCandidate, "id" | "title" | "slug">;
	status: "evidence_found" | "no_primary_evidence";
	evidence: Evidence[];
};

export type SourceBundleDocument = {
	schemaVersion: 1;
	bundles: EvidenceBundle[];
};

const MAX_EVIDENCE_PER_CANDIDATE = 12;

function normalized(value: string): string {
	return value
		.normalize("NFKC")
		.toLocaleLowerCase("und")
		.replace(/\s+/g, " ")
		.trim();
}

function escaped(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsCjk(value: string): boolean {
	return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value);
}

/**
 * Match whole words for Latin names and exact CJK tokens for Japanese names.
 * Short terms are rejected: an OCR occurrence of "Ki" or "神" is not reliable
 * provenance for a wiki page.
 */
export function containsExactTerm(text: string, term: string): boolean {
	const needle = normalized(term);
	if (containsCjk(needle)) {
		if ([...needle].length < 3) return false;
		return new RegExp(
			// Hiragana particles commonly follow a Japanese name (孫悟空の), so they
			// are not treated as a continuation of the entity. Han and katakana
			// still prevent accepting a term embedded in another proper noun.
			`(?<![\\p{Script=Han}\\p{Script=Katakana}])${escaped(needle)}(?![\\p{Script=Han}\\p{Script=Katakana}])`,
			"u"
		).test(normalized(text));
	}
	if ([...needle].length < 4) return false;
	return new RegExp(`(?<![\\p{L}\\p{N}])${escaped(needle)}(?![\\p{L}\\p{N}])`, "u").test(
		normalized(text)
	);
}

function excerptFor(text: string, term: string): string {
	const source = text.replace(/\s+/g, " ").trim();
	const at = normalized(source).indexOf(normalized(term));
	if (at < 0) return source.slice(0, 280);
	const start = Math.max(0, at - 120);
	const end = Math.min(source.length, at + term.length + 160);
	return `${start > 0 ? "…" : ""}${source.slice(start, end)}${end < source.length ? "…" : ""}`;
}

function recordId(record: CorpusRecord): string {
	const l = record.locator;
	return record.kind === "manga"
		? `manga:${l.series}:${l.volume}:${l.page}`
		: `databook:${l.databookId}:${l.page}`;
}

function termsFor(candidate: WikiPageCandidate): string[] {
	return [...new Set([candidate.title, candidate.nameJa ?? "", ...(candidate.aliases ?? [])].map((v) => v.trim()).filter(Boolean))]
		.filter((term) => (containsCjk(term) ? [...normalized(term)].length >= 3 : [...normalized(term)].length >= 4))
		.toSorted((a, b) => normalized(a).localeCompare(normalized(b), "und"));
}

/** Pure, deterministic transformation suitable for review and focused tests. */
export function buildSourceBundles(
	candidates: readonly WikiPageCandidate[],
	records: readonly CorpusRecord[],
	limit = MAX_EVIDENCE_PER_CANDIDATE
): SourceBundleDocument {
	if (!Number.isInteger(limit) || limit < 1) throw new Error("limit must be a positive integer");
	const sortedRecords = records
		.filter((record) => record.verified && record.text.trim() !== "" && record.sourceUrl.startsWith('https://'))
		.toSorted((a, b) => recordId(a).localeCompare(recordId(b), "und"));
	const bundles = [...candidates]
		.toSorted((a, b) => a.id.localeCompare(b.id, "und"))
		.map((candidate) => {
			const evidence: Evidence[] = [];
			for (const record of sortedRecords) {
				const term = termsFor(candidate).find((candidateTerm) => containsExactTerm(record.text, candidateTerm));
				if (!term) continue;
				evidence.push({
					id: recordId(record),
					kind: record.kind,
					document: record.document,
					locator: record.locator,
					sourceUrl: record.sourceUrl,
					matchedTerm: term,
					excerpt: excerptFor(record.text, term),
					textSha256: createHash("sha256").update(record.text).digest("hex"),
				});
				if (evidence.length === limit) break;
			}
			return {
				candidate: { id: candidate.id, title: candidate.title, slug: candidate.slug },
				status: evidence.length ? "evidence_found" : "no_primary_evidence",
				evidence,
			} satisfies EvidenceBundle;
		});
	return { schemaVersion: 1, bundles };
}

export function parseCandidates(value: unknown): WikiPageCandidate[] {
	const items = Array.isArray(value)
		? value
		: value && typeof value === "object" && Array.isArray((value as { candidates?: unknown }).candidates)
			? (value as { candidates: unknown[] }).candidates
			: null;
	if (!items) throw new Error("input must be a candidate array or an object with a candidates array");
	const ids = new Set<string>();
	return items.map((item, index) => {
		if (!item || typeof item !== "object") throw new Error(`candidate ${index} is not an object`);
		const row = item as Record<string, unknown>;
		const id = typeof row.id === "string" ? row.id.trim() : "";
		const title = typeof row.title === "string" ? row.title.trim() : "";
		const slug = typeof row.slug === "string" ? row.slug.trim() : "";
		if (!id || !title || !slug) throw new Error(`candidate ${index} needs non-empty id, title, and slug`);
		if (ids.has(id)) throw new Error(`duplicate candidate id: ${id}`);
		ids.add(id);
		if (row.aliases !== undefined && (!Array.isArray(row.aliases) || !row.aliases.every((v) => typeof v === "string")))
			throw new Error(`candidate ${id} aliases must be an array of strings`);
		if (row.nameJa !== undefined && row.nameJa !== null && typeof row.nameJa !== "string")
			throw new Error(`candidate ${id} nameJa must be a string or null`);
		return { id, title, slug, aliases: row.aliases as string[] | undefined, nameJa: row.nameJa as string | null | undefined };
	});
}

async function databaseUrl(): Promise<string> {
	if (process.env.DATABASE_URL?.trim()) return process.env.DATABASE_URL.trim();
	const siteEnv = await Bun.file(join(import.meta.dir, "../../apps/site/.env")).text().catch(() => "");
	const line = siteEnv.split("\n").filter((value) => value.startsWith("DATABASE_URL=")).at(-1);
	const url = line?.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");
	if (!url) throw new Error("DATABASE_URL is required to read the primary-source corpus");
	return url;
}

async function loadCorpusRecords(): Promise<CorpusRecord[]> {
	const sql = postgres(await databaseUrl(), { max: 2, prepare: false });
	try {
		const manga = (await sql`
			select p.series, p.tome, p.planche, p.text, v.id as volume_id
			from bot.db_manga_pages p
			join bot.db_manga_volumes v
			  on v.series = p.series
			 and v.volume_number = nullif(regexp_replace(p.tome, '\\D', '', 'g'), '')::int
			where coalesce(p.text, '') <> '' and v.visible
		`) as unknown as { series: string; tome: string; planche: number; text: string; volume_id: number }[];
		const databooks = (await sql`
			select d.id, d.title, p as page
			from bot.db_databooks d, jsonb_array_elements(d.pages) p
			where d.visible
		`) as unknown as { id: number; title: string; page: Record<string, unknown> }[];
		const records: CorpusRecord[] = manga.map((row) => ({
			kind: "manga",
			locator: { series: row.series, volume: row.tome, page: Number(row.planche) },
			document: `Manga ${row.series} — tome ${row.tome}`,
			sourceUrl: `https://dragonballfr.com/wiki/manga/volume/${row.volume_id}#planche-${row.planche}`,
			text: row.text,
			verified: true,
		}));
		for (const row of databooks) {
			const text = typeof row.page.text === "string" ? row.page.text : "";
			const page = Number(row.page.number);
			if (!Number.isInteger(page) || !text || row.page.verifiee !== true || defautDePlanche(row.page, text)) continue;
			records.push({
				kind: "databook",
				locator: { databookId: Number(row.id), page },
				document: `${row.title} — planche ${page}`,
				sourceUrl: `https://dragonballfr.com/wiki/databooks/${row.id}#planche-${page}`,
				text,
				verified: true,
			});
		}
		return records;
	} finally {
		await sql.end({ timeout: 5 });
	}
}

async function writeIdempotently(path: string, content: string): Promise<void> {
	if (existsSync(path) && (await Bun.file(path).text()) === content) return;
	const temp = `${path}.tmp-${process.pid}`;
	await Bun.write(temp, content);
	await rename(temp, path);
}

function option(name: string): string | undefined {
	const index = process.argv.indexOf(`--${name}`);
	return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
	if (process.argv.includes("--help")) {
		console.log("Usage: bun scripts/ops/wiki-corpus-enricher.ts --input candidates.json (--output bundles.json | --stdout) [--limit 12]");
		return;
	}
	const input = option("input");
	const output = option("output");
	const stdout = process.argv.includes("--stdout");
	const limit = Number(option("limit") ?? MAX_EVIDENCE_PER_CANDIDATE);
	if (!input || (stdout === Boolean(output))) throw new Error("provide --input and exactly one of --output or --stdout");
	const candidates = parseCandidates(await Bun.file(input).json());
	const document = buildSourceBundles(candidates, await loadCorpusRecords(), limit);
	const content = `${JSON.stringify(document, null, 2)}\n`;
	if (stdout) console.log(content);
	else await writeIdempotently(output!, content);
}

if (import.meta.main) {
	main().catch((error: unknown) => {
		console.error(`wiki-corpus-enricher: ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	});
}
