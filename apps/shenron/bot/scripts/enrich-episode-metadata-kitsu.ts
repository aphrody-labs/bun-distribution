/**
 * enrich-episode-metadata-kitsu.ts — comble les champs VIDES de
 * `bot.db_episodes` depuis Kitsu, en une seule passe : `synopsis`,
 * `title_ja`, `title_romaji`, `air_date`, `duration_sec`.
 *
 * Pourquoi un script de plus alors que `enrich-episode-synopsis-kitsu.ts`
 * existe : celui-là ne remplit QUE le synopsis, et repayait un parcours
 * complet de l'API pour chaque champ qu'on aurait voulu ajouter. Or une
 * réponse d'épisode Kitsu porte déjà les cinq champs — les écrire ensemble
 * divise par cinq le trafic vers une API publique sans clé, et garantit que
 * les cinq colonnes décrivent le MÊME épisode Kitsu (deux passes séparées
 * peuvent tomber sur une renumérotation entre-temps).
 *
 * Cible = Postgres `bot.*`, source de vérité éditoriale (cf. _wiki-editorial).
 * Le reverse-sync PG→SQLite propage ensuite au bot. Écrire dans SQLite serait
 * écrasé au prochain pull.
 *
 * IDEMPOTENT / REPRENABLE : un champ déjà rempli n'est JAMAIS réécrit — le
 * script ne peut donc pas dégrader une donnée saisie à la main. Relançable
 * après coupure. Aucun `--force` : écraser de l'éditorial avec de l'API est
 * précisément ce qu'on ne veut pas pouvoir faire par erreur.
 *
 * NUMÉROS AMBIGUS : Kitsu sert parfois deux entrées pour un même numéro
 * (mesuré sur Dragon Ball Kai 2014 : les n° 2 et 6 apparaissent deux fois).
 * Ces numéros sont ÉCARTÉS, pas arbitrés : rien ne dit laquelle des deux
 * fiches décrit l'épisode que porte notre base, et un tirage au sort
 * écrirait un synopsis faux sous une source qui a l'air fiable.
 *
 * Env requis : DATABASE_URL. Optionnel : ONLY_SERIES, LIMIT.
 * Usage :
 *   DATABASE_URL=… bun apps/shenron/bot/scripts/enrich-episode-metadata-kitsu.ts \
 *     [--dry-run] [--only DBZ_KAI] [--limit N] [--champs synopsis,duree]
 */
import postgres from "postgres";

const NEON_URL = process.env.DATABASE_URL;
if (!NEON_URL) {
	console.error("✗ DATABASE_URL requis.");
	process.exit(1);
}

const ARGV = process.argv.slice(2);
const has = (f: string) => ARGV.includes(f);
const val = (f: string, d: string) => {
	const i = ARGV.indexOf(f);
	return i >= 0 && ARGV[i + 1] ? ARGV[i + 1]! : d;
};
const DRY = has("--dry-run");
const ONLY = val("--only", process.env.ONLY_SERIES?.trim() || "");
const LIMIT = Number(val("--limit", process.env.LIMIT ?? "0")) || Number.POSITIVE_INFINITY;

/** Champs pilotables ; par défaut les cinq. */
const CHAMPS_CONNUS = ["synopsis", "titre_ja", "titre_romaji", "date", "duree"] as const;
type Champ = (typeof CHAMPS_CONNUS)[number];
const CHAMPS = new Set<Champ>(
	(val("--champs", "").trim()
		? (val("--champs", "")
				.split(",")
				.map((s) => s.trim()) as Champ[])
		: [...CHAMPS_CONNUS]
	).filter((c): c is Champ => (CHAMPS_CONNUS as readonly string[]).includes(c))
);
if (CHAMPS.size === 0) {
	console.error(`✗ --champs vide ou inconnu. Attendu parmi : ${CHAMPS_CONNUS.join(", ")}`);
	process.exit(1);
}

