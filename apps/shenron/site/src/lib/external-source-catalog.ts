import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { decodeHtmlEntitiesPlain, markdownToPlainText } from "@/lib/markdown-plain";

export const EXTERNAL_SOURCE_KINDS = [
	"publisher",
	"reference",
	"archive",
	"wayback",
	"encyclopedia",
	"statistics",
	"media",
] as const;

type ExternalSourceKind = (typeof EXTERNAL_SOURCE_KINDS)[number];

export type ExternalSourceRecord = {
	url: string;
	kind: string;
	title: string;
	excerpt: string;
	httpStatus: number;
	fetchedAt: Date;
	score: number;
	provenance: Record<string, unknown>;
};

export type ExternalSourceCatalog = {
	total: number;
	records: ExternalSourceRecord[];
};

export type ExternalSourceSitemapRecord = {
	url: string;
	fetchedAt: Date;
};

export type ExternalSourceSearch = {
	q?: string;
	kind?: string;
	limit?: number;
	offset?: number;
};

const MAX_LIMIT = 48;

/**
 * Stable, URL-safe identifier for a crawled source. The source URL stays the
 * database primary key; this only lets the public UI address its detail page
 * without introducing another mutable identifier.
 */
export function externalSourceId(url: string): string {
	return Buffer.from(url, "utf8").toString("base64url");
}

/** Returns the original HTTP(S) URL only for a canonical source identifier. */
export function externalSourceUrlFromId(id: string): string | null {
	if (!/^[A-Za-z0-9_-]+$/.test(id)) return null;
	try {
		const url = Buffer.from(id, "base64url").toString("utf8");
		const parsed = new URL(url);
		if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
		return externalSourceId(parsed.href) === id ? parsed.href : null;
	} catch {
		return null;
	}
}

export function externalSourceHref(url: string): string {
	return `/sources/dragon-ball/${externalSourceId(url)}`;
}

function normalizeProvenance(value: unknown): Record<string, unknown> {
	if (value && typeof value === "object" && !Array.isArray(value))
		return value as Record<string, unknown>;
	if (typeof value === "string") {
		try {
			const parsed: unknown = JSON.parse(value);
			return parsed && typeof parsed === "object" && !Array.isArray(parsed)
				? (parsed as Record<string, unknown>)
				: {};
		} catch {
			return {};
		}
	}
	return {};
}

/**
 * Texte affichable d'une collecte.
 *
 * Les collectes BXC stockent la page convertie en markdown (`[Login](/login)`,
 * `[![logo](…)](/)`, soulignés `=====`) et le `<title>` HTML tel quel
 * (`Pok&eacute;mon Scarlet &amp; Violet`). Rendus en nœuds texte sur
 * /sources/dragon-ball, cette syntaxe s'affichait au lecteur et remplissait la
 * méta-description. On garde la donnée brute (elle sert la recherche plein
 * texte) et on n'aplatit qu'à la lecture.
 */
function displayable<T extends { title: string; excerpt: string }>(record: T): T {
	return {
		...record,
		title: decodeHtmlEntitiesPlain(record.title ?? "").replace(/\s+/g, " ").trim(),
		excerpt: markdownToPlainText(record.excerpt, { lineBreaks: true }),
	};
}

/**
 * Index de recherche transversal des collectes BXC.
 *
 * Toutes les classifications sont interrogables, y compris archives, données
 * statistiques et médias. `kind` renseigne la provenance ; il ne décide jamais
 * si un document est trouvable. Le canon reste un jugement éditorial séparé.
 */
