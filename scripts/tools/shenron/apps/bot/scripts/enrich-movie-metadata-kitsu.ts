/**
 * enrich-movie-metadata-kitsu.ts — comble les champs VIDES de `bot.db_movies`
 * depuis Kitsu : `title_ja`, `title_romaji`, `duration_min`.
 *
 * APPARIEMENT PAR DATE DE SORTIE, pas par titre. Nos slugs sont anglophones
 * (`tree-of-might`), Kitsu numérote en romaji (`Dragon Ball Z Movie 03`), et
 * la numérotation des films DBZ diffère d'une source à l'autre — apparier sur
 * le titre reviendrait à coder en dur une table de correspondance de mémoire,
 * c'est-à-dire à inventer. `release_date` est déjà en base pour les 26 films,
 * il est vérifiable, et une date de sortie théâtrale est unique dans la
 * franchise : c'est la seule clé de jointure honnête dont on dispose.
 *
 * Conséquence assumée : deux films dont la date diverge de la fiche Kitsu ne
 * sont PAS appariés et sont listés en fin de run. Mieux vaut deux trous
 * signalés que deux fiches remplies avec le titre japonais d'un autre film.
 *
 * Cible = Postgres `bot.*` (source de vérité éditoriale). Idempotent : un
 * champ déjà rempli n'est jamais réécrit, aucun `--force`.
 *
 * Env requis : DATABASE_URL.
 * Usage :
 *   DATABASE_URL=… bun apps/bot/scripts/enrich-movie-metadata-kitsu.ts [--dry-run]
 */
import postgres from "postgres";

const NEON_URL = process.env.DATABASE_URL;
if (!NEON_URL) {
	console.error("✗ DATABASE_URL requis.");
	process.exit(1);
}

const DRY = process.argv.includes("--dry-run");
const sql = postgres(NEON_URL, { max: 2, prepare: false });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type KitsuAnime = {
	id: string;
	attributes: {
		canonicalTitle: string | null;
		titles: { en_jp?: string; ja_jp?: string } | null;
		startDate: string | null;
		episodeLength: number | null;
		subtype: string | null;
	};
};

/**
 * Balaie le catalogue Kitsu de la franchise. Plusieurs requêtes car le filtre
 * plein-texte de Kitsu plafonne à 20 résultats et ne pagine pas de façon
 * fiable sur `filter[text]` : on croise donc requêtes et sous-types, puis on
 * déduplique par id.
 */
async function catalogueKitsu(): Promise<KitsuAnime[]> {
	const vus = new Map<string, KitsuAnime>();
	const requetes = [
		"dragon ball",
		"dragon ball z movie",
		"dragon ball z special",
		"dragon ball ova",
		"dragon ball super",
	];
	const sousTypes = ["movie", "special", "OVA", "ONA"];
	for (const q of requetes) {
		for (const st of sousTypes) {
			for (let attempt = 0; attempt < 3; attempt++) {
				try {
					const res = await fetch(
						`https://kitsu.io/api/edge/anime?filter%5Btext%5D=${encodeURIComponent(q)}&filter%5Bsubtype%5D=${st}&page%5Blimit%5D=20`,
						{ headers: { accept: "application/vnd.api+json" } }
					);
					if (res.status === 429) {
						await sleep(2500);
						continue;
					}
					if (!res.ok) break;
					const d = (await res.json()) as { data?: KitsuAnime[] };
					for (const a of d.data ?? []) vus.set(a.id, a);
					break;
				} catch {
					await sleep(1500);
				}
			}
			await sleep(200);
		}
	}
	return [...vus.values()];
}

type Row = {
	id: number;
	slug: string;
	title: string;
	release_date: number | null;
	title_ja: string | null;
	title_romaji: string | null;
	duration_min: number | null;
};

const rows = (await sql`
	SELECT id, slug, title, release_date, title_ja, title_romaji, duration_min
	FROM bot.db_movies
	WHERE (title_ja IS NULL OR title_ja = '')
	   OR (title_romaji IS NULL OR title_romaji = '')
	   OR duration_min IS NULL
	ORDER BY id
`) as unknown as Row[];

console.log(`→ ${rows.length} film(s) avec au moins un champ vide${DRY ? " — SIMULATION" : ""}`);

const catalogue = await catalogueKitsu();
console.log(`  Kitsu : ${catalogue.length} entrée(s) de la franchise récupérées`);

