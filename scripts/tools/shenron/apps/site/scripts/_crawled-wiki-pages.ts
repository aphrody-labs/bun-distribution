/**
 * Shared, pure rendering of crawled BXC sources into typed wiki pages.
 *
 * Both the materializer (creation) and the reconciler (re-classification)
 * derive identity, category and body from here, so a re-run of either job is
 * idempotent and never undoes the other's work.
 */
import { createHash } from "node:crypto";
import { decodeHtmlEntities, decodeHtmlEntitiesInMarkdown } from "../src/lib/text/html-entities";

export type CrawledSourceRecord = {
	url: string;
	kind: string;
	title: string;
	excerpt: string;
	httpStatus: number;
	fetchedAt: string | Date;
};

export type CrawledCategory = {
	id: string;
	slug: string;
	name: string;
	order: number;
	parentId: string | null;
};

export const ROOT_CATEGORY_ID = "cat_crawled_sources";

export const CRAWLED_CATEGORIES: readonly CrawledCategory[] = [
	{ id: ROOT_CATEGORY_ID, slug: "sources-collectees", name: "Sources collectées", order: 999, parentId: null },
	{ id: "cat_crawled_interviews", slug: "sources-collectees/interviews", name: "Sources collectées — Interviews", order: 1000, parentId: ROOT_CATEGORY_ID },
	{ id: "cat_crawled_guides", slug: "sources-collectees/guides", name: "Sources collectées — Guides et articles", order: 1001, parentId: ROOT_CATEGORY_ID },
	{ id: "cat_crawled_archives", slug: "sources-collectees/archives", name: "Sources collectées — Archives", order: 1002, parentId: ROOT_CATEGORY_ID },
	{ id: "cat_crawled_stats", slug: "sources-collectees/statistiques", name: "Sources collectées — Statistiques", order: 1003, parentId: ROOT_CATEGORY_ID },
	{ id: "cat_crawled_media", slug: "sources-collectees/medias", name: "Sources collectées — Médias", order: 1004, parentId: ROOT_CATEGORY_ID },
	{ id: "cat_crawled_references", slug: "sources-collectees/references", name: "Sources collectées — Références", order: 1005, parentId: ROOT_CATEGORY_ID },
];

const CATEGORY_BY_ID = new Map(CRAWLED_CATEGORIES.map((category) => [category.id, category]));

export function crawledCategory(id: string): CrawledCategory {
	const category = CATEGORY_BY_ID.get(id);
	if (!category) throw new Error(`Unknown crawled category: ${id}`);
	return category;
}

/** Stable page identity derived from the source URL, never from a mutable row id. */
export function crawledPageKey(url: string): { id: string; slug: string } {
	const key = createHash("sha256").update(url).digest("hex").slice(0, 20);
	return { id: `source_${key}`, slug: `source-${key}` };
}

export function crawledCategoryId(record: Pick<CrawledSourceRecord, "url" | "kind" | "title" | "excerpt">): string {
	const haystack = `${record.url} ${record.title} ${record.excerpt}`.toLocaleLowerCase();
	if (record.kind === "media") return "cat_crawled_media";
	if (record.kind === "statistics") return "cat_crawled_stats";
	if (record.kind === "archive") return "cat_crawled_archives";
	if (/interview|entretien|toriyama|鳥山明|対談|commentaire|comment/.test(haystack)) return "cat_crawled_interviews";
	if (/databook|daizenshuu|guide|translation|manga|episode|movie|film|encyclop|公式/.test(haystack)) return "cat_crawled_guides";
	return "cat_crawled_references";
}

/** Characters a crawled text may never contribute to a page: markdown and HTML syntax. */
const MARKDOWN_SYNTAX = /[\\`*_{}[\]<>]/g;
const UNTITLED = "Document collecté";

/**
 * Crawled text → one inert markdown line. Entities are decoded first (URLs kept
 * byte for byte), so a decoded `&lt;` is stripped like a raw `<` would be.
 */
export function markdownText(value: string): string {
	return decodeHtmlEntities(value, { preserveUrls: true })
		.replace(/[\r\n]+/g, " ")
		.replace(MARKDOWN_SYNTAX, "")
		.replace(/\s+/g, " ")
		.trim();
}

export function crawledPageTitle(record: Pick<CrawledSourceRecord, "title">): string {
	return markdownText(record.title) || UNTITLED;
}

/** Decoded entity text obeys the same inert contract as `markdownText`. */
function inertCrawledText(decoded: string): string {
	return decoded.replace(/[\r\n]+/g, " ").replace(MARKDOWN_SYNTAX, "");
}

/**
 * Repairs the title of a page materialized before entities were decoded: one
 * level, URLs untouched, same result as re-rendering its source record.
 */
export function decodeCrawledPageTitle(title: string): string {
	const decoded = decodeHtmlEntities(title, { preserveUrls: true, transform: inertCrawledText });
	if (decoded === title) return title;
	return decoded.replace(/\s+/g, " ").trim() || UNTITLED;
}

/**
 * Repairs the body of a page materialized before entities were decoded: one
 * level, outside code and URLs (the origin URL line is an identifier).
 */
export function decodeCrawledPageBody(body: string): string {
	return decodeHtmlEntitiesInMarkdown(body, { preserveUrls: true, transform: inertCrawledText });
}

const EDITORIAL_MARKER = "## Classement éditorial";

/** Replaces (or appends) the editorial classification section at the end of a body. */
export function withEditorialLabel(body: string, categoryName: string): string {
	const section = `${EDITORIAL_MARKER}\n\n- **Rubrique :** ${categoryName}\n- **Statut :** source collectée, à vérifier avant toute utilisation canonique.`;
	if (body.includes(EDITORIAL_MARKER)) return body.replace(/## Classement éditorial[\s\S]*$/, `${section}\n`);
	return `${body.trim()}\n\n${section}\n`;
}

export function hasEditorialLabel(body: string, categoryName: string): boolean {
	return body.includes(`- **Rubrique :** ${categoryName}`);
}

/** Provenance-only body: metadata, origin URL and an attributed excerpt; no canonical claim. */
export function crawledPageBody(record: CrawledSourceRecord, categoryName: string): string {
	const excerpt = markdownText(record.excerpt).slice(0, 2_400);
	const collectedAt = new Date(record.fetchedAt).toLocaleString("fr-FR", { timeZone: "UTC" });
	const base = [
		`# ${crawledPageTitle(record)}`,
		"",
		"> Cette fiche décrit un document collecté. Elle ne constitue pas une assertion canonique.",
		"",
		"## Provenance",
		"",
		`- **Type :** ${markdownText(record.kind) || "source"}`,
		`- **Collecté le :** ${collectedAt} UTC`,
		`- **Statut HTTP observé :** ${record.httpStatus}`,
		`- **Document d'origine :** ${record.url}`,
		"",
		"## Extrait collecté",
		"",
		excerpt || "Aucun extrait textuel n'a été conservé lors de la collecte.",
	].join("\n");
	return withEditorialLabel(base, categoryName);
}

/** Full typed page for a crawled record. */
export function renderCrawledPage(record: CrawledSourceRecord) {
	const { id, slug } = crawledPageKey(record.url);
	const category = crawledCategory(crawledCategoryId(record));
	return { id, slug, title: crawledPageTitle(record), category, body: crawledPageBody(record, category.name) };
}