export async function searchExternalSources({
	q = "",
	kind = "",
	limit = 18,
	offset = 0,
}: ExternalSourceSearch = {}): Promise<ExternalSourceCatalog> {
	const query = q.trim().slice(0, 120);
	const selectedKind = EXTERNAL_SOURCE_KINDS.includes(kind as ExternalSourceKind) ? kind : "";
	const take = Math.max(1, Math.min(Math.trunc(limit), MAX_LIMIT));
	const skip = Math.max(0, Math.min(Math.trunc(offset), 10_000));

	try {
		const result = await db.execute(sql`
			SELECT
				records.url,
				CASE WHEN records.kind = 'official' THEN 'reference' ELSE records.kind END AS kind,
				records.title,
				records.excerpt,
				records.http_status AS "httpStatus",
				records.fetched_at AS "fetchedAt",
				coalesce(provenance.provenance, '{}'::jsonb) AS provenance,
				CASE WHEN ${query} = '' THEN 0 ELSE ts_rank_cd(records.search_vector, websearch_to_tsquery('simple', ${query})) END AS score,
				count(*) OVER ()::int AS total
			FROM public.external_source_records AS records
			LEFT JOIN public.external_source_provenance AS provenance ON provenance.url = records.url
			WHERE (${selectedKind} = '' OR CASE WHEN records.kind = 'official' THEN 'reference' ELSE records.kind END = ${selectedKind})
				AND (
					${query} = ''
					OR records.search_vector @@ websearch_to_tsquery('simple', ${query})
					OR title ILIKE '%' || ${query} || '%'
					OR excerpt ILIKE '%' || ${query} || '%'
				)
			ORDER BY score DESC, "fetchedAt" DESC, records.url ASC
			LIMIT ${take} OFFSET ${skip}
		`);
		const rows = result as unknown as (ExternalSourceRecord & {
			total: number;
			fetchedAt: string | Date;
			provenance?: unknown;
		})[];
		return {
			total: rows[0]?.total ?? 0,
			records: rows.map(({ total: _total, fetchedAt, score, ...record }) =>
				displayable({
					...record,
					fetchedAt: new Date(fetchedAt),
					score: Number(score),
					provenance: normalizeProvenance(record.provenance),
				})
			),
		};
	} catch {
		return { total: 0, records: [] };
	}
}

/** Fetches one public, attributed source document for its dedicated UI page. */
export async function readExternalSource(url: string): Promise<ExternalSourceRecord | null> {
	try {
		const result = await db.execute(sql`
			SELECT
				records.url,
				CASE WHEN records.kind = 'official' THEN 'reference' ELSE records.kind END AS kind,
				records.title,
				records.excerpt,
				records.http_status AS "httpStatus",
				records.fetched_at AS "fetchedAt",
				coalesce(provenance.provenance, '{}'::jsonb) AS provenance,
				0::real AS score
			FROM public.external_source_records AS records
			LEFT JOIN public.external_source_provenance AS provenance ON provenance.url = records.url
			WHERE records.url = ${url}
			LIMIT 1
		`);
		const row = (
			result as unknown as (ExternalSourceRecord & {
				fetchedAt: string | Date;
				provenance?: unknown;
			})[]
		)[0];
		if (!row) return null;
		return displayable({
			...row,
			fetchedAt: new Date(row.fetchedAt),
			score: Number(row.score),
			provenance: normalizeProvenance(row.provenance),
		});
	} catch {
		return null;
	}
}

/** All public source records for discovery of their corresponding detail pages. */
export async function listExternalSourceSitemapRecords(): Promise<ExternalSourceSitemapRecord[]> {
	try {
		const result = await db.execute(sql`
			SELECT url, fetched_at AS "fetchedAt"
			FROM public.external_source_records
			WHERE http_status BETWEEN 200 AND 299
			ORDER BY fetched_at DESC, url ASC
		`);
		return (result as unknown as Array<{ url: string; fetchedAt: string | Date }>).map(
			(record) => ({
				url: record.url,
				fetchedAt: new Date(record.fetchedAt),
			})
		);
	} catch {
		return [];
	}
}

/** Compatibilité : alimentation du rail de provenance sans filtre. */
function readExternalSourceCatalog(limit = 18): Promise<ExternalSourceCatalog> {
	return searchExternalSources({ limit });
}
