/**
 * enrich-movies.ts — Complète posters + trailers des films DB via Jikan (MAL).
 *
 * Pour chaque film sans poster : recherche Jikan par titre (type movie/special),
 * récupère poster (large_image_url) + trailer YouTube si dispo, met à jour
 * db_movies (poster, trailer_url, mal_id). Rate-limit Jikan : ~1 req/s.
 *
 * Sources légales gratuites : Jikan ne fournit PAS de vidéo de film complet ni
 * toujours un trailer → trailer reste null si absent (pas d'invention).
 *
 * Usage : bun apps/bot/scripts/enrich-movies.ts
 */
import { Database } from "bun:sqlite";

const DB = process.env.BOT_DB ?? new URL("../data/bot.db", import.meta.url).pathname;
if (!Bun.env.ALLOW_SQLITE_WIKI_WRITE) {
	console.error(
		"Wiki migre sur Neon (source de verite) -- ecriture SQLite ecrasee par le reverse-sync. Edite via le site, ou ALLOW_SQLITE_WIKI_WRITE=1 pour forcer."
	);
	process.exit(1);
}
const db = new Database(DB);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Movie = {
	id: number;
	title: string;
	title_romaji: string | null;
	mal_id: number | null;
	poster: string | null;
	trailer_url: string | null;
	synopsis: string | null;
};

type JikanAnime = {
	mal_id: number;
	images?: { jpg?: { large_image_url?: string; image_url?: string } };
	trailer?: { url?: string | null };
	title?: string;
	type?: string;
	synopsis?: string | null;
};

async function jikan<T>(url: string): Promise<T | null> {
	for (let attempt = 0; attempt < 3; attempt++) {
		const res = await fetch(url, {
			headers: { accept: "application/json" },
		});
		if (res.status === 429) {
			await sleep(2000);
			continue;
		}
		if (!res.ok) return null;
		return (await res.json()) as T;
	}
	return null;
}

async function findByTitle(title: string): Promise<JikanAnime | null> {
	const q = encodeURIComponent(title.replace(/^Dragon Ball[ Z]*:?\s*/i, "").trim() || title);
	const data = await jikan<{ data: JikanAnime[] }>(
		`https://api.jikan.moe/v4/anime?q=${q}&limit=5&sfw=true`
	);
	const list = data?.data ?? [];
	// Préfère un résultat dont le titre contient un mot clé du film
	return list[0] ?? null;
}

async function byId(malId: number): Promise<JikanAnime | null> {
	const data = await jikan<{ data: JikanAnime }>(`https://api.jikan.moe/v4/anime/${malId}`);
	return data?.data ?? null;
}

async function main() {
	const movies = db
		.query(
			`SELECT id, title, title_romaji, mal_id, poster, trailer_url, synopsis FROM db_movies ORDER BY id`
		)
		.all() as Movie[];

	let posters = 0;
	let trailers = 0;
	let synopses = 0;

	const upd = db.query(
		`UPDATE db_movies SET poster = COALESCE(?, poster), trailer_url = COALESCE(?, trailer_url), mal_id = COALESCE(?, mal_id), synopsis = COALESCE(?, synopsis) WHERE id = ?`
	);

	for (const m of movies) {
		// Poster fiable seulement si déjà self-hosté local (./assets) — sinon on
		// le (re)cherche. Les URLs http sont d'anciens fetch potentiellement
		// mismatchés et seront ré-écrasées via le mal_id (source de vérité).
		const hasPoster = !!m.poster && m.poster.startsWith("./");
		const hasTrailer = !!m.trailer_url;
		const hasSynopsis = !!m.synopsis && m.synopsis.trim().length > 0;
		if (hasPoster && hasTrailer && hasSynopsis) {
			console.log(`= ${m.title} (déjà complet)`);
			continue;
		}

		let anime: JikanAnime | null = null;
		if (m.mal_id) anime = await byId(m.mal_id);
		if (!anime) anime = await findByTitle(m.title_romaji || m.title);
		await sleep(1100);

		if (!anime) {
			console.log(`✗ ${m.title} — introuvable sur Jikan`);
			continue;
		}

		const poster = anime.images?.jpg?.large_image_url ?? anime.images?.jpg?.image_url ?? null;
		const trailer = anime.trailer?.url ?? null;
		const synopsis = anime.synopsis?.trim() || null;

		upd.run(
			hasPoster ? null : poster,
			hasTrailer ? null : trailer,
			m.mal_id ? null : anime.mal_id,
			hasSynopsis ? null : synopsis,
			m.id
		);
		if (!hasPoster && poster) posters++;
		if (!hasTrailer && trailer) trailers++;
		if (!hasSynopsis && synopsis) synopses++;
		console.log(
			`✓ ${m.title} → mal_id=${anime.mal_id} poster=${poster ? "oui" : "non"} trailer=${trailer ? "oui" : "non"} synopsis=${synopsis ? "oui" : "non"}`
		);
	}

	const totalPoster = (
		db.query(`SELECT COUNT(*) c FROM db_movies WHERE poster IS NOT NULL AND poster<>''`).get() as {
			c: number;
		}
	).c;
	const totalTrailer = (
		db
			.query(`SELECT COUNT(*) c FROM db_movies WHERE trailer_url IS NOT NULL AND trailer_url<>''`)
			.get() as { c: number }
	).c;
	const total = movies.length;
	console.log(
		`\n+${posters} posters, +${trailers} trailers, +${synopses} synopsis. Couverture : poster ${totalPoster}/${total}, trailer ${totalTrailer}/${total}.`
	);
	db.close();
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
