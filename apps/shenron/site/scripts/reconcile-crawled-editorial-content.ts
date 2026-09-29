#!/usr/bin/env bun
/**
 * Reconcile BXC source fiches with the editorial wiki tree.
 *
 * Crawled material stays explicitly attributed and non-canonical.  This job
 * only changes provenance categories and adds reviewable source links to the
 * existing interview records; it never deletes rows or promotes a source.
 */
import postgres from "postgres";
import { CRAWLED_CATEGORIES, crawledCategoryId, crawledPageKey, hasEditorialLabel, withEditorialLabel } from "./_crawled-wiki-pages";

const applying = process.argv.includes("--appliquer");
const limitArg = process.argv.indexOf("--limit");
const requestedLimit = limitArg === -1 ? 50_000 : Number(process.argv[limitArg + 1]);
const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(50_000, Math.trunc(requestedLimit))) : 50_000;

async function databaseUrl(): Promise<string> {
	if (process.env.DATABASE_URL?.trim()) return process.env.DATABASE_URL.trim();
	for (const path of ["apps/shenron/site/.env", ".env"]) {
		const env = await Bun.file(path).text().catch(() => "");
		const line = env.split("\n").find((entry) => entry.startsWith("DATABASE_URL="));
		if (line) return line.slice("DATABASE_URL=".length).trim().replace(/^['"]|['"]$/g, "");
	}
	throw new Error("DATABASE_URL requis.");
}

type RecordRow = { url: string; kind: string; title: string; excerpt: string };
type PageRow = { id: string; title: string; body: string; categoryId: string };
type BookRow = { id: number; title: string; description: string | null; sourceUrl: string | null };

function revisionId(): string {
	return crypto.randomUUID().replaceAll("-", "").slice(0, 24);
}

const sql = postgres(await databaseUrl(), { prepare: false, max: 4 });
try {
	for (const { id, slug, name, order, parentId } of CRAWLED_CATEGORIES) {
		if (!applying) continue;
		await sql`
			INSERT INTO public."WikiCategory" (id, slug, name, "order", "parentId")
			VALUES (${id}, ${slug}, ${name}, ${order}, ${parentId})
			ON CONFLICT (id) DO UPDATE SET slug = EXCLUDED.slug, name = EXCLUDED.name, "order" = EXCLUDED."order", "parentId" = EXCLUDED."parentId"
		`;
	}
	const categoryNames = new Map<string, string>(CRAWLED_CATEGORIES.map(({ id, name }) => [id, name]));
	const records = await sql<RecordRow[]>`
		SELECT r.url, r.kind, r.title, r.excerpt
		FROM public.external_source_records r
		WHERE r.http_status BETWEEN 200 AND 299
		ORDER BY r.fetched_at DESC, r.url ASC LIMIT ${limit}
	`;
	const pages = await sql<PageRow[]>`SELECT id, title, body, "categoryId" AS "categoryId" FROM public."WikiPage" WHERE id LIKE 'source_%'`;
	const pagesById = new Map(pages.map((page) => [page.id, page]));
	let pagesChanged = 0;
	for (const record of records) {
		const { id } = crawledPageKey(record.url);
		const target = crawledCategoryId(record);
		const page = pagesById.get(id);
		if (!page || page.categoryId === target && hasEditorialLabel(page.body, categoryNames.get(target) ?? "")) continue;
		pagesChanged++;
		if (!applying) continue;
		const body = withEditorialLabel(page.body, categoryNames.get(target) ?? "Sources collectées");
		await sql.begin(async (tx) => {
			await tx`UPDATE public."WikiPage" SET "categoryId" = ${target}, body = ${body}, "updatedAt" = NOW() WHERE id = ${id}`;
			await tx`INSERT INTO public.wiki_revisions ${tx({ id: revisionId(), tableName: "WikiPage", rowId: id, action: "update", label: page.title, before: tx.json({ categoryId: page.categoryId }), after: tx.json({ categoryId: target, sourceUrl: record.url }), editorId: "agent", editorName: "Shenron BXC reconciliation" })}`;
		});
	}

	const books = await sql<BookRow[]>`SELECT id, title, description, source_url AS "sourceUrl" FROM bot.db_databooks WHERE kind = 'interview' OR category ILIKE '%Interview%' ORDER BY id`;
	let interviewsChanged = 0;
	for (const book of books) {
		const terms = book.title.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter((term) => term.length >= 4).slice(0, 6);
		const matches = await sql<RecordRow[]>`
			SELECT url, kind, title, excerpt FROM public.external_source_records
			WHERE kind <> 'media' AND (${book.sourceUrl ?? ""} <> '' AND url = ${book.sourceUrl ?? ""}
				OR lower(title || ' ' || excerpt || ' ' || url) LIKE ANY(${sql.array(terms.map((term) => `%${term}%`))}))
			ORDER BY fetched_at DESC, url ASC LIMIT 8
		`;
		if (!matches.length) continue;
		const marker = "## Sources BXC associées";
		const links = matches.map((match) => `- [${match.title.replace(/[\u005B\u005D]/g, "")}](${match.url}) — ${match.kind}`).join("\n");
		const section = `${marker}\n\n> Liens issus de la collecte BXC, conservés comme pistes documentaires et non comme validation canonique.\n\n${links}`;
		const current = book.description ?? "";
		// The first successful enrichment is deliberately sticky: source rows are
		// append-only snapshots, so a later crawl must not churn editorial text.
		if (current.includes(marker)) continue;
		const next = current.includes(marker) ? current.replace(/## Sources BXC associées[\s\S]*$/, section) : `${current.trim()}\n\n${section}\n`;
		if (next === current) continue;
		interviewsChanged++;
		if (!applying) continue;
		await sql.begin(async (tx) => {
			await tx`UPDATE bot.db_databooks SET description = ${next} WHERE id = ${book.id}`;
			await tx`INSERT INTO public.wiki_revisions ${tx({ id: revisionId(), tableName: "bot.db_databooks", rowId: String(book.id), action: "update", label: book.title, before: tx.json({ description: current }), after: tx.json({ description: next, relatedSources: matches.map((match) => match.url) }), editorId: "agent", editorName: "Shenron BXC reconciliation" })}`;
		});
	}
	console.log(JSON.stringify({ status: applying ? "APPLIED" : "SIMULATED", records: records.length, pagesChanged, interviewsChanged, categories: CRAWLED_CATEGORIES.length }));
} finally {
	await sql.end();
}
