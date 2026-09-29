#!/usr/bin/env bun

/**
 * Builds review-only WikiPage drafts from imported crawl records.
 *
 * This tool never inserts, updates, or deletes database data.  It emits a
 * deterministic JSON document that an editorial workflow may review and apply
 * later, with the exact source evidence and a reversible create plan.
 *
 * Usage:
 *   DATABASE_URL=... bun scripts/ops/wiki-page-builder.ts --since 2026-09-16T00:00:00Z
 *   DATABASE_URL=... bun scripts/ops/wiki-page-builder.ts --since ... --limit 50 > candidates.json
 */
import { createHash } from "node:crypto";
import postgres from "postgres";

const SCHEMA = "shenron-wiki-page-candidates/v1";
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

export type CrawlSourceRecord = {
	url: string;
	kind: string;
	title: string;
	excerpt: string;
	httpStatus: number;
	contentHash: string;
	fetchedAt: string | Date;
	canonicalEligible: boolean;
	provenance: unknown;
};

export type WikiPageCategory = {
	slug: string;
	name: string;
};

export type WikiPageCandidate = {
	id: string;
	status: "draft";
	category: WikiPageCategory;
	slug: string;
	title: string;
	sections: Array<{ heading: string; markdown: string }>;
	provenance: {
		url: string;
		kind: string;
		fetchedAt: string;
		httpStatus: number;
		contentHash: string;
		canonicalEligible: boolean;
		metadata: Record<string, unknown>;
	};
	revisionPlan: {
		action: "create";
		tableName: "WikiPage";
		before: null;
		after: { categorySlug: string; title: string; slug: string; body: string };
		rollback: {
			action: "revert-create";
			guard: { sourceUrl: string; expectedSlug: string; expectedContentHash: string };
		};
	};
};

function stableHash(value: string, length = 12): string {
	return createHash("sha256").update(value).digest("hex").slice(0, length);
}

function cleanText(value: string): string {
	return value.replaceAll("\0", "").replace(/\s+/g, " ").trim();
}

function safeMetadata(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	return value as Record<string, unknown>;
}

/** A deterministic URL-safe wiki slug, without relying on a mutable database id. */
export function wikiSlug(value: string, fallbackUrl: string): string {
	const normalized = cleanText(value)
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLocaleLowerCase("en-US")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 72)
		.replace(/-+$/g, "");
	return normalized || `source-${stableHash(fallbackUrl, 10)}`;
}

/** Maps imported source kinds to the neutral, reviewable WikiCategory taxonomy. */
export function categoryForSource(kind: string): WikiPageCategory {
	switch (kind.toLowerCase()) {
		case "publisher":
			return { slug: "editeurs", name: "Éditeurs" };
		case "archive":
		case "wayback":
			return { slug: "archives", name: "Archives" };
		case "media":
			return { slug: "medias", name: "Médias" };
		case "statistics":
			return { slug: "statistiques", name: "Statistiques" };
		default:
			return { slug: "references", name: "Références" };
	}
}

function unoccupiedSlug(baseSlug: string, sourceUrl: string, occupied: ReadonlySet<string>): string {
	if (!occupied.has(baseSlug)) return baseSlug;
	const hashed = `${baseSlug}-source-${stableHash(sourceUrl, 10)}`;
	if (!occupied.has(hashed)) return hashed;
	let suffix = 2;
	while (occupied.has(`${hashed}-${suffix}`)) suffix++;
	return `${hashed}-${suffix}`;
}

function markdownLink(url: string): string {
	return `<${url.replaceAll(">", "%3E")}>`;
}

function candidateBody(sections: WikiPageCandidate["sections"]): string {
	return sections.map((section) => `## ${section.heading}\n\n${section.markdown}`).join("\n\n");
}

/**
 * Converts an already-read crawl row into a review candidate. It deliberately
 * preserves the crawl excerpt instead of inventing a summary or canon verdict.
 */