/**
 * série DB → id anime Kitsu. DB/DBZ/DBGT/DBS/DB_DAIMA repris tels quels de
 * `enrich-episode-synopsis-kitsu.ts` (déjà vérifiés titre + nombre d'épisodes).
 * Les deux Kai sont ajoutés ici : ce sont les seules séries à n'avoir eu
 * AUCUNE source de synopsis jusqu'ici (167 épisodes sur 826).
 */
const KITSU: Record<string, number> = {
	DB: 199,
	DBZ: 720,
	DBGT: 200,
	DBS: 10879,
	DB_DAIMA: 48108,
	// « Dragon Ball Kai » — 97 épisodes, 2009-04-05 → 2011-03-27. Couverture
	// mesurée le 2026-09-03 : 97/97 sur les quatre champs.
	DBZ_KAI: 4394,
	// « Dragon Ball Kai (2014) » (Final Chapters) — 69 entrées numérotées 1..68
	// côté Kitsu contre 70 épisodes en base : l'appariement est partiel par
	// construction, et c'est assumé (on comble ce qui apparie, rien d'autre).
	DBZ_KAI_FINAL: 8351,
};

const sql = postgres(NEON_URL, { max: 2, prepare: false });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type KitsuEp = {
	attributes: {
		number: number | null;
		synopsis: string | null;
		description: string | null;
		titles: { en_jp?: string; en_us?: string; ja_jp?: string } | null;
		airdate: string | null;
		length: number | null;
	};
};

/** Ce qu'on retient d'un épisode Kitsu, déjà normalisé aux types de la base. */
type Meta = {
	synopsis: string | null;
	titreJa: string | null;
	titreRomaji: string | null;
	/** epoch SECONDES — `db_episodes.air_date` est en secondes (vérifié : 509760000 = 1986-02-26). */
	date: number | null;
	/** `length` Kitsu est en MINUTES ; la base stocke des secondes. */
	dureeSec: number | null;
};

function normalise(a: KitsuEp["attributes"]): Meta {
	const syn = (a.synopsis ?? a.description ?? "").trim();
	const ja = (a.titles?.ja_jp ?? "").trim();
	const romaji = (a.titles?.en_jp ?? "").trim();
	// `Date.parse` d'un "YYYY-MM-DD" est interprété en UTC — voulu : les autres
	// air_date de la base sont des minuits UTC.
	const t = a.airdate ? Date.parse(`${a.airdate}T00:00:00Z`) : Number.NaN;
	return {
		synopsis: syn || null,
		titreJa: ja || null,
		titreRomaji: romaji || null,
		date: Number.isFinite(t) ? Math.floor(t / 1000) : null,
		dureeSec: typeof a.length === "number" && a.length > 0 ? a.length * 60 : null,
	};
}

/**
 * Tous les épisodes d'une série Kitsu → Map<numéro, Meta>.
 * Les numéros vus plus d'une fois sont retirés de la Map (cf. en-tête).
 */
async function kitsuEpisodes(
	animeId: number
): Promise<{ map: Map<number, Meta>; ambigus: number[] }> {
	const vus = new Map<number, Meta[]>();
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
			if (typeof n !== "number") continue;
			const l = vus.get(n) ?? [];
			l.push(normalise(e.attributes));
			vus.set(n, l);
		}
		if (data.length < 20) break;
		await sleep(300);
	}
	const map = new Map<number, Meta>();
	const ambigus: number[] = [];
	for (const [n, l] of vus) {
		if (l.length > 1) ambigus.push(n);
		else map.set(n, l[0]!);
	}
	return { map, ambigus: ambigus.toSorted((a, b) => a - b) };
}

type Row = {
	id: number;
	series: string;
	number_in_series: number | null;
	synopsis: string | null;
	title_ja: string | null;
	title_romaji: string | null;
	air_date: number | null;
	duration_sec: number | null;
};

// On ne sélectionne QUE les lignes à qui il manque au moins un des champs
// demandés : le parcours est ainsi proportionnel au travail restant, et un
// second passage à vide ne coûte qu'une requête.
const manque = (c: Champ) =>
	({
		synopsis: sql`(synopsis IS NULL OR synopsis = '')`,
		titre_ja: sql`(title_ja IS NULL OR title_ja = '')`,
		titre_romaji: sql`(title_romaji IS NULL OR title_romaji = '')`,
		date: sql`air_date IS NULL`,
		duree: sql`duration_sec IS NULL`,
	})[c];

