/**
 * enrich-episode-synopsis.ts — Remplit `bot.db_episodes.synopsis` directement
 * dans **Neon** (source de vérité éditoriale), épisode par épisode, depuis
 * l'API Jikan (MyAnimeList).
 *
 * Pourquoi Neon et pas SQLite : `db_episodes` est une table du wiki éditorial
 * (cf. _wiki-editorial.ts). Le reverse-sync Neon→SQLite (timer 15 min) écrase
 * SQLite ; écrire ici dans SQLite serait perdu. On écrit donc dans Neon, le
 * site lit Neon en direct (visible immédiatement), et le bot reçoit la donnée
 * au prochain pull.
 *
 * Source = Jikan (déclarée dans db_sources). `number_in_series` est contigu
 * 1..N par série et égal à l'index épisode MAL → on l'utilise tel quel.
 * Idempotent : ne traite que les épisodes au synopsis vide, n'écrit que quand
 * un synopsis est trouvé → resumable, ré-exécutable sans risque.
 *
 * Env requis : DATABASE_URL = connection string Neon (chargée via
 *   /home/ubuntu/.shenron-neon.env, comme les timers de sync).
 * Env optionnels : ONLY_SERIES=DBZ (limiter à une série), LIMIT=10 (n épisodes).
 *
 * Usage :
 *   set -a; . /home/ubuntu/.shenron-neon.env; set +a; \
 *   /home/ubuntu/.bun/bin/bun apps/bot/scripts/enrich-episode-synopsis.ts
 */
import postgres from "postgres";

const NEON_URL = process.env.DATABASE_URL;
if (!NEON_URL) {
	console.error("✗ DATABASE_URL (Neon) requis dans l'environnement.");
	process.exit(1);
}

// series DB → id anime MAL (vérifiés via Jikan : titre + nb d'épisodes).
const ANIME: Record<string, number> = {
	DB: 223,
	DBZ: 813,
	DBGT: 225,
	DBS: 30694,
	DB_DAIMA: 56894,
};

const ONLY = process.env.ONLY_SERIES?.trim() || null;
const LIMIT = process.env.LIMIT ? Number(process.env.LIMIT) : Number.POSITIVE_INFINITY;

const sql = postgres(NEON_URL, { max: 2, prepare: false });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Récupère le synopsis d'un épisode via Jikan, avec retries (MAL flaky). */
async function jikanSynopsis(animeId: number, ep: number): Promise<string | null> {
	for (let attempt = 0; attempt < 4; attempt++) {
		try {
			const res = await fetch(`https://api.jikan.moe/v4/anime/${animeId}/episodes/${ep}`, {
				headers: { accept: "application/json" },
			});
			if (res.status === 429) {
				await sleep(2500); // rate-limit → backoff
				continue;
			}
			if (res.status >= 500) {
				await sleep(1500); // upstream MAL down → retry
				continue;
			}
			if (!res.ok) return null; // 404 etc. → pas de donnée
			const j = (await res.json()) as { data?: { synopsis?: string | null } };
			const s = j?.data?.synopsis;
			return typeof s === "string" && s.trim() ? s.trim() : null;
		} catch {
			await sleep(1500);
		}
	}
	return null;
}

type Row = { id: number; series: string; number_in_series: number };

const rows = ONLY
	? ((await sql`
			SELECT id, series, number_in_series FROM bot.db_episodes
			WHERE (synopsis IS NULL OR synopsis = '') AND series = ${ONLY}
			ORDER BY number_in_series
		`) as unknown as Row[])
	: ((await sql`
			SELECT id, series, number_in_series FROM bot.db_episodes
			WHERE (synopsis IS NULL OR synopsis = '')
			ORDER BY series, number_in_series
		`) as unknown as Row[]);

console.log(
	`→ ${rows.length} épisode(s) sans synopsis${ONLY ? ` (série ${ONLY})` : ""}` +
		(LIMIT !== Number.POSITIVE_INFINITY ? `, limité à ${LIMIT}` : "")
);

let updated = 0;
let missing = 0;
let skipped = 0;
let processed = 0;

for (const row of rows) {
	if (processed >= LIMIT) break;
	const animeId = ANIME[row.series];
	if (!animeId) {
		skipped++;
		continue;
	}
	processed++;
	const syn = await jikanSynopsis(animeId, row.number_in_series);
	if (syn) {
		await sql`UPDATE bot.db_episodes SET synopsis = ${syn} WHERE id = ${row.id}`;
		updated++;
	} else {
		missing++;
	}
	if (processed % 25 === 0) {
		console.log(
			`  … ${processed}/${Math.min(rows.length, LIMIT)} (maj ${updated}, vide ${missing})`
		);
	}
	await sleep(1100); // ~54 req/min < 60/min Jikan
}

console.log(
	`✓ Terminé : ${updated} synopsis écrits, ${missing} sans donnée Jikan, ${skipped} séries non mappées.`
);
await sql.end();