/** date "YYYY-MM-DD" → Map ; un jour portant deux sorties serait ambigu, on l'écarte. */
const parDate = new Map<string, KitsuAnime[]>();
for (const a of catalogue) {
	const d = a.attributes.startDate;
	if (!d) continue;
	const l = parDate.get(d) ?? [];
	l.push(a);
	parDate.set(d, l);
}

const jour = (epochSec: number) => new Date(epochSec * 1000).toISOString().slice(0, 10);

/**
 * Appariements forcés, pour les seuls films dont la date diverge de Kitsu.
 *
 * Chacun a été établi en comparant les SYNOPSIS, pas les titres : c'est une
 * preuve de contenu, vérifiable en relisant les deux fiches, là où une table
 * titre→id serait de la mémoire déguisée en donnée.
 *
 * La divergence de date n'est PAS corrigée ici : `release_date` est de
 * l'éditorial, et un script d'enrichissement n'a pas à réécrire une date que
 * quelqu'un a peut-être saisie exprès. Elle est signalée en fin de run.
 */
const FORCES: Record<string, { kitsu: string; preuve: string }> = {
	// Notre synopsis décrit le Namek Slug et la planète en route vers la Terre ;
	// Kitsu 797 : « A Super Namekian named Slug comes to invade Earth ».
	// Dates : base 1991-03-09, Kitsu 1991-03-19.
	"lord-slug": { kitsu: "797", preuve: "synopsis concordants (Slug, Namek, invasion)" },
	// Notre synopsis est la traduction quasi littérale de celui de Kitsu 874
	// (Dr Raichi, dernier Tsufuru, gaz destron). L'entrée 5997 est le REMAKE de
	// 2010 (bonus de Raging Blast 2) — à ne pas confondre.
	// Dates : base 1993-08-06, Kitsu 1993-07-23.
	"plan-to-eradicate-saiyans": {
		kitsu: "874",
		preuve: "synopsis concordants (Dr Raichi, Tsufuru, destron)",
	},
};

let touches = 0;
const compte = { title_ja: 0, title_romaji: 0, duration_min: 0 };
const orphelins: string[] = [];

for (const row of rows) {
	// postgres-js rend les bigint en chaînes.
	const rd = row.release_date === null ? null : Number(row.release_date);
	const force = FORCES[row.slug];
	const parId = force ? catalogue.find((a) => a.id === force.kitsu) : undefined;
	const cands = parId ? [parId] : rd === null ? [] : (parDate.get(jour(rd)) ?? []);
	if (force && parId) {
		console.log(
			`  · ${row.slug} apparié de force à kitsu:${force.kitsu} — ${force.preuve} ` +
				`(date base ${rd === null ? "absente" : jour(rd)} ≠ Kitsu ${parId.attributes.startDate})`
		);
	}
	if (cands.length !== 1) {
		orphelins.push(
			`${row.slug} (${rd === null ? "sans date" : jour(rd)})` +
				(cands.length > 1 ? ` — ${cands.length} candidats Kitsu, écarté` : "")
		);
		continue;
	}
	const a = cands[0]!.attributes;
	const set: Record<string, string | number> = {};
	const ja = (a.titles?.ja_jp ?? "").trim();
	const romaji = (a.titles?.en_jp ?? a.canonicalTitle ?? "").trim();
	if (!row.title_ja?.trim() && ja) set.title_ja = ja;
	if (!row.title_romaji?.trim() && romaji) set.title_romaji = romaji;
	if (row.duration_min === null && typeof a.episodeLength === "number" && a.episodeLength > 0)
		set.duration_min = a.episodeLength;

	const cles = Object.keys(set);
	if (cles.length === 0) continue;
	for (const k of cles) compte[k as keyof typeof compte]++;
	touches++;

	if (DRY) {
		console.log(
			`  [dry] ${row.slug} ← kitsu:${cands[0]!.id} « ${a.canonicalTitle} » → ${cles.join(", ")}`
		);
		continue;
	}
	await sql`UPDATE bot.db_movies SET ${sql(set, ...cles)} WHERE id = ${row.id}`;
}

console.log(
	`${DRY ? "≈" : "✓"} ${touches} film(s) ${DRY ? "seraient mis à jour" : "mis à jour"} — ` +
		`title_ja: ${compte.title_ja}, title_romaji: ${compte.title_romaji}, duration_min: ${compte.duration_min}`
);
if (orphelins.length) {
	console.log(`⚠ ${orphelins.length} film(s) sans correspondance de date (à traiter à la main) :`);
	for (const o of orphelins) console.log(`   · ${o}`);
}
await sql.end();
