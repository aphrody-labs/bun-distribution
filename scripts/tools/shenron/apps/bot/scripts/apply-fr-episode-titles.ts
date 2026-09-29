/**
 * apply-fr-episode-titles.ts — Remplace `bot.db_episodes.title` par le titre
 * FRANÇAIS officiel (diffusion francophone AB / Toei France) pour les 5 séries
 * Dragon Ball, sourcé depuis les listes d'épisodes de Wikipédia FR.
 *
 * Le wiki = Neon source de vérité. `title` est une colonne ÉDITORIALE : on écrit
 * ici dans Neon, puis on propage vers le SQLite replica du bot via
 *   sudo systemctl start shenron-neon-pull.service
 *
 * Mapping chargé depuis apps/bot/data/fr-episode-titles.json :
 *   { [series]: { [number_in_series]: titre_fr } }
 * Idempotent : UPDATE ciblé par (series, number_in_series). Ne met à jour QUE si
 * un titre FR existe pour l'épisode ; logue les épisodes sans correspondance et
 * ne touche JAMAIS title_ja / title_romaji.
 *
 * Env requis : DATABASE_URL (Neon). Usage : via systemd-run avec EnvironmentFile.
 */
import postgres from "postgres";

const NEON_URL = process.env.DATABASE_URL;
if (!NEON_URL) {
	console.error("✗ DATABASE_URL (Neon) requis.");
	process.exit(1);
}

const MAP_PATH =
	process.env.FR_TITLES_JSON ?? new URL("../data/fr-episode-titles.json", import.meta.url).pathname;

type Mapping = Record<string, Record<string, string>>;
const mapping = (await Bun.file(MAP_PATH).json()) as Mapping;

const sql = postgres(NEON_URL, { max: 2, prepare: false });

let totalUpdated = 0;
const perSeries: Record<string, { updated: number; total: number; gaps: number[] }> = {};

for (const [series, byNum] of Object.entries(mapping)) {
	const rows = (await sql`
		SELECT number_in_series FROM bot.db_episodes WHERE series = ${series}
		ORDER BY number_in_series
	`) as unknown as { number_in_series: number }[];

	let updated = 0;
	const gaps: number[] = [];
	for (const r of rows) {
		const n = Number(r.number_in_series);
		const fr = byNum[String(n)];
		if (!fr || !fr.trim()) {
			gaps.push(n);
			continue;
		}
		await sql`
			UPDATE bot.db_episodes SET title = ${fr}
			WHERE series = ${series} AND number_in_series = ${n}
		`;
		updated++;
	}
	perSeries[series] = { updated, total: rows.length, gaps };
	totalUpdated += updated;
	console.log(
		`  ✓ ${series.padEnd(9)} : ${updated}/${rows.length} mis à jour` +
			(gaps.length ? `  · ${gaps.length} sans FR : ${gaps.join(", ")}` : "")
	);
}

console.log(`\n✓ Terminé : ${totalUpdated} épisodes mis à jour (FR).`);
for (const [s, c] of Object.entries(perSeries))
	console.log(`  - ${s.padEnd(9)} ${c.updated}/${c.total}  trous=${c.gaps.length}`);

await sql.end();
