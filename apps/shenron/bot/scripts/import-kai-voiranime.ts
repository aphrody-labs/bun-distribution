/**
 * import-kai-voiranime.ts — Crée les fiches DBZ_KAI + DBZ_KAI_FINAL dans
 * `bot.db_episodes` (PG) et y fusionne les lecteurs voir-anime VF + VOSTFR.
 *
 * Voiranime numérote Kai en continu sous un seul slug :
 *   - VOSTFR `dragon-ball-kai`     eps 1…159
 *   - VF     `dragon-ball-kai-vf`  eps 1…167
 *
 * Mapping wiki :
 *   - DBZ_KAI        number_in_series = n        pour n ∈ 1..KAI_PART1 (97)
 *   - DBZ_KAI_FINAL  number_in_series = n        mappé à voiranime (97 + n)
 *     Ex. Final #1 → voiranime #98
 *
 * Si le dataset dépasse 97+61 (canon Final Chapters), on importe ce qui mappe
 * proprement (eps supplémentaires loggés) sans jeter le reste.
 *
 * Players : même convention que import-voiranime-players-vf.ts
 *   - name préfixé "VF ·" / "VOSTFR ·"
 *   - lang: "vf" | "vostfr"
 *   - VF en premier
 *   - jsonb via sql.json() (jamais JSON.stringify brut)
 *
 * Idempotent : skip insert si (series, number_in_series) existe ; réécrit players.
 *
 * Env : DATABASE_URL (requis). VOIRANIME_JSON optionnel.
 * Usage :
 *   set -a; source ~/.shenron-neon.env; set +a
 *   bun apps/shenron/bot/scripts/import-kai-voiranime.ts
 */
import os from "node:os";
import postgres from "postgres";

const NEON_URL = process.env.DATABASE_URL;
if (!NEON_URL) {
	console.error("✗ DATABASE_URL (Neon/PG) requis.");
	process.exit(1);
}

const JSON_PATH =
	process.env.VOIRANIME_JSON ?? `${os.homedir()}/bxc/data/voiranime/dragon-ball-full.json`;

/** Première partie Kai (MAL 9617) — declaredEpisodes voiranime = 97. */
const KAI_PART1 = 97;
/** Canon Final Chapters (MAL 33092) — pour log d'écart uniquement. */
const KAI_FINAL_CANON = 61;

const VOSTFR_SLUG = "dragon-ball-kai";
const VF_SLUG = "dragon-ball-kai-vf";

/**
 * Kai Final en VOSTFR : voir-anime numérote la VOSTFR selon la diffusion
 * japonaise (1→159) et la VF selon le découpage international (1→167). « 97 + n »
 * est juste pour la VF et faux pour la VOSTFR — la fiche 40 recevait la VOSTFR de
 * l'épisode japonais 137 au lieu de 130 (trace.moe, 2026-09-13). La VOSTFR suit
 * donc la table de `kai-final-correspondance.ts` ; une fiche absente de la table
 * (épisode japonais scindé par le découpage international) n'en reçoit aucune.
 */
const vostfrKaiFinal = new Map<number, number>(
	(
		(await Bun.file(new URL("../data/kai-final-correspondance.json", import.meta.url)).json()) as {
			entrees: { n: number; jp: number }[];
		}
	).entrees.map((e) => [e.n, e.jp])
);

type Player = {
	name: string;
	provider: string;
	embedUrl: string;
	lang?: "vf" | "vostfr";
};
type VEpisode = { number: number | null; label?: string; players?: Player[] };
type VSeries = { slug: string; title?: string; declaredEpisodes?: number; episodes: VEpisode[] };

const file = Bun.file(JSON_PATH);
if (!(await file.exists())) {
	console.error(`✗ Dataset introuvable : ${JSON_PATH}`);
	process.exit(1);
}

const doc = (await file.json()) as { series: VSeries[] };
const bySlug = new Map(doc.series.map((s) => [s.slug, s]));

function indexByNumber(slug: string, lang: "vf" | "vostfr"): Map<number, Player[]> {
	const out = new Map<number, Player[]>();
	const s = bySlug.get(slug);
	if (!s) {
		console.log(`  ⚠ slug voiranime absent : ${slug} (${lang})`);
		return out;
	}
	for (const e of s.episodes) {
		if (typeof e.number === "number" && e.players?.length) {
			out.set(
				e.number,
				e.players.map((p) => ({
					name: `${lang === "vf" ? "VF" : "VOSTFR"} · ${p.name}`,
					provider: p.provider,
					embedUrl: p.embedUrl,
					lang,
				}))
			);
		}
	}
	console.log(
		`  · ${slug.padEnd(22)} ${lang.padEnd(6)} : ${out.size} eps avec players (sur ${s.episodes.length})`
	);
	return out;
}

