/**
 * import-voiranime-movies-players.ts — Importe les « lecteurs » (players) voir-anime
 * VF et VOSTFR par film depuis le dataset bxc `dragon-ball-full.json` vers
 * Neon (`bot.db_movies.players`, colonne jsonb Neon-only).
 *
 * Idempotent et ré-exécutable : réécrit intégralement `players` par film.
 * Colonne `players` = Neon-only (ignorée par le reverse-sync) → pas de propagation
 * SQLite nécessaire.
 *
 * Env requis : DATABASE_URL (Neon). Optionnel : VOIRANIME_JSON (chemin).
 * Usage : bun apps/bot/scripts/import-voiranime-movies-players.ts
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

const MOVIE_MAP: Record<number, { vostfr: string | null; vf: string | null }> = {
	12: { vostfr: "dragon-ball-super-broly", vf: "dragon-ball-super-broly-vf" },
	13: { vostfr: "dragon-ball-z-movie-kami-to-kami", vf: "dragon-ball-z-movie-14-kami-to-kami-vf" },
	14: {
		vostfr: "dragon-ball-z-movie-fukkatsu-no-f",
		vf: "dragon-ball-z-movie-15-fukkatsu-no-f-vf",
	},
	15: {
		vostfr: "dragon-ball-movie-1-shen-long-no-densetsu",
		vf: "dragon-ball-movie-1-shen-long-no-densetsu-vf",
	},
	16: {
		vostfr: "dragon-ball-film-02-majinjou-no-nemuri-hime",
		vf: "dragon-ball-film-02-majinjou-no-nemuri-hime-vf",
	},
	17: {
		vostfr: "dragon-ball-movie-3-makafushigi-daibouken",
		vf: "dragon-ball-movie-3-makafushigi-daibouken-vf",
	},
	18: {
		vostfr: "dragon-ball-movie-4-saikyou-e-no-michi",
		vf: "dragon-ball-movie-4-saikyou-e-no-michi-vf",
	},
	19: {
		vostfr: "dragon-ball-z-movie-ora-no-gohan-wo-kaese",
		vf: "dragon-ball-z-movie-01-ora-no-gohan-wo-kaese-vf",
	},
	20: {
		vostfr: "dragon-ball-z-movie-konoyo-de-ichiban-tsuyoi-yatsu",
		vf: "dragon-ball-z-movie-02-konoyo-de-ichiban-tsuyoi-yatsu-vf",
	},
	21: {
		vostfr: "dragon-ball-z-movie-chikyuu-marugoto-chou-kessen",
		vf: "dragon-ball-z-movie-03-chikyuu-marugoto-chou-kessen-vf",
	},
	22: {
		vostfr: "dragon-ball-z-movie-super-saiyajin-da-son-goku",
		vf: "dragon-ball-z-movie-04-super-saiyajin-da-son-goku-vf",
	},
	23: {
		vostfr: "dragon-ball-z-movie-tobikkiri-no-saikyou-tai-saikyou",
		vf: "dragon-ball-z-movie-05-tobikkiri-no-saikyou-tai-saikyou-vf",
	},
	24: {
		vostfr: "dragon-ball-z-movie-gekitotsu-100-oku-power-no-senshi-tachi",
		vf: "dragon-ball-z-movie-06-gekitotsu-100-oku-power-no-senshi-tachi-vf",
	},
	25: {
		vostfr: "dragon-ball-z-movie-kyokugen-battle-sandai-super-saiyajin",
		vf: "dragon-ball-z-movie-07-kyokugen-battle-sandai-super-saiyajin-vf",
	},
	26: {
		vostfr: "dragon-ball-z-movie-moetsukiro-nessen-ressen-chou-gekisen",
		vf: "dragon-ball-z-movie-08-moetsukiro-nessen-ressen-chou-gekisen-vf",
	},
	27: {
		vostfr: "dragon-ball-z-movie-ginga-girigiri-bucchigiri-no-sugoi-yatsu",
		vf: "dragon-ball-z-movie-09-ginga-girigiri-bucchigiri-no-sugoi-yatsu-vf",
	},
	28: {
		vostfr: "dragon-ball-z-kiken-na-futari-super-senshi-wa-nemurenai",
		vf: "dragon-ball-z-movie-10-kiken-na-futari-super-senshi-wa-nemurenai-vf",
	},
	29: {
		vostfr: "dragon-ball-z-movie-super-senshi-gekiha-katsu-no-wa-ore-da",
		vf: "dragon-ball-z-movie-11-super-senshi-gekiha-katsu-no-wa-ore-da-vf",
	},
	30: {
		vostfr: "dragon-ball-z-movie-fukkatsu-no-fusion-goku-to-vegeta",
		vf: "dragon-ball-z-movie-12-fukkatsu-no-fusion-goku-to-vegeta-vf",
	},
	31: {
		vostfr: "dragon-ball-z-movie-ryuuken-bakuhatsu-goku-ga-yaraneba-dare-ga-yaru",
		vf: "dragon-ball-z-movie-13-ryuuken-bakuhatsu-goku-ga-yaraneba-dare-ga-yaru-vf",
	},
	35: { vostfr: "dragon-ball-episode-of-bardock", vf: null },
	36: { vostfr: "dragon-ball-super-super-hero", vf: null },
};

type Player = {
	name: string;
	provider: string;
	embedUrl: string;
	lang?: "vf" | "vostfr";
};
type VEpisode = { number: number | null; players?: Player[] };
type VSeries = { slug: string; episodes: VEpisode[] };

const doc = (await Bun.file(JSON_PATH).json()) as { series: VSeries[] };
const bySlug = new Map(doc.series.map((s) => [s.slug, s]));

function getMoviePlayers(slug: string | null, lang: "vf" | "vostfr"): Player[] {
	if (!slug) return [];
	const s = bySlug.get(slug);
	if (!s) {
		console.log(`  ⚠ slug voiranime absent : ${slug} (${lang})`);
		return [];
	}
	const players: Player[] = [];
	for (const ep of s.episodes) {
		if (ep.players) {
			for (const p of ep.players) {
				players.push({
					name: `${lang === "vf" ? "VF" : "VOSTFR"} · ${p.name}`,
					provider: p.provider,
					embedUrl: p.embedUrl,
					lang,
				});
			}
		}
	}
	return players;
}

const sql = postgres(NEON_URL, { max: 2, prepare: false });

let updated = 0;
let noMatch = 0;
let vfTouched = 0;

for (const [idStr, slugs] of Object.entries(MOVIE_MAP)) {
	const id = Number(idStr);
	const vf = getMoviePlayers(slugs.vf, "vf");
	const vostfr = getMoviePlayers(slugs.vostfr, "vostfr");
	const merged = [...vf, ...vostfr];

	if (merged.length === 0) {
		noMatch++;
		console.log(`  ✗ Film ID ${id} : aucun lecteur trouvé`);
		continue;
	}

	await sql`UPDATE bot.db_movies SET players = ${sql.json(merged)} WHERE id = ${id}`;
	updated++;
	if (vf.length) vfTouched++;
	console.log(`  ✓ Film ID ${id.toString().padEnd(2)} : ${vf.length} VF · ${vostfr.length} VOSTFR`);
}

console.log(
	`\n✓ Terminé : ${updated} films mis à jour (${vfTouched} avec VF), ${noMatch} sans aucune correspondance.`
);

await sql.end();
