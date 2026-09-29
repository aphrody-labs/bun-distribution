/**
 * enrich-episodes.ts — Stills d'épisodes via TMDB (scrape des pages saison).
 *
 * TMDB expose les vignettes d'épisodes (`/t/p/.../<hash>.jpg`) sur les pages
 * publiques `/tv/<id>/season/<n>`. On les extrait DANS L'ORDRE, on concatène
 * toutes les saisons d'une série, puis on mappe séquentiellement aux épisodes
 * (`db_episodes` triés par number_in_series) → UPDATE image.
 *
 * Pas d'API key : scrape HTML public (vignettes hébergées sur image.tmdb.org,
 * domaine déjà whitelist next/image à ajouter). Délai 1.2s/req anti rate-limit.
 *
 * Usage : bun apps/bot/scripts/enrich-episodes.ts
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
const UA =
	"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

// series DB → TMDB tv id
const TMDB: Record<string, number> = {
	DB: 12609,
	DBZ: 12971,
	DBS: 62715,
	DBGT: 12697,
	DB_DAIMA: 236994,
};

const STILL = "https://image.tmdb.org/t/p/w780/";

async function seasonStills(tvid: number, season: number): Promise<string[]> {
	const res = await fetch(`https://www.themoviedb.org/tv/${tvid}/season/${season}`, {
		headers: {
			"user-agent": UA,
			"accept-language": "fr-FR,fr;q=0.9,en;q=0.8",
		},
	});
	if (!res.ok) return [];
	const html = await res.text();
	const re = /w227_and_h127_face\/([A-Za-z0-9_-]+\.(?:jpg|png))/g;
	const seen = new Set<string>();
	const out: string[] = [];
	let m: RegExpExecArray | null;
	while ((m = re.exec(html))) {
		if (!seen.has(m[1])) {
			seen.add(m[1]);
			out.push(m[1]);
		}
	}
	return out;
}

async function collectStills(tvid: number): Promise<string[]> {
	const all: string[] = [];
	for (let s = 1; s <= 16; s++) {
		const stills = await seasonStills(tvid, s);
		await sleep(1200);
		if (stills.length === 0) {
			// 2 saisons vides d'affilée → fin
			if (s > 1) break;
			continue;
		}
		all.push(...stills);
	}
	return all;
}

async function main() {
	const upd = db.query(`UPDATE db_episodes SET image = ? WHERE id = ?`);
	let grandAdded = 0;

	for (const [series, tvid] of Object.entries(TMDB)) {
		const eps = db
			.query(
				`SELECT id, number_in_series FROM db_episodes WHERE series = ? AND (image IS NULL OR image = '') ORDER BY number_in_series`
			)
			.all(series) as { id: number; number_in_series: number }[];
		if (eps.length === 0) {
			console.log(`= ${series} : déjà complet`);
			continue;
		}
		const stills = await collectStills(tvid);
		const epsAll = db
			.query(
				`SELECT id, number_in_series FROM db_episodes WHERE series = ? ORDER BY number_in_series`
			)
			.all(series) as { id: number; number_in_series: number }[];
		let added = 0;
		for (let i = 0; i < epsAll.length && i < stills.length; i++) {
			upd.run(`${STILL}${stills[i]}`, epsAll[i].id);
			added++;
		}
		grandAdded += added;
		console.log(
			`✓ ${series} : ${stills.length} stills TMDB → ${added}/${epsAll.length} épisodes mappés`
		);
	}

	const cov = db
		.query(`SELECT COUNT(*) c FROM db_episodes WHERE image IS NOT NULL AND image<>''`)
		.get() as { c: number };
	const tot = db.query(`SELECT COUNT(*) c FROM db_episodes`).get() as {
		c: number;
	};
	console.log(`\n+${grandAdded} · couverture épisodes : ${cov.c}/${tot.c}`);
	db.close();
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