const conds = [...CHAMPS].map(manque);
const ouManque = conds.reduce((acc, c) => (acc ? sql`${acc} OR ${c}` : c));

const rows = (await sql`
	SELECT id, series, number_in_series, synopsis, title_ja, title_romaji, air_date, duration_sec
	FROM bot.db_episodes
	WHERE (${ouManque})
	  ${ONLY ? sql`AND series = ${ONLY}` : sql``}
	  AND series IN ${sql(Object.keys(KITSU))}
	ORDER BY series, number_in_series
`) as unknown as Row[];

console.log(
	`→ ${rows.length} épisode(s) avec au moins un champ vide parmi [${[...CHAMPS].join(", ")}]${DRY ? " — SIMULATION" : ""}`
);

const seriesNeeded = [...new Set(rows.map((r) => r.series))].filter((s) => KITSU[s]);
const cache = new Map<string, Map<number, Meta>>();
for (const s of seriesNeeded) {
	const { map, ambigus } = await kitsuEpisodes(KITSU[s]!);
	cache.set(s, map);
	console.log(
		`  Kitsu ${s} (${KITSU[s]}) : ${map.size} épisode(s) exploitables` +
			(ambigus.length
				? ` — ${ambigus.length} numéro(s) écarté(s) pour doublon : ${ambigus.join(", ")}`
				: "")
	);
}

const compte: Record<Champ, number> = {
	synopsis: 0,
	titre_ja: 0,
	titre_romaji: 0,
	date: 0,
	duree: 0,
};
let touchees = 0;
let sansSource = 0;
let processed = 0;

for (const row of rows) {
	if (processed >= LIMIT) break;
	processed++;
	// postgres-js rend les bigint en chaînes → coercer avant le lookup.
	const n = row.number_in_series === null ? null : Number(row.number_in_series);
	const meta = n === null ? undefined : cache.get(row.series)?.get(n);
	if (!meta) {
		sansSource++;
		continue;
	}

	// Un champ n'est écrit que s'il est demandé, vide en base, ET fourni par
	// Kitsu. Les trois conditions, jamais deux.
	const set: Record<string, string | number> = {};
	if (CHAMPS.has("synopsis") && !row.synopsis?.trim() && meta.synopsis)
		set.synopsis = `${meta.synopsis}\n\n_(Source : Kitsu.)_`;
	if (CHAMPS.has("titre_ja") && !row.title_ja?.trim() && meta.titreJa) set.title_ja = meta.titreJa;
	if (CHAMPS.has("titre_romaji") && !row.title_romaji?.trim() && meta.titreRomaji)
		set.title_romaji = meta.titreRomaji;
	if (CHAMPS.has("date") && row.air_date === null && meta.date !== null) set.air_date = meta.date;
	if (CHAMPS.has("duree") && row.duration_sec === null && meta.dureeSec !== null)
		set.duration_sec = meta.dureeSec;

	const cles = Object.keys(set);
	if (cles.length === 0) continue;

	for (const c of CHAMPS) {
		const col = {
			synopsis: "synopsis",
			titre_ja: "title_ja",
			titre_romaji: "title_romaji",
			date: "air_date",
			duree: "duration_sec",
		}[c];
		if (col in set) compte[c]++;
	}
	touchees++;

	if (DRY) {
		console.log(`  [dry] ${row.series} #${n} (id ${row.id}) → ${cles.join(", ")}`);
		continue;
	}
	await sql`UPDATE bot.db_episodes SET ${sql(set, ...cles)} WHERE id = ${row.id}`;
}

console.log(
	`${DRY ? "≈" : "✓"} ${touchees} épisode(s) ${DRY ? "seraient mis à jour" : "mis à jour"} — ` +
		[...CHAMPS].map((c) => `${c}: ${compte[c]}`).join(", ") +
		` — ${sansSource} sans correspondance Kitsu.`
);
await sql.end();
