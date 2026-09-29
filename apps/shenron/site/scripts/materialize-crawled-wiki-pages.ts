#!/usr/bin/env bun
/**
 * Matérialise les documents collectés dans des pages wiki structurées.
 *
 * Les collectes BXC restent des sources, jamais des assertions canoniques :
 * chaque page ne publie que ses métadonnées, son URL et un extrait attribué.
 * La route `/wiki/[...slug]` rend ces fiches sans nouvelle route ad hoc.
 *
 * Chaque fiche est créée directement dans sa rubrique typée
 * (`_crawled-wiki-pages.ts`), avec le même rendu que la réconciliation :
 * relancer l'un ou l'autre script est idempotent.
 *
 * Par défaut, le script simule. `--appliquer` écrit par transaction et crée
 * une révision pour chaque fiche effectivement créée ou mise à jour.
 *
 * Usage : bun apps/shenron/site/scripts/materialize-crawled-wiki-pages.ts [--limit 50] [--offset 0] [--manquantes] [--appliquer]
 */
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { CRAWLED_CATEGORIES, type CrawledSourceRecord, renderCrawledPage } from "./_crawled-wiki-pages";

const applying = process.argv.includes("--appliquer");
const missingOnly = process.argv.includes("--manquantes");
const limitArg = process.argv.indexOf("--limit");
const requestedLimit = limitArg === -1 ? 50 : Number(process.argv[limitArg + 1]);
const limit = Number.isInteger(requestedLimit) ? Math.max(1, Math.min(requestedLimit, 10_000)) : 50;
const offsetArg = process.argv.indexOf("--offset");
const requestedOffset = offsetArg === -1 ? 0 : Number(process.argv[offsetArg + 1]);
const offset = Number.isInteger(requestedOffset) ? Math.max(0, requestedOffset) : 0;

type ExistingPage = {
	id: string;
	slug: string;
	title: string;
	body: string;
	categoryId: string;
};

function revisionId(): string {
	return randomUUID().replaceAll("-", "").slice(0, 24);
}

async function resolveDatabaseUrl(): Promise<string> {
	const direct = process.env.DATABASE_URL?.trim();
	if (direct) return direct;
	for (const url of [new URL("../.env", import.meta.url), new URL("../../../.env", import.meta.url)]) {
		const env = await Bun.file(url).text().catch(() => "");
		const value = env
			.split("\n")
			.find((line) => line.startsWith("DATABASE_URL="))
			?.slice("DATABASE_URL=".length)
			.trim()
			.replace(/^['"]|['"]$/g, "");
		if (value) return value;
	}
	throw new Error("DATABASE_URL requis.");
}

const databaseUrl = await resolveDatabaseUrl();
const sql = postgres(databaseUrl, { max: 2, prepare: false, onnotice: () => {} });

try {
	// `--manquantes` restreint aux URL sans fiche : le rattrapage ne relit pas
	// les dizaines de milliers de fiches déjà matérialisées.
	const records = (await sql`
		SELECT r.url, r.kind, r.title, r.excerpt, r.http_status AS "httpStatus", r.fetched_at AS "fetchedAt"
		FROM public.external_source_records r
		WHERE r.http_status BETWEEN 200 AND 299
			AND (${!missingOnly} OR NOT EXISTS (
				SELECT 1 FROM public."WikiPage" w
				WHERE w.id = 'source_' || left(encode(sha256(convert_to(r.url, 'UTF8')), 'hex'), 20)
			))
		ORDER BY r.fetched_at DESC, r.url ASC
		LIMIT ${limit} OFFSET ${offset}
	`) as CrawledSourceRecord[];

	if (records.length === 0) {
		console.log(JSON.stringify({ status: "NO_ELIGIBLE_SOURCE", applying, limit, missingOnly }));
		process.exit(0);
	}

	if (applying) {
		for (const category of CRAWLED_CATEGORIES) {
			await sql`
				INSERT INTO public."WikiCategory" (id, slug, name, "order", "parentId")
				VALUES (${category.id}, ${category.slug}, ${category.name}, ${category.order}, ${category.parentId})
				ON CONFLICT (id) DO UPDATE SET slug = EXCLUDED.slug, name = EXCLUDED.name, "order" = EXCLUDED."order", "parentId" = EXCLUDED."parentId"
			`;
		}
	}

	let created = 0;
	let updated = 0;
	let unchanged = 0;
	const byCategory: Record<string, number> = {};
	for (const record of records) {
		const page = renderCrawledPage(record);
		const [existing] = (await sql<ExistingPage[]>`
			SELECT id, slug, title, body, "categoryId" AS "categoryId"
			FROM public."WikiPage" WHERE id = ${page.id} OR slug = ${page.slug} LIMIT 1
		`) as ExistingPage[];
		if (existing?.title === page.title && existing.body === page.body && existing.categoryId === page.category.id) {
			unchanged++;
			continue;
		}
		if (!existing) created++;
		else updated++;
		byCategory[page.category.id] = (byCategory[page.category.id] ?? 0) + 1;
		if (!applying) continue;

		await sql.begin(async (tx) => {
			let persisted = existing;
			if (!persisted) {
				const inserted = await tx<{ id: string }[]>`
					INSERT INTO public."WikiPage" (id, "categoryId", title, slug, body, "order", "updatedAt")
					VALUES (${page.id}, ${page.category.id}, ${page.title}, ${page.slug}, ${page.body}, 0, NOW())
					ON CONFLICT (id) DO NOTHING
					RETURNING id
				`;
				if (inserted.length === 0) {
					const [raced] = await tx<ExistingPage[]>`
						SELECT id, slug, title, body, "categoryId" AS "categoryId"
						FROM public."WikiPage" WHERE id = ${page.id} FOR UPDATE
					`;
					if (!raced) throw new Error(`Fiche source concurrente introuvable : ${page.id}`);
					persisted = raced;
				}
			}
			if (persisted) {
				await tx`
					UPDATE public."WikiPage"
					SET "categoryId" = ${page.category.id}, title = ${page.title}, body = ${page.body}, "updatedAt" = NOW()
					WHERE id = ${persisted.id}
				`;
			}
			await tx`INSERT INTO public.wiki_revisions ${tx({
				id: revisionId(),
				tableName: "WikiPage",
				rowId: persisted?.id ?? page.id,
				action: persisted ? "update" : "create",
				label: page.title,
				before: persisted ? tx.json({ title: persisted.title, body: persisted.body, categoryId: persisted.categoryId }) : null,
				after: tx.json({ title: page.title, slug: persisted?.slug ?? page.slug, body: page.body, categoryId: page.category.id, sourceUrl: record.url }),
				editorId: "agent",
				editorName: "Shenron wiki-page-builder",
			})}`;
		});
	}

	console.log(
		JSON.stringify({ status: applying ? "APPLIED" : "SIMULATED", eligible: records.length, offset, missingOnly, created, updated, unchanged, byCategory }),
	);
} finally {
	await sql.end();
}
