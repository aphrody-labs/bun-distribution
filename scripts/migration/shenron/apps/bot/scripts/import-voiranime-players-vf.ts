/**
 * import-voiranime-players-vf.ts — Importe les « lecteurs » (players) voir-anime
 * VF **et** VOSTFR par épisode depuis le dataset bxc `dragon-ball-full.json` vers
 * Neon (`bot.db_episodes.players`, colonne jsonb Neon-only).
 *
 * Différence avec import-voiranime-players.ts (legacy, VOSTFR uniquement) :
 *   - voir-anime expose des séries DÉDIÉES par doublage (slug `…-vf` distinct du
 *     slug VOSTFR). On lit les DEUX et on fusionne dans `players`.
 *   - chaque player reçoit un champ `lang` ("vf" | "vostfr") et son `name` est
 *     préfixé ("VF · myTV" / "VOSTFR · myTV") pour rester distinguable dans le
 *     sélecteur "Lecteur N" du site sans changer le composant.
 *   - VF placée EN PREMIER (audience FR) → "Lecteur 1" = première source VF.
 *
 * Idempotent et ré-exécutable : réécrit intégralement `players` par épisode.
 * Colonne `players` = Neon-only (ignorée par le reverse-sync) → pas de propagation
 * SQLite nécessaire.
 *
 * Mapping série DB → { vf, vostfr } slugs voiranime, épisodes appariés par number.
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

// série DB → slugs voiranime { vostfr, vf }. vf optionnel (Daima n'a pas de VF
// sur voir-anime à ce jour).
const SERIES_SLUG: Record<string, { vostfr: string; vf?: string }> = {
	DB: { vostfr: "dragon-ball", vf: "dragon-ball-vf" },
	DBZ: { vostfr: "dragon-ball-z", vf: "dragon-ball-z-vf" },
	DBGT: { vostfr: "dragon-ball-gt", vf: "dragon-ball-gt-vf" },
	DBS: { vostfr: "dragon-ball-super", vf: "dragon-ball-super-vf" },
	DB_DAIMA: { vostfr: "dragon-ball-daima" },
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

function indexByNumber(slug: string | undefined, lang: "vf" | "vostfr"): Map<number, Player[]> {
	const out = new Map<number, Player[]>();
	if (!slug) return out;
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
	return out;
}

const sql = postgres(NEON_URL, { max: 2, prepare: false });
await sql`ALTER TABLE bot.db_episodes ADD COLUMN IF NOT EXISTS players jsonb`;

let updated = 0;
let noMatch = 0;
let vfTouched = 0;
const perSeries: Record<string, { vf: number; vostfr: number; total: number }> = {};

for (const [series, slugs] of Object.entries(SERIES_SLUG)) {
	const vfByNum = indexByNumber(slugs.vf, "vf");
	const vostfrByNum = indexByNumber(slugs.vostfr, "vostfr");

	const rows = (await sql`
		SELECT id, number_in_series FROM bot.db_episodes WHERE series = ${series}
		ORDER BY number_in_series
	`) as unknown as { id: number; number_in_series: number }[];

	let sVf = 0;
	let sVostfr = 0;
	for (const r of rows) {
		const n = Number(r.number_in_series);
		const vf = vfByNum.get(n) ?? [];
		const vostfr = vostfrByNum.get(n) ?? [];
		// VF d'abord (audience FR), puis VOSTFR.
		const merged = [...vf, ...vostfr];
		if (merged.length === 0) {
			noMatch++;
			continue;
		}
		// postgres.js : passer l'objet via sql.json() pour un jsonb correct
		// (un `${JSON.stringify(x)}::jsonb` produit un scalaire string double-encodé).
		await sql`UPDATE bot.db_episodes SET players = ${sql.json(merged)} WHERE id = ${r.id}`;
		updated++;
		if (vf.length) {
			sVf++;
			vfTouched++;
		}
		if (vostfr.length) sVostfr++;
	}
	perSeries[series] = { vf: sVf, vostfr: sVostfr, total: rows.length };
	console.log(
		`  ✓ ${series.padEnd(10)} : VF ${sVf}/${rows.length} · VOSTFR ${sVostfr}/${rows.length}` +
			(slugs.vf ? "" : "  (pas de VF voir-anime)")
	);
}

console.log(
	`\n✓ Terminé : ${updated} épisodes mis à jour (${vfTouched} avec VF), ${noMatch} sans aucune correspondance.`
);
console.log("Récap couverture VF par série :");
for (const [s, c] of Object.entries(perSeries))
	console.log(`  - ${s.padEnd(10)} VF=${c.vf}/${c.total}  VOSTFR=${c.vostfr}/${c.total}`);

await sql.end();
