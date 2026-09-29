#!/usr/bin/env bun
/**
 * @file scripts/ops/manga-search-index.ts
 * Index de trigrammes pour la recherche dans le manga et les épisodes.
 *
 * Pourquoi : la recherche v2 (`chercherPlanches`, `chercherScenes`) compare le
 * texte sans accents par similarité de trigrammes. Sans index, c'est un
 * balayage complet — mesuré le 2026-09-12 : 580–800 ms par requête sur les
 * 12 593 planches. `unaccent()` étant STABLE, Postgres refuse de l'indexer :
 * on installe un wrapper IMMUTABLE et des index GIN dessus. Le site détecte le
 * wrapper au premier appel (`lib/pg-unaccent.ts`) et bascule tout seul.
 *
 * Sûreté : strictement additif et idempotent. `CREATE INDEX CONCURRENTLY` ne
 * verrouille pas les écritures ; relancer le script ne refait rien.
 * Retrait : `DROP INDEX CONCURRENTLY` des deux index puis `DROP FUNCTION` —
 * le site repasse alors sur `unaccent()` sans erreur.
 *
 * Usage :
 *   bun scripts/ops/manga-search-index.ts --dry-run   # affiche le SQL
 *   bun scripts/ops/manga-search-index.ts
 */
import { SQL } from "bun";

const DRY_RUN = process.argv.includes("--dry-run");

const ETAPES: Array<{ nom: string; sql: string }> = [
	{
		nom: "wrapper IMMUTABLE autour de unaccent",
		sql: `CREATE OR REPLACE FUNCTION bot.immutable_unaccent(text) RETURNS text
			LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
			AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$`,
	},
	{
		nom: "index GIN trigrammes — planches du manga",
		sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS db_manga_pages_text_trgm_idx
			ON bot.db_manga_pages USING gin (lower(bot.immutable_unaccent(text)) gin_trgm_ops)`,
	},
];

async function main() {
	if (DRY_RUN) {
		for (const e of ETAPES) console.log(`-- ${e.nom}\n${e.sql};\n`);
		return;
	}
	const url = process.env.DATABASE_URL;
	if (!url) {
		console.error("✗ DATABASE_URL manquant dans l'environnement.");
		process.exit(1);
	}
	const sql = new SQL(url);
	try {
		for (const e of ETAPES) {
			const t0 = performance.now();
			// CONCURRENTLY interdit les transactions : une instruction à la fois.
			await sql.unsafe(e.sql);
			console.log(`✓ ${e.nom} (${Math.round(performance.now() - t0)} ms)`);
		}
		const [taille] = await sql`
			SELECT pg_size_pretty(pg_relation_size('bot.db_manga_pages_text_trgm_idx')) AS taille
		`;
		console.log(`▶ taille de l'index : ${taille?.taille ?? "?"}`);
	} finally {
		await sql.end();
	}
}

await main();
