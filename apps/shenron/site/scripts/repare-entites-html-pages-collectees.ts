#!/usr/bin/env bun
/**
 * Répare les entités HTML restées brutes dans les fiches `sources-collectees/*`.
 *
 * Avant le décodage ajouté à `_crawled-wiki-pages.ts` et aux importeurs, titres
 * et extraits collectés étaient recopiés tels quels : `&amp;`, `&quot;`,
 * `&#x27;`… s'affichaient en clair. Ce script décode UN niveau d'entités — le
 * même rendu qu'une re-matérialisation — hors blocs de code et hors URL (l'URL
 * d'origine est un identifiant). Le slug `source-<sha256(url)>` ne dépend pas
 * du titre : il n'est jamais modifié.
 *
 * Simulation par défaut : comptes par rubrique et échantillons avant/après.
 * `--repetition` joue l'écriture du premier lot dans une transaction puis
 * l'annule (preuve du SQL sur la vraie base, sans effet).
 * `--appliquer --instantane <fichier.jsonl.gz>` écrit d'abord un instantané
 * gzip des lignes visées (hors dépôt), puis réécrit par lots transactionnels :
 * une révision `public.wiki_revisions` par fiche modifiée, `updatedAt` mis à
 * jour. Une ligne n'est réécrite que si elle est encore exactement dans l'état
 * planifié (et donc sauvegardé).
 *
 * Idempotent : une fiche décodée est un point fixe, et une fiche dont l'état
 * courant est celui qu'a écrit ce script (révision `after`) est écartée — un
 * second passage n'a rien à écrire, même sur une source doublement échappée.
 *
 * `--sources-externes` étend la réparation à `public.external_source_records`
 * (titre + extrait, lus par la matérialisation et par /sources) ; cette table
 * n'a pas de révisions wiki, l'instantané est son chemin de retour.
 *
 * Usage (depuis la racine du dépôt) :
 *   bun --env-file=.env apps/shenron/site/scripts/repare-entites-html-pages-collectees.ts [--sources-externes] [--echantillons 10]
 *   bun --env-file=.env apps/shenron/site/scripts/repare-entites-html-pages-collectees.ts --repetition [--sources-externes]
 *   bun --env-file=.env apps/shenron/site/scripts/repare-entites-html-pages-collectees.ts --appliquer --instantane <hors-dépôt.jsonl.gz> [--lot 100] [--sources-externes]
 */
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { HTML_ENTITY_SQL_PATTERN, decodeHtmlEntities, decodeHtmlEntitiesInMarkdown } from "../src/lib/text/html-entities";
import { decodeCrawledPageBody, decodeCrawledPageTitle } from "./_crawled-wiki-pages";

const EDITOR_ID = "shenron-html-entities";
const EDITOR_NAME = "Shenron — décodage des entités HTML";
const ROOT_CATEGORY_SLUG = "sources-collectees";

const argv = process.argv.slice(2);
const applying = argv.includes("--appliquer");
const rehearsing = argv.includes("--repetition");
const withExternalSources = argv.includes("--sources-externes");
const snapshotArg = optionValue("--instantane");
const batchSize = integerOption("--lot", 100, 1, 1_000);
const sampleCount = integerOption("--echantillons", 10, 0, 200);

function optionValue(name: string): string | undefined {
	const index = argv.indexOf(name);
	return index === -1 ? undefined : argv[index + 1];
}

