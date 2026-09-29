#!/usr/bin/env bun
/**
 * ingest-jikan — peuple db_episodes + db_movies + db_manga_{volumes,chapters}
 * via l'API publique Jikan v4 (proxy MAL).
 * Rate-limit : 3 req/s — délai 400ms entre requêtes.
 */
import { db } from "./_db";
import { dbEpisodes, dbMovies, dbMangaVolumes, dbMangaChapters } from "../../src/db/schema";
import { eq, and } from "drizzle-orm";

const SLEEP = (ms: number) => new Promise((r) => setTimeout(r, ms));

// MAL IDs (anime) :
// 223 = Dragon Ball (153 ep), 813 = DBZ (291), 22777 = DBZ Kai Final Chapters,
// 6033 = Dragon Ball Z Kai (97 ep), 12189 = DB Movie Battle of Gods,
// 30694 = DB Super (131), 53112 = DB Super Hero, 56894 = DB Daima
//
// QUATRE DE CES IDENTIFIANTS ÉTAIENT FAUX, et l'un a mis de fausses données en
// base (mesuré et corrigé le 2026-09-04, vérifié via AniList `Media(idMal:)`) :
//   54900 → **WIND BREAKER**, pas DAIMA. Nos épisodes 1 à 13 de DAIMA ont porté
//           pendant des mois les titres japonais, les rōmaji et les dates de
//           diffusion de cette autre série (`サクラとフウリン`, avril-juin 2024).
//           Réparé par `apps/site/scripts/corrige-episodes-daima.ts`.
//    9617 → le film **K-On!**, pas Dragon Ball Z Kai.
//   12095 et 33092 → HTTP 404, donc silencieusement sans effet.
// Un identifiant numérique ne se relit pas : le contrôle qui les a démasqués est
// de demander son TITRE à la source avant de lui faire écrire quoi que ce soit.
const ANIME_SERIES: { malId: number; series: string }[] = [
	{ malId: 223, series: "DB" },
	{ malId: 813, series: "DBZ" },
	{ malId: 6033, series: "DBZ_KAI" },
	{ malId: 22777, series: "DBZ_KAI_FINAL" },
	{ malId: 225, series: "DBGT" }, // Dragon Ball GT (64 ep + Goku Jr Special)
	{ malId: 30694, series: "DBS" },
	{ malId: 56894, series: "DB_DAIMA" },
];

// MAL IDs (movies)
const MOVIES: {
	malId: number;
	slug: string;
	titleEn?: string;
	series: string;
}[] = [
	{ malId: 1545, slug: "db-curse-of-the-blood-rubies", series: "DB_MOVIE" },
	{
		malId: 1546,
		slug: "db-sleeping-princess-in-devils-castle",
		series: "DB_MOVIE",
	},
	{ malId: 1547, slug: "db-mystical-adventure", series: "DB_MOVIE" },
	{ malId: 1548, slug: "db-path-to-power", series: "DB_MOVIE" },
	{ malId: 1029, slug: "dbz-dead-zone", series: "DBZ_MOVIE" },
	{ malId: 1031, slug: "dbz-worlds-strongest", series: "DBZ_MOVIE" },
	{ malId: 1032, slug: "dbz-tree-of-might", series: "DBZ_MOVIE" },
	{ malId: 1033, slug: "dbz-lord-slug", series: "DBZ_MOVIE" },
	{ malId: 1034, slug: "dbz-coolers-revenge", series: "DBZ_MOVIE" },
	{ malId: 1035, slug: "dbz-return-of-cooler", series: "DBZ_MOVIE" },
	{ malId: 1036, slug: "dbz-super-android-13", series: "DBZ_MOVIE" },
	{
		malId: 1037,
		slug: "dbz-broly-legendary-super-saiyan",
		series: "DBZ_MOVIE",
	},
	{ malId: 1038, slug: "dbz-bojack-unbound", series: "DBZ_MOVIE" },
	{ malId: 1039, slug: "dbz-broly-second-coming", series: "DBZ_MOVIE" },
	{ malId: 1040, slug: "dbz-bio-broly", series: "DBZ_MOVIE" },
	{ malId: 1041, slug: "dbz-fusion-reborn", series: "DBZ_MOVIE" },
	{ malId: 1042, slug: "dbz-wrath-of-the-dragon", series: "DBZ_MOVIE" },
	{ malId: 12189, slug: "dbs-battle-of-gods", series: "DBS_MOVIE" },
	{ malId: 22777, slug: "dbs-resurrection-f", series: "DBS_MOVIE" },
	{ malId: 36946, slug: "dbs-broly", series: "DBS_MOVIE" },
	{ malId: 53112, slug: "dbs-super-hero", series: "DBS_MOVIE" },
];

