/**
 * enrich-episode-synopsis-kitsu.ts — 2e source pour `bot.db_episodes.synopsis`
 * (Neon), après Jikan (`enrich-episode-synopsis.ts`). Kitsu a une couverture
 * synopsis ~100 % (y compris les épisodes filler que MyAnimeList n'a pas).
 *
 * Ne remplit QUE les épisodes au synopsis vide → ne réécrit jamais un synopsis
 * Jikan déjà présent. Idempotent / resumable. Cible Neon (table éditoriale),
 * le reverse-sync propage ensuite au SQLite du bot.
 *
 * Env requis : DATABASE_URL (Neon). Optionnel : ONLY_SERIES, LIMIT.
 * Usage : via systemd-run avec EnvironmentFile (cf. enrich-episode-synopsis.ts).
 */
import postgres from "postgres";

const NEON_URL = process.env.DATABASE_URL;
if (!NEON_URL) {
	console.error("✗ DATABASE_URL (Neon) requis.");
	process.exit(1);
}

// series DB → id anime Kitsu (titre + nb d'épisodes vérifiés).
const KITSU: Record<string, number> = {
	DB: 199,
	DBZ: 720,
	DBGT: 200,
	DBS: 10879,
	DB_DAIMA: 48108,
};

const ONLY = process.env.ONLY_SERIES?.trim() || null;
const LIMIT = process.env.LIMIT ? Number(process.env.LIMIT) : Number.POSITIVE_INFINITY;

const sql = postgres(NEON_URL, { max: 2, prepare: false });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type KitsuEp = {
	attributes: { number: number | null; synopsis: string | null; description: string | null };
};

/** Récupère tous les synopsis d'une série Kitsu → Map<numéro, synopsis>. */
async function kitsuSynopses(animeId: number): Promise<Map<number, string>> {
	const map = new Map<number, string>();
	for (let offset = 0; offset < 1000; offset += 20) {
		let data: KitsuEp[] = [];
		for (let attempt = 0; attempt < 4; attempt++) {
			try {
				const res = await fetch(
					`https://kitsu.io/api/edge/anime/${animeId}/episodes?page%5Blimit%5D=20&page%5Boffset%5D=${offset}`,
					{ headers: { accept: "application/vnd.api+json" } }
				);
				if (res.status === 429) {
					await sleep(2500);
					continue;
				}
				if (!res.ok) break;
				data = ((await res.json()) as { data?: KitsuEp[] }).data ?? [];
				break;
			} catch {
				await sleep(1500);
			}
		}
		if (data.length === 0) break;
		for (const e of data) {
			const n = e.attributes.number;
			const s = (e.attributes.synopsis ?? e.attributes.description ?? "").trim();
			if (typeof n === "number" && s) map.set(n, s);
		}
		await sleep(300);
	}
	return map;
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

console.log(`→ ${rows.length} épisode(s) sans synopsis à compléter via Kitsu`);

// Pré-charge les synopsis Kitsu des séries concernées (1 fetch paginé / série).
const seriesNeeded = [...new Set(rows.map((r) => r.series))].filter((s) => KITSU[s]);
const cache = new Map<string, Map<number, string>>();
for (const s of seriesNeeded) {
	cache.set(s, await kitsuSynopses(KITSU[s]));
	console.log(`  Kitsu ${s} : ${cache.get(s)?.size ?? 0} synopsis chargés`);
}

let updated = 0;
let missing = 0;
let processed = 0;
for (const row of rows) {
	if (processed >= LIMIT) break;
	// postgres-js renvoie les colonnes bigint en string → coercer pour le lookup.
	const syn = cache.get(row.series)?.get(Number(row.number_in_series));
	processed++;
	if (syn) {
		const body = `${syn}\n\n_(Source : Kitsu.)_`;
		await sql`UPDATE bot.db_episodes SET synopsis = ${body} WHERE id = ${row.id}`;
		updated++;
	} else {
		missing++;
	}
}

console.log(`✓ Terminé : ${updated} synopsis écrits (Kitsu), ${missing} encore sans donnée.`);
await sql.end();