function integerOption(name: string, fallback: number, min: number, max: number): number {
	const raw = optionValue(name);
	if (raw === undefined) return fallback;
	const value = Number(raw);
	if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} attend un entier de ${min} à ${max}.`);
	return value;
}

if (applying && rehearsing) throw new Error("--appliquer et --repetition sont exclusifs.");
if (applying && !snapshotArg) throw new Error("--appliquer exige --instantane <fichier.jsonl.gz> hors du dépôt.");

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const snapshotPath = snapshotArg ? resolve(snapshotArg) : undefined;
if (snapshotPath) {
	if (snapshotPath.toLowerCase().startsWith(repositoryRoot.toLowerCase())) throw new Error("L'instantané doit être écrit hors du dépôt.");
	if (existsSync(snapshotPath)) throw new Error(`Instantané déjà présent, jamais écrasé : ${snapshotPath}`);
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

// ── Connexion tolérante : un tunnel instable refuse une partie des connexions ──

const TRANSIENT_CODES = new Set([
	"ECONNREFUSED",
	"ECONNRESET",
	"ETIMEDOUT",
	"EPIPE",
	"EHOSTUNREACH",
	"ENETUNREACH",
	"CONNECTION_CLOSED",
	"CONNECTION_ENDED",
	"CONNECTION_DESTROYED",
	"CONNECT_TIMEOUT",
	"57P01",
	"57P02",
	"57P03",
	"08000",
	"08001",
	"08003",
	"08004",
	"08006",
]);

function errorCode(error: unknown): string {
	const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
	return typeof code === "string" ? code : "";
}

/** Retries connection-level failures only; SQL errors surface immediately. */
async function withRetry<T>(label: string, run: () => Promise<T>, attempts = 80): Promise<T> {
	for (let attempt = 1; ; attempt++) {
		try {
			return await run();
		} catch (error) {
			const code = errorCode(error);
			if (!TRANSIENT_CODES.has(code) || attempt >= attempts) throw error;
			if (attempt === 1 || attempt % 10 === 0) console.error(`[reprise] ${label} : ${code}, tentative ${attempt + 1}/${attempts}`);
			await Bun.sleep(Math.min(200 * attempt, 3_000));
		}
	}
}

function revisionId(): string {
	return randomUUID().replaceAll("-", "").slice(0, 24);
}

/** Before/after windows around the first differing character, for review. */
function diffWindow(before: string, after: string): { before: string; after: string } | null {
	if (before === after) return null;
	let index = 0;
	while (index < before.length && before[index] === after[index]) index++;
	const start = Math.max(0, index - 60);
	return { before: before.slice(start, index + 120), after: after.slice(start, index + 120) };
}

const REMAINING_REFERENCE = new RegExp(HTML_ENTITY_SQL_PATTERN, "g");

function countRemaining(into: Map<string, number>, text: string): void {
	for (const [reference] of text.matchAll(REMAINING_REFERENCE)) into.set(reference, (into.get(reference) ?? 0) + 1);
}

function topEntries(map: Map<string, number>, limit = 20): Record<string, number> {
	return Object.fromEntries([...map].toSorted((a, b) => b[1] - a[1]).slice(0, limit));
}

/** Interleaves plans across groups so samples cover every category. */
function spreadSamples<T extends { group: string }>(plans: T[], count: number): T[] {
	const groups = new Map<string, T[]>();
	for (const plan of plans) groups.set(plan.group, [...(groups.get(plan.group) ?? []), plan]);
	const queues = [...groups.values()];
	const out: T[] = [];
	while (out.length < count && queues.some((queue) => queue.length > 0)) {
		for (const queue of queues) {
			const next = queue.shift();
			if (next && out.length < count) out.push(next);
		}
	}
	return out;
}

class RehearsalRollback extends Error {}

type PageRow = { id: string; slug: string; title: string; body: string; categoryId: string; updatedAt: string };
type PagePlan = { group: string; row: PageRow; title: string; body: string };
type PageStats = { matched: number; toUpdate: number; titles: number; bodies: number; alreadyRepaired: number; unchanged: number };
type SourceRow = { url: string; kind: string; title: string; excerpt: string };
type SourcePlan = { group: string; row: SourceRow; title: string; excerpt: string };
type SourceStats = { matched: number; toUpdate: number; titles: number; excerpts: number; unchanged: number };
type RevisionRow = {
	id: string;
	tableName: string;
	rowId: string;
	action: string;
	label: string;
	before: postgres.Parameter;
	after: postgres.Parameter;
	editorId: string;
	editorName: string;
};

const databaseUrl = await resolveDatabaseUrl();
const sql = postgres(databaseUrl, { max: 1, prepare: false, connect_timeout: 15, idle_timeout: 0, onnotice: () => {} });

try {
	await withRetry("connexion", () => sql`SELECT 1`);

	// ── Phase 1 : fiches wiki `sources-collectees/*` ────────────────────────────
	const categories = await withRetry(
		"rubriques",
		() => sql<{ id: string; slug: string }[]>`
			SELECT id, slug FROM public."WikiCategory"
			WHERE slug = ${ROOT_CATEGORY_SLUG} OR slug LIKE ${`${ROOT_CATEGORY_SLUG}/%`}
			ORDER BY slug
		`,
	);
	const categorySlugById = new Map(categories.map((category) => [category.id, category.slug]));
	const categoryIds = categories.map((category) => category.id);
	const pages =
		categoryIds.length === 0
			? []
			: await withRetry(
					"fiches candidates",
					() => sql<PageRow[]>`
						SELECT id, slug, title, body, "categoryId" AS "categoryId", "updatedAt"::text AS "updatedAt"
						FROM public."WikiPage"
						WHERE "categoryId" IN ${sql(categoryIds)}
							AND (title ~ ${HTML_ENTITY_SQL_PATTERN} OR body ~ ${HTML_ENTITY_SQL_PATTERN})
						ORDER BY id
					`,
				);
	const [outside] = await withRetry(
		"hors rubrique",
		() => sql<{ n: number }[]>`
			SELECT count(*)::int AS n FROM public."WikiPage" w
			LEFT JOIN public."WikiCategory" c ON c.id = w."categoryId"
			WHERE coalesce(c.slug, '') <> ${ROOT_CATEGORY_SLUG} AND coalesce(c.slug, '') NOT LIKE ${`${ROOT_CATEGORY_SLUG}/%`}
				AND (w.title ~ ${HTML_ENTITY_SQL_PATTERN} OR w.body ~ ${HTML_ENTITY_SQL_PATTERN})
		`,
	);
	const markers = new Map(
		(
			await withRetry(
				"révisions antérieures",
				() => sql<{ rowId: string; title: string | null; body: string | null }[]>`
					SELECT DISTINCT ON ("rowId") "rowId" AS "rowId", after->>'title' AS title, after->>'body' AS body
					FROM public.wiki_revisions
					WHERE "tableName" = 'WikiPage' AND "editorId" = ${EDITOR_ID}
					ORDER BY "rowId", "createdAt" DESC
				`,
			)
		).map((marker) => [marker.rowId, marker]),
	);

	const pageStats: Record<string, PageStats> = {};
	const pagePlans: PagePlan[] = [];
	const pageRemaining = new Map<string, number>();
	for (const row of pages) {
		const group = categorySlugById.get(row.categoryId) ?? row.categoryId;
		const stats = (pageStats[group] ??= { matched: 0, toUpdate: 0, titles: 0, bodies: 0, alreadyRepaired: 0, unchanged: 0 });
		stats.matched++;
		const marker = markers.get(row.id);
		if (marker && marker.title === row.title && marker.body === row.body) {
			stats.alreadyRepaired++;
			countRemaining(pageRemaining, `${row.title}\n${row.body}`);
			continue;
		}
		const title = decodeCrawledPageTitle(row.title);
		const body = decodeCrawledPageBody(row.body);
		countRemaining(pageRemaining, `${title}\n${body}`);
		if (title === row.title && body === row.body) {
			stats.unchanged++;
			continue;
		}
		stats.toUpdate++;
		if (title !== row.title) stats.titles++;
		if (body !== row.body) stats.bodies++;
		pagePlans.push({ group, row, title, body });
	}

	// ── Phase 2 (option) : enregistrements sources externes ─────────────────────
	const sourceStats: Record<string, SourceStats> = {};
	const sourcePlans: SourcePlan[] = [];
	const sourceRemaining = new Map<string, number>();
	let sourcesMatched = 0;
	if (withExternalSources) {
		const sources = await withRetry(
			"sources externes candidates",
			() => sql<SourceRow[]>`
				SELECT url, kind, title, excerpt FROM public.external_source_records
				WHERE title ~ ${HTML_ENTITY_SQL_PATTERN} OR excerpt ~ ${HTML_ENTITY_SQL_PATTERN}
				ORDER BY url
			`,
		);
		sourcesMatched = sources.length;
		for (const row of sources) {
			const stats = (sourceStats[row.kind] ??= { matched: 0, toUpdate: 0, titles: 0, excerpts: 0, unchanged: 0 });
			stats.matched++;
			// A title equal to its URL is the importer's fallback: an identifier, never decoded.
			const decodedTitle = row.title === row.url ? row.title : decodeHtmlEntities(row.title, { preserveUrls: true });
			const title = decodedTitle === row.title ? row.title : decodedTitle.trim() || row.url;
			const decodedExcerpt = decodeHtmlEntitiesInMarkdown(row.excerpt, { preserveUrls: true });
			const excerpt = decodedExcerpt === row.excerpt ? row.excerpt : decodedExcerpt.replace(/\s+/g, " ").trim();
			countRemaining(sourceRemaining, `${title}\n${excerpt}`);
			if (title === row.title && excerpt === row.excerpt) {
				stats.unchanged++;
				continue;
			}
			stats.toUpdate++;
			if (title !== row.title) stats.titles++;
			if (excerpt !== row.excerpt) stats.excerpts++;
			sourcePlans.push({ group: row.kind, row, title, excerpt });
		}
	}

	const report = {
		pattern: HTML_ENTITY_SQL_PATTERN,
		wikiPages: {
			matched: pages.length,
			toUpdate: pagePlans.length,
			matchedOutsideCrawledCategories: outside?.n ?? 0,
			byCategory: pageStats,
			remainingReferencesAfterDecode: topEntries(pageRemaining),
		},
		externalSources: withExternalSources
			? {
					matched: sourcesMatched,
					toUpdate: sourcePlans.length,
					byKind: sourceStats,
					remainingReferencesAfterDecode: topEntries(sourceRemaining),
				}
			: "non demandé (--sources-externes)",
	};
	console.log(JSON.stringify(report, null, 2));

	for (const plan of spreadSamples(pagePlans, sampleCount)) {
		console.log(
			JSON.stringify({
				sample: "WikiPage",
				id: plan.row.id,
				category: plan.group,
				title: plan.title === plan.row.title ? { unchanged: plan.title } : { before: plan.row.title, after: plan.title },
				body: diffWindow(plan.row.body, plan.body) ?? "unchanged",
			}),
		);
	}
	for (const plan of spreadSamples(sourcePlans, withExternalSources ? sampleCount : 0)) {
		console.log(
			JSON.stringify({
				sample: "external_source_records",
				url: plan.row.url,
				kind: plan.group,
				title: plan.title === plan.row.title ? { unchanged: plan.title } : { before: plan.row.title, after: plan.title },
				excerpt: diffWindow(plan.row.excerpt, plan.excerpt) ?? "unchanged",
			}),
		);
	}

	if (!applying && !rehearsing) {
		console.log(JSON.stringify({ status: "SIMULATED", toUpdate: { wikiPages: pagePlans.length, externalSources: sourcePlans.length } }));
		await sql.end({ timeout: 5 });
		process.exit(0);
	}

	// ── Instantané : les lignes exactement telles qu'elles vont être réécrites ──
	if (applying && snapshotPath) {
		const lines = [
			JSON.stringify({ header: true, script: "repare-entites-html-pages-collectees", createdAt: new Date().toISOString(), pattern: HTML_ENTITY_SQL_PATTERN, wikiPages: pagePlans.length, externalSources: sourcePlans.length }),
			...pagePlans.map(({ row }) => JSON.stringify({ table: "WikiPage", ...row })),
			...sourcePlans.map(({ row }) => JSON.stringify({ table: "external_source_records", ...row })),
		];
		const gzipped = Bun.gzipSync(Buffer.from(`${lines.join("\n")}\n`));
		await mkdir(dirname(snapshotPath), { recursive: true });
		await Bun.write(snapshotPath, gzipped);
		const written = new Uint8Array(await Bun.file(snapshotPath).arrayBuffer());
		const reread = new TextDecoder().decode(Bun.gunzipSync(written)).trimEnd().split("\n");
		if (reread.length !== lines.length) throw new Error("Instantané illisible : écriture interrompue avant toute modification.");
		const sha256 = createHash("sha256").update(written).digest("hex");
		console.log(JSON.stringify({ snapshot: snapshotPath, sha256, rows: lines.length - 1, bytes: written.byteLength }));
	}

	// ── Écriture par lots transactionnels ───────────────────────────────────────
	let pagesWritten = 0;
	let pagesAlreadyApplied = 0;
	let pagesChangedMeanwhile = 0;
	const pageBatches = Math.ceil(pagePlans.length / batchSize);
	for (let index = 0; index < pagePlans.length; index += batchSize) {
		const batch = pagePlans.slice(index, index + batchSize);
		const label = `WikiPage lot ${index / batchSize + 1}/${pageBatches}`;
		try {
			const result = await withRetry(label, () =>
				sql.begin(async (tx) => {
					const ids = batch.map((plan) => plan.row.id);
					const current = await tx<{ id: string; slug: string; title: string; body: string; categoryId: string }[]>`
						SELECT id, slug, title, body, "categoryId" AS "categoryId"
						FROM public."WikiPage" WHERE id IN ${tx(ids)} ORDER BY id FOR UPDATE
					`;
					const byId = new Map(current.map((row) => [row.id, row]));
					const updates: string[][] = [];
					const revisions: RevisionRow[] = [];
					let alreadyApplied = 0;
					let changedMeanwhile = 0;
					for (const plan of batch) {
						const row = byId.get(plan.row.id);
						if (row && row.title === plan.title && row.body === plan.body) {
							alreadyApplied++;
							continue;
						}
						// Only the exact planned (and snapshotted) state is ever rewritten.
						if (!row || row.title !== plan.row.title || row.body !== plan.row.body) {
							changedMeanwhile++;
							continue;
						}
						updates.push([row.id, plan.title, plan.body]);
						revisions.push({
							id: revisionId(),
							tableName: "WikiPage",
							rowId: row.id,
							action: "update",
							label: plan.title,
							before: tx.json({ title: row.title, body: row.body, categoryId: row.categoryId }),
							after: tx.json({ title: plan.title, slug: row.slug, body: plan.body, categoryId: row.categoryId }),
							editorId: EDITOR_ID,
							editorName: EDITOR_NAME,
						});
					}
					if (updates.length > 0) {
						await tx`
							UPDATE public."WikiPage" AS w
							SET title = v.title, body = v.body, "updatedAt" = NOW()
							FROM (VALUES ${tx(updates)}) AS v(id, title, body)
							WHERE w.id = v.id
						`;
						await tx`INSERT INTO public.wiki_revisions ${tx(revisions)}`;
						// jsonb must hold objects, never string scalars (docs/pieges.md).
						const [check] = await tx<{ objects: number }[]>`
							SELECT count(*)::int AS objects FROM public.wiki_revisions
							WHERE id IN ${tx(revisions.map((revision) => revision.id))}
								AND jsonb_typeof(before) = 'object' AND jsonb_typeof(after) = 'object'
						`;
						if (check?.objects !== revisions.length) throw new Error(`${label} : révisions jsonb mal typées, lot annulé.`);
					}
					if (rehearsing) throw new RehearsalRollback(JSON.stringify({ label, wouldWrite: updates.length, alreadyApplied, changedMeanwhile }));
					return { written: updates.length, alreadyApplied, changedMeanwhile };
				}),
			);
			pagesWritten += result.written;
			pagesAlreadyApplied += result.alreadyApplied;
			pagesChangedMeanwhile += result.changedMeanwhile;
			console.error(`${label} : ${result.written} écrites`);
		} catch (error) {
			if (!(error instanceof RehearsalRollback)) throw error;
			console.log(JSON.stringify({ status: "REHEARSED_AND_ROLLED_BACK", phase: "WikiPage", detail: JSON.parse(error.message) }));
			break;
		}
	}

	let sourcesWritten = 0;
	let sourcesAlreadyApplied = 0;
	let sourcesChangedMeanwhile = 0;
	const sourceBatches = Math.ceil(sourcePlans.length / batchSize);
	for (let index = 0; index < sourcePlans.length; index += batchSize) {
		const batch = sourcePlans.slice(index, index + batchSize);
		const label = `external_source_records lot ${index / batchSize + 1}/${sourceBatches}`;
		try {
			const result = await withRetry(label, () =>
				sql.begin(async (tx) => {
					const urls = batch.map((plan) => plan.row.url);
					const current = await tx<{ url: string; title: string; excerpt: string }[]>`
						SELECT url, title, excerpt FROM public.external_source_records WHERE url IN ${tx(urls)} ORDER BY url FOR UPDATE
					`;
					const byUrl = new Map(current.map((row) => [row.url, row]));
					const updates: string[][] = [];
					let alreadyApplied = 0;
					let changedMeanwhile = 0;
					for (const plan of batch) {
						const row = byUrl.get(plan.row.url);
						if (row && row.title === plan.title && row.excerpt === plan.excerpt) {
							alreadyApplied++;
							continue;
						}
						if (!row || row.title !== plan.row.title || row.excerpt !== plan.row.excerpt) {
							changedMeanwhile++;
							continue;
						}
						updates.push([row.url, plan.title, plan.excerpt]);
					}
					if (updates.length > 0) {
						await tx`
							UPDATE public.external_source_records AS r
							SET title = v.title, excerpt = v.excerpt
							FROM (VALUES ${tx(updates)}) AS v(url, title, excerpt)
							WHERE r.url = v.url
						`;
					}
					if (rehearsing) throw new RehearsalRollback(JSON.stringify({ label, wouldWrite: updates.length, alreadyApplied, changedMeanwhile }));
					return { written: updates.length, alreadyApplied, changedMeanwhile };
				}),
			);
			sourcesWritten += result.written;
			sourcesAlreadyApplied += result.alreadyApplied;
			sourcesChangedMeanwhile += result.changedMeanwhile;
			console.error(`${label} : ${result.written} écrites`);
		} catch (error) {
			if (!(error instanceof RehearsalRollback)) throw error;
			console.log(JSON.stringify({ status: "REHEARSED_AND_ROLLED_BACK", phase: "external_source_records", detail: JSON.parse(error.message) }));
			break;
		}
	}

	if (applying) {
		console.log(
			JSON.stringify({
				status: "APPLIED",
				wikiPages: { planned: pagePlans.length, written: pagesWritten, alreadyApplied: pagesAlreadyApplied, changedMeanwhile: pagesChangedMeanwhile },
				externalSources: { planned: sourcePlans.length, written: sourcesWritten, alreadyApplied: sourcesAlreadyApplied, changedMeanwhile: sourcesChangedMeanwhile },
			}),
		);
	}
} finally {
	await sql.end({ timeout: 5 });
}