// MAL IDs (manga) : 3625 = DB, 25055 = DB Super
const MANGA: { malId: number; series: string }[] = [
	{ malId: 3625, series: "DB" },
	{ malId: 25055, series: "DBS" },
];

async function fetchJson<T>(url: string): Promise<T | null> {
	try {
		const r = await fetch(url, { headers: { "User-Agent": "DBFR-bot/1.0" } });
		if (!r.ok) return null;
		return (await r.json()) as T;
	} catch {
		return null;
	}
}

// === Anime episodes ===
let totalEp = 0;
for (const { malId, series } of ANIME_SERIES) {
	console.log(`\n[anime ${series}] mal=${malId}`);
	let page = 1;
	while (true) {
		const data = await fetchJson<{
			data: Array<{
				mal_id: number;
				title: string;
				title_japanese: string | null;
				title_romanji: string | null;
				aired: string | null;
				duration: number | null;
				synopsis?: string | null;
			}>;
			pagination: { has_next_page: boolean };
		}>(`https://api.jikan.moe/v4/anime/${malId}/episodes?page=${page}`);
		if (!data?.data?.length) break;
		for (const ep of data.data) {
			const exists = await db
				.select()
				.from(dbEpisodes)
				.where(and(eq(dbEpisodes.series, series), eq(dbEpisodes.numberInSeries, ep.mal_id)))
				.limit(1);
			if (exists.length === 0) {
				await db.insert(dbEpisodes).values({
					series,
					numberInSeries: ep.mal_id,
					title: ep.title || `Episode ${ep.mal_id}`,
					titleJa: ep.title_japanese ?? null,
					titleRomaji: ep.title_romanji ?? null,
					airDate: ep.aired ? new Date(ep.aired) : null,
					durationSec: null,
					synopsis: ep.synopsis ?? null,
					image: null,
					malId: ep.mal_id,
				});
				totalEp++;
			}
		}
		if (!data.pagination?.has_next_page) break;
		page++;
		await SLEEP(400);
	}
	Bun.stdout.write(`  +${totalEp} eps total\n`);
	await SLEEP(400);
}

// === Movies ===
let totalMv = 0;
for (const m of MOVIES) {
	const data = await fetchJson<{
		data: {
			titles: Array<{ type: string; title: string }>;
			title: string;
			title_japanese?: string;
			aired?: { from?: string };
			duration?: string;
			synopsis?: string;
			images?: { jpg: { large_image_url: string } };
		};
	}>(`https://api.jikan.moe/v4/anime/${m.malId}/full`);
	if (!data?.data) {
		await SLEEP(400);
		continue;
	}
	const x = data.data;
	const exists = await db.select().from(dbMovies).where(eq(dbMovies.slug, m.slug)).limit(1);
	if (exists.length > 0) {
		await SLEEP(400);
		continue;
	}
	const dur = x.duration?.match(/(\d+)\s*min/);
	await db.insert(dbMovies).values({
		slug: m.slug,
		title: x.title,
		titleJa: x.title_japanese ?? null,
		titleRomaji: null,
		series: m.series,
		releaseDate: x.aired?.from ? new Date(x.aired.from) : null,
		durationMin: dur ? Number(dur[1]) : null,
		synopsis: x.synopsis ?? null,
		poster: x.images?.jpg?.large_image_url ?? null,
		malId: m.malId,
		anilistId: null,
	});
	totalMv++;
	await SLEEP(400);
}
console.log(`\n[movies] +${totalMv}`);

// === Manga volumes (Jikan ne donne pas tous les chapitres, juste vol meta) ===
let totalMv2 = 0;
for (const { malId, series } of MANGA) {
	console.log(`\n[manga ${series}] mal=${malId}`);
	const meta = await fetchJson<{
		data: { volumes?: number; chapters?: number; title_japanese?: string };
	}>(`https://api.jikan.moe/v4/manga/${malId}/full`);
	if (!meta?.data?.volumes) continue;
	for (let v = 1; v <= meta.data.volumes; v++) {
		const exists = await db
			.select()
			.from(dbMangaVolumes)
			.where(and(eq(dbMangaVolumes.series, series), eq(dbMangaVolumes.volumeNumber, v)))
			.limit(1);
		if (exists.length > 0) continue;
		await db.insert(dbMangaVolumes).values({
			series,
			volumeNumber: v,
			title: `${series} — Volume ${v}`,
			titleJa: null,
			publishedAt: null,
			cover: null,
			isbn: null,
		});
		totalMv2++;
	}
	await SLEEP(400);
}
console.log(`\n[manga volumes] +${totalMv2}`);

console.log(`\nDONE Jikan ingest : ${totalEp} eps, ${totalMv} movies, ${totalMv2} volumes`);