export function buildWikiPageCandidate(
	record: CrawlSourceRecord,
	options: { occupiedSlugs?: ReadonlySet<string> } = {},
): WikiPageCandidate {
	const sourceUrl = new URL(record.url).href;
	const title = cleanText(record.title) || sourceUrl;
	const category = categoryForSource(record.kind);
	const baseSlug = wikiSlug(title, sourceUrl);
	const occupied = options.occupiedSlugs ?? new Set<string>();
	const slug = unoccupiedSlug(baseSlug, sourceUrl, occupied);
	const excerpt = cleanText(record.excerpt);
	const sections = [
		{
			heading: "Extrait collecté",
			markdown: excerpt || "_Aucun extrait textuel n’a été collecté pour cette source._",
		},
		{
			heading: "Provenance",
			markdown: [
				`- Source : ${markdownLink(sourceUrl)}`,
				`- Type collecté : \`${cleanText(record.kind) || "reference"}\``,
				`- Collectée le : ${new Date(record.fetchedAt).toISOString()}`,
				`- Statut HTTP : ${record.httpStatus}`,
				"- Statut éditorial : brouillon à vérifier ; aucune décision canonique n’est inférée.",
			].join("\n"),
		},
	];
	const body = candidateBody(sections);
	return {
		id: `crawl-${stableHash(sourceUrl)}`,
		status: "draft",
		category,
		slug,
		title,
		sections,
		provenance: {
			url: sourceUrl,
			kind: cleanText(record.kind) || "reference",
			fetchedAt: new Date(record.fetchedAt).toISOString(),
			httpStatus: record.httpStatus,
			contentHash: record.contentHash,
			canonicalEligible: record.canonicalEligible,
			metadata: safeMetadata(record.provenance),
		},
		revisionPlan: {
			action: "create",
			tableName: "WikiPage",
			before: null,
			after: { categorySlug: category.slug, title, slug, body },
			rollback: {
				action: "revert-create",
				guard: { sourceUrl, expectedSlug: slug, expectedContentHash: record.contentHash },
			},
		},
	};
}

export function parseOptions(args: string[]): { since: Date; limit: number } {
	let since: string | undefined;
	let limit = DEFAULT_LIMIT;
	for (let index = 0; index < args.length; index++) {
		if (args[index] === "--since") since = args[++index];
		else if (args[index] === "--limit") limit = Number.parseInt(args[++index] ?? "", 10);
		else throw new Error(`Unknown option: ${args[index]}`);
	}
	const parsedSince = since ? new Date(since) : new Date(Number.NaN);
	if (Number.isNaN(parsedSince.getTime())) throw new Error("--since must be an ISO-8601 timestamp.");
	if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT)
		throw new Error(`--limit must be an integer from 1 to ${MAX_LIMIT}.`);
	return { since: parsedSince, limit };
}

async function main(): Promise<void> {
	const { since, limit } = parseOptions(process.argv.slice(2));
	const databaseUrl = process.env.DATABASE_URL;
	if (!databaseUrl) throw new Error("DATABASE_URL is required.");
	const sql = postgres(databaseUrl, { max: 1, prepare: false, onnotice: () => {} });
	try {
		const records = await sql<CrawlSourceRecord[]>`
			SELECT records.url, records.kind, records.title, records.excerpt,
				records.http_status AS "httpStatus", records.content_hash AS "contentHash",
				records.fetched_at AS "fetchedAt", records.canonical_eligible AS "canonicalEligible",
				coalesce(provenance.provenance, '{}'::jsonb) AS provenance
			FROM public.external_source_records AS records
			LEFT JOIN public.external_source_provenance AS provenance ON provenance.url = records.url
			WHERE records.fetched_at >= ${since.toISOString()}
				AND records.http_status BETWEEN 200 AND 299
			ORDER BY records.fetched_at ASC, records.url ASC
			LIMIT ${limit}
		`;
		const existing = await sql<{ slug: string }[]>`SELECT slug FROM public."WikiPage"`;
		const occupiedSlugs = new Set(existing.map(({ slug }) => slug));
		const candidates = records.map((record) => {
			const candidate = buildWikiPageCandidate(record, { occupiedSlugs });
			occupiedSlugs.add(candidate.slug);
			return candidate;
		});
		console.log(JSON.stringify({ schema: SCHEMA, mode: "read-only", since: since.toISOString(), candidates }, null, 2));
	} finally {
		await sql.end();
	}
}

if (import.meta.main) await main();