function maxEpisodeNumber(slug: string): number {
	const s = bySlug.get(slug);
	if (!s) return 0;
	let m = 0;
	for (const e of s.episodes) {
		if (typeof e.number === "number" && e.number > m) m = e.number;
	}
	return m;
}

const vfByNum = indexByNumber(VF_SLUG, "vf");
const vostfrByNum = indexByNumber(VOSTFR_SLUG, "vostfr");

const maxVoir = Math.max(maxEpisodeNumber(VF_SLUG), maxEpisodeNumber(VOSTFR_SLUG));
const finalCount = Math.max(0, maxVoir - KAI_PART1);

if (finalCount !== KAI_FINAL_CANON) {
	console.log(
		`  ⚠ écart Final : dataset → ${finalCount} eps (voiranime ${KAI_PART1 + 1}…${maxVoir}),` +
			` canon MAL ≈ ${KAI_FINAL_CANON}. Import de ${finalCount} fiches Final.`
	);
}
if (maxVoir < KAI_PART1) {
	console.log(
		`  ⚠ dataset max=${maxVoir} < KAI_PART1=${KAI_PART1} — DBZ_KAI tronqué à ${maxVoir}.`
	);
}

const sql = postgres(NEON_URL, { max: 2, prepare: false });
await sql`ALTER TABLE bot.db_episodes ADD COLUMN IF NOT EXISTS players jsonb`;

// IDs manuels : pas d'IDENTITY auto partout.
const [{ max: maxIdRaw }] =
	(await sql`SELECT COALESCE(MAX(id), 0) AS max FROM bot.db_episodes`) as {
		max: string | number;
	}[];
let nextId = Number(maxIdRaw) + 1;

type Target = {
	series: "DBZ_KAI" | "DBZ_KAI_FINAL";
	numberInSeries: number;
	/** Numéro épisode dans le slug voiranime continu. */
	voirNum: number;
};

const targets: Target[] = [];
const kaiMax = Math.min(KAI_PART1, maxVoir);
for (let n = 1; n <= kaiMax; n++) {
	targets.push({ series: "DBZ_KAI", numberInSeries: n, voirNum: n });
}
for (let n = 1; n <= finalCount; n++) {
	targets.push({ series: "DBZ_KAI_FINAL", numberInSeries: n, voirNum: KAI_PART1 + n });
}

let created = 0;
let skippedExisting = 0;
let playersUpdated = 0;
let noMatch = 0;
const perSeries: Record<
	string,
	{ created: number; existing: number; withPlayers: number; noMatch: number }
> = {
	DBZ_KAI: { created: 0, existing: 0, withPlayers: 0, noMatch: 0 },
	DBZ_KAI_FINAL: { created: 0, existing: 0, withPlayers: 0, noMatch: 0 },
};

for (const t of targets) {
	const stats = perSeries[t.series]!;
	const existing = (await sql`
		SELECT id FROM bot.db_episodes
		WHERE series = ${t.series} AND number_in_series = ${t.numberInSeries}
		LIMIT 1
	`) as unknown as { id: number }[];

	let id: number;
	if (existing.length > 0) {
		id = Number(existing[0]!.id);
		skippedExisting++;
		stats.existing++;
	} else {
		const title = `Épisode ${t.numberInSeries}`;
		await sql`
			INSERT INTO bot.db_episodes (id, series, number_in_series, title, visible)
			VALUES (${nextId}, ${t.series}, ${t.numberInSeries}, ${title}, true)
		`;
		id = nextId;
		nextId++;
		created++;
		stats.created++;
	}

	const vf = vfByNum.get(t.voirNum) ?? [];
	const vostfrNum = t.series === "DBZ_KAI_FINAL" ? vostfrKaiFinal.get(t.numberInSeries) : t.voirNum;
	const vostfr = vostfrNum === undefined ? [] : (vostfrByNum.get(vostfrNum) ?? []);
	const merged = [...vf, ...vostfr];
	if (merged.length === 0) {
		noMatch++;
		stats.noMatch++;
		continue;
	}
	await sql`UPDATE bot.db_episodes SET players = ${sql.json(merged)} WHERE id = ${id}`;
	playersUpdated++;
	stats.withPlayers++;
}

console.log("\n=== Récap import Kai ===");
for (const [series, s] of Object.entries(perSeries)) {
	console.log(
		`  ${series.padEnd(14)} created=${s.created} existing=${s.existing}` +
			` players=${s.withPlayers} noMatch=${s.noMatch}`
	);
}
console.log(
	`\n✓ Terminé : ${created} créés, ${skippedExisting} déjà présents,` +
		` ${playersUpdated} players mis à jour, ${noMatch} sans lecteurs.`
);
console.log(`  next free id would be ${nextId}`);

await sql.end();
