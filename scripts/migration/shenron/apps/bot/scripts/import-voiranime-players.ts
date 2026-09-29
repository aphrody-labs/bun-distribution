/**
 * import-voiranime-players.ts — Importe les « lecteurs » (players) voir-anime
 * par épisode depuis le dataset bxc `dragon-ball-full.json` vers Neon
 * (`bot.db_episodes.players`, colonne jsonb Neon-only).
 *
 * Le site affiche ces lecteurs en iframe (sélecteur Lecteur 1/2/3…) sur la page
 * épisode. Les embeds ont des tokens éphémères (~12 h) → relancer le mapper bxc
 * puis ce script régulièrement (timer) pour garder les liens frais.
 *
 * Mapping série DB → slug voiranime, épisodes appariés par `number`.
 *
 * Env requis : DATABASE_URL (Neon). Optionnel : VOIRANIME_JSON (chemin).
 * Usage : via systemd-run avec EnvironmentFile.
 */
import postgres from "postgres";

const NEON_URL = process.env.DATABASE_URL;
if (!NEON_URL) {
	console.error("✗ DATABASE_URL (Neon) requis.");
	process.exit(1);
}

import os from "node:os";

const JSON_PATH =
	process.env.VOIRANIME_JSON ?? `${os.homedir()}/bxc/data/voiranime/dragon-ball-full.json`;

// série DB → slug principal voiranime (VOSTFR).
const SERIES_SLUG: Record<string, string> = {
	DB: "dragon-ball",
	DBZ: "dragon-ball-z",
	DBGT: "dragon-ball-gt",
	DBS: "dragon-ball-super",
	DB_DAIMA: "dragon-ball-daima",
};

type Player = { name: string; provider: string; embedUrl: string };
type VEpisode = { number: number | null; players?: Player[] };
type VSeries = { slug: string; episodes: VEpisode[] };

const doc = (await Bun.file(JSON_PATH).json()) as { series: VSeries[] };
const bySlug = new Map(doc.series.map((s) => [s.slug, s]));

const sql = postgres(NEON_URL, { max: 2, prepare: false });
await sql`ALTER TABLE bot.db_episodes ADD COLUMN IF NOT EXISTS players jsonb`;

let updated = 0;
let noMatch = 0;
for (const [series, slug] of Object.entries(SERIES_SLUG)) {
	const v = bySlug.get(slug);
	if (!v) {
		console.log(`  ⚠ slug voiranime absent : ${slug} (${series})`);
		continue;
	}
	const byNum = new Map<number, Player[]>();
	for (const e of v.episodes) {
		if (typeof e.number === "number" && e.players?.length) {
			byNum.set(
				e.number,
				e.players.map((p) => ({
					name: p.name,
					provider: p.provider,
					embedUrl: p.embedUrl,
				}))
			);
		}
	}
	const rows = (await sql`
		SELECT id, number_in_series FROM bot.db_episodes WHERE series = ${series}
	`) as unknown as { id: number; number_in_series: number }[];
	for (const r of rows) {
		const players = byNum.get(Number(r.number_in_series));
		if (!players) {
			noMatch++;
			continue;
		}
		// postgres.js : sql.json() pour un jsonb correct ; `${JSON.stringify}::jsonb`
		// produit un scalaire string double-encodé (bug attrapé 2026-05-28).
		await sql`UPDATE bot.db_episodes SET players = ${sql.json(players)} WHERE id = ${r.id}`;
		updated++;
	}
	console.log(`  ✓ ${series} (${slug}) : ${byNum.size} épisodes avec lecteurs côté voiranime`);
}

console.log(
	`✓ Terminé : ${updated} épisodes avec lecteurs importés, ${noMatch} sans correspondance.`
);
await sql.end();
