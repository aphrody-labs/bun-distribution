/**
 * purge-fandom-sources.ts — Éradique Fandom des bibliographies du wiki.
 *
 * Fandom est une source interdite pour rédiger (cf. CLAUDE.md). Les articles
 * long-format importés en 2026 la citent encore massivement dans
 * `bot.<table>.article_sources`, avec des marqueurs `[n]` posés dans le corps
 * de l'article et dans les sections `bot.db_wiki_sections.body`.
 *
 * Le script :
 *   1. retire de `article_sources` toute référence dont l'URL ou le libellé
 *      pointe Fandom ;
 *   2. renumérote les sources restantes de 1..n ;
 *   3. réécrit les marqueurs `[n]` du corps et des sections — un marqueur qui
 *      visait une source Fandom disparaît, il n'est jamais réattribué à un
 *      voisin (on ne fabrique pas une preuve) ;
 *   4. journalise chaque fiche touchée dans `public.wiki_revisions`.
 *
 * Aucune ligne éditoriale n'est supprimée : un article dont toutes les sources
 * étaient Fandom garde son texte mais se retrouve sans bibliographie, et
 * ressort dans le rapport final pour re-sourçage manuel (manga, databooks).
 *
 * Usage :
 *   bun apps/bot/scripts/purge-fandom-sources.ts            # dry-run
 *   bun apps/bot/scripts/purge-fandom-sources.ts --apply
 */
import { randomBytes } from "node:crypto";
import postgres from "postgres";

const APPLY = process.argv.includes("--apply");
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
	console.error("✗ DATABASE_URL requis.");
	process.exit(1);
}

const sql = postgres(DATABASE_URL, { max: 4, prepare: false });

/** Tables éditoriales portant une bibliographie `article_sources`. */
const TABLES = [
	{ table: "db_characters", entity: "character" },
	{ table: "db_planets", entity: "planet" },
	{ table: "db_sagas", entity: "saga" },
	{ table: "db_arcs", entity: "arc" },
	{ table: "db_races", entity: "race" },
	{ table: "db_techniques", entity: "technique" },
	{ table: "db_transformations", entity: "transformation" },
] as const;

type WikiSource = { n: number; url?: string | null; kind?: string; label?: string };

const isFandom = (s: WikiSource) =>
	`${s?.url ?? ""} ${s?.label ?? ""}`.toLowerCase().includes("fandom");

/**
 * Réécrit les marqueurs `[n]` d'un texte selon `map` (ancien → nouveau).
 * Un `n` absent de la map visait une source retirée : le marqueur est effacé.
 * Les doublons produits par la suppression (`[3][3]`) sont recollapsés.
 */
function renumber(body: string, map: Map<number, number>): string {
	const out = body.replace(/\[(\d{1,3})\]/g, (whole, digits: string) => {
		const next = map.get(Number(digits));
		return next === undefined ? "" : `[${next}]`;
	});
	// `[2][2]` → `[2]` (deux sources différentes fusionnées après purge)
	return out.replace(/(\[\d{1,3}\])(?=\1)/g, "").replace(/ +([,.;:])/g, "$1");
}

const revisionId = () => randomBytes(12).toString("hex");

async function main() {
	let touched = 0;
	let removed = 0;
	const orphans: string[] = [];

	for (const { table, entity } of TABLES) {
		const rows = (await sql.unsafe(
			`SELECT id, name, article, article_sources FROM bot.${table}
			 WHERE article_sources::text ILIKE '%fandom%'`,
		)) as unknown as {
			id: number | string;
			name: string;
			article: string | null;
			article_sources: WikiSource[] | null;
		}[];

		for (const row of rows) {
			const before = row.article_sources ?? [];
			const kept = before.filter((s) => !isFandom(s));
			const dropped = before.length - kept.length;
			if (dropped === 0) continue;

			const map = new Map<number, number>();
			const after = kept.map((s, i) => {
				map.set(Number(s.n), i + 1);
				return Object.assign(s, { n: i + 1 });
			});

			const article = row.article ? renumber(row.article, map) : row.article;
			const sections = (await sql.unsafe(
				`SELECT id, body FROM bot.db_wiki_sections
				 WHERE entity_type = $1 AND entity_id = $2 AND body IS NOT NULL`,
				[entity, row.id],
			)) as unknown as { id: number; body: string }[];
			const newSections = sections
				.map((s) => ({ id: s.id, body: renumber(s.body, map) }))
				.filter((s, i) => s.body !== sections[i].body);

			removed += dropped;
			touched++;
			if (after.length === 0) orphans.push(`${table}#${row.id} ${row.name}`);

			if (APPLY) {
				await sql.begin(async (tx) => {
					// postgres-js sérialise déjà un objet JS en JSON pour une colonne jsonb :
					// lui passer `JSON.stringify(...)` produirait un jsonb de type *string*
					// (double encodage) et viderait la bibliographie côté site.
					await tx.unsafe(
						`UPDATE bot.${table} SET article_sources = $1::jsonb, article = $2 WHERE id = $3`,
						[tx.json(after) as never, article, row.id],
					);
					for (const s of newSections) {
						await tx.unsafe(`UPDATE bot.db_wiki_sections SET body = $1 WHERE id = $2`, [
							s.body,
							s.id,
						]);
					}
					await tx.unsafe(
						`INSERT INTO public.wiki_revisions
						   (id, "tableName", "rowId", action, label, before, after, "editorId", "editorName")
						 VALUES ($1, $2, $3, 'update', $4, $5::jsonb, $6::jsonb, NULL, $7)`,
						[
							revisionId(),
							table,
							String(row.id),
							row.name,
							tx.json({ article_sources: before, article: row.article }) as never,
							tx.json({ article_sources: after, article }) as never,
							"Claude (purge des sources Fandom)",
						],
					);
				});
			}
		}
		console.log(`${table}: ${rows.length} fiche(s) citant Fandom`);
	}

	console.log(
		`\n${APPLY ? "Appliqué" : "Simulation"} — ${touched} fiches, ${removed} références Fandom retirées.`,
	);
	if (orphans.length) {
		console.log(`\n${orphans.length} fiche(s) sans aucune source après purge (à re-sourcer) :`);
		for (const o of orphans) console.log(`  · ${o}`);
	}
	await sql.end();
}

await main();
