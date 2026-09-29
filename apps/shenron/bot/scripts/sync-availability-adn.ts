/**
 * sync-availability-adn.ts — renseigne « où regarder légalement cet épisode /
 * ce film, et dans quelle langue » depuis le catalogue ADN (Animation Digital
 * Network), distributeur licencié de Dragon Ball en France.
 *
 * Écrit la colonne jsonb `availability` sur `bot.db_episodes` et
 * `bot.db_movies`. Elle est INDÉPENDANTE de `players` : `players` porte des
 * lecteurs tiers en iframe, `availability` porte un lien sortant vers l'offre
 * officielle. On ne mélange pas les deux — un lien ADN n'est pas un lecteur
 * qu'on incruste, c'est une destination.
 *
 * POURQUOI ADN plutôt qu'une liste écrite à la main : l'API rend, par épisode,
 * `languages` (vostf / vf) ET `available`. La couverture linguistique est donc
 * MESURÉE à chaque run, pas déclarée une fois puis périmée. Mesure du
 * 2026-09-03 : 826 épisodes sur 826 disponibles, dont 806 en VF et 826 en
 * VOSTFR — c'est-à-dire l'intégralité du catalogue, ce qu'aucune source
 * tierce ne garantit dans la durée.
 *
 * APPARIEMENT :
 *  - Épisodes : par numéro. ADN numérote Kai en CONTINU de 1 à 167 là où la
 *    base sépare `DBZ_KAI` (1..97) et `DBZ_KAI_FINAL` (1..70) — d'où le
 *    décalage explicite `offset` ci-dessous. Sans lui, les 70 Final Chapters
 *    pointeraient vers les 70 premiers épisodes de Kai.
 *  - Films : par titre français normalisé. Les titres FR d'ADN sont ceux de
 *    la base (« L'Offensive des cyborgs », « Fusions »…), ce qui donne une
 *    jointure vérifiable ; un film non apparié est listé, jamais deviné.
 *
 * IDEMPOTENT : la colonne est RÉÉCRITE à chaque run pour l'entrée ADN (c'est
 * un relevé de disponibilité, il doit pouvoir régresser si ADN retire un
 * titre), mais les entrées d'AUTRES fournisseurs sont préservées.
 *
 * Env requis : DATABASE_URL.
 * Usage :
 *   DATABASE_URL=… bun apps/shenron/bot/scripts/sync-availability-adn.ts [--dry-run]
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

const API = "https://gw.api.animationdigitalnetwork.fr";
const HEADERS = { "X-Target-Distribution": "fr", accept: "application/json" };

/**
 * série de la base → show ADN, avec le décalage de numérotation à appliquer.
 * `offset` = nombre d'épisodes ADN à sauter avant que le n° 1 de NOTRE série
 * ne commence.
 */
const SERIES: Record<string, { show: number; offset: number }> = {
	DB: { show: 996, offset: 0 },
	DBZ: { show: 1003, offset: 0 },
	DBGT: { show: 998, offset: 0 },
	DBS: { show: 999, offset: 0 },
	DB_DAIMA: { show: 1239, offset: 0 },
	DBZ_KAI: { show: 997, offset: 0 },
	// Final Chapters = épisodes 98..167 du show Kai chez ADN.
	DBZ_KAI_FINAL: { show: 997, offset: 97 },
};

/** Films ADN de la franchise (type MOV), découverts par la recherche catalogue. */
const RECHERCHES = ["dragon ball", "dragon"];

type AdnVideo = {
	id: number;
	title: string;
	shortNumber: string | null;
	url: string;
	embeddedUrl: string | null;
	languages: string[] | null;
	available: boolean;
	duration: number | null;
};

type AdnShow = {
	id: number;
	title: string;
	type: string;
	reference: string;
	languages: string[] | null;
};

/** Notre vocabulaire : ADN dit « vostf », le site dit « vostfr ». */
function langues(l: string[] | null | undefined): ("vf" | "vostfr")[] {
	const out = new Set<"vf" | "vostfr">();
	for (const x of l ?? []) {
		const v = x.toLowerCase();
		if (v === "vf") out.add("vf");
		// « vostf » (ADN) et « vostfr » (nous) désignent la même chose : la piste
		// audio japonaise d'origine, sous-titrée en français.
		if (v.startsWith("vost")) out.add("vostfr");
	}
	return [...out];
}

type Entree = {
	provider: "adn";
	label: string;
	url: string;
	embedUrl: string | null;
	langs: ("vf" | "vostfr")[];
	available: boolean;
	checkedAt: number;
};

async function getJson<T>(url: string): Promise<T | null> {
	for (let attempt = 0; attempt < 4; attempt++) {
		try {
			const res = await fetch(url, { headers: HEADERS });
			if (res.status === 429) {
				await sleep(2500);
				continue;
			}
			if (!res.ok) return null;
			return (await res.json()) as T;
		} catch {
			await sleep(1200);
		}
	}
	return null;
}

/** Toutes les vidéos d'un show ADN, paginées. */
async function videos(show: number): Promise<AdnVideo[]> {
	const out: AdnVideo[] = [];
	for (let offset = 0; offset < 2000; offset += 100) {
		const d = await getJson<{ videos?: AdnVideo[] }>(
			`${API}/video/show/${show}?offset=${offset}&limit=100`
		);
		const v = d?.videos ?? [];
		out.push(...v);
		if (v.length < 100) break;
		await sleep(200);
	}
	return out;
}

/** Normalise un titre pour la jointure : casse, accents, ponctuation, préfixe série. */
function cle(t: string): string {
	return t
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/^dragon ?ball( z| gt| super)? ?:? ?/i, "")
		.replace(/[^a-z0-9]+/g, " ")
		.trim();
}

const maintenant = Math.floor(Date.now() / 1000);

/** Fusionne l'entrée ADN dans une colonne `availability` existante. */
function fusionne(actuel: unknown, adn: Entree | null): Entree[] {
	// La colonne a pu être un scalaire corrompu par le passé (cf. piège sql.json
	// dans CLAUDE.md) : on ne fait confiance à rien.
	const autres = Array.isArray(actuel)
		? (actuel as Entree[]).filter((e) => e && e.provider !== "adn")
		: [];
	return adn ? [adn, ...autres] : autres;
}

// ── Épisodes ────────────────────────────────────────────────────────────────
await sql`ALTER TABLE bot.db_episodes ADD COLUMN IF NOT EXISTS availability jsonb`;
await sql`ALTER TABLE bot.db_movies   ADD COLUMN IF NOT EXISTS availability jsonb`;

console.log(`→ Relevé de disponibilité ADN${DRY ? " — SIMULATION" : ""}`);

let epMaj = 0;
let epVf = 0;
let epVostfr = 0;
let epSans = 0;

for (const [series, { show, offset }] of Object.entries(SERIES)) {
	const rows = (await sql`
		SELECT id, number_in_series, availability FROM bot.db_episodes
		WHERE series = ${series} ORDER BY number_in_series
	`) as unknown as { id: number; number_in_series: number | null; availability: unknown }[];
	if (rows.length === 0) continue;

	const vids = await videos(show);
	const parNum = new Map<number, AdnVideo>();
	for (const v of vids) {
		const n = Number(v.shortNumber);
		if (Number.isFinite(n)) parNum.set(n, v);
	}
	let ok = 0;
	for (const r of rows) {
		const n = r.number_in_series === null ? null : Number(r.number_in_series);
		const v = n === null ? undefined : parNum.get(n + offset);
		if (!v || !v.available) {
			epSans++;
			continue;
		}
		const langs = langues(v.languages);
		const entree: Entree = {
			provider: "adn",
			label: "ADN",
			url: v.url,
			embedUrl: v.embeddedUrl,
			langs,
			available: true,
			checkedAt: maintenant,
		};
		if (langs.includes("vf")) epVf++;
		if (langs.includes("vostfr")) epVostfr++;
		ok++;
		epMaj++;
		if (DRY) continue;
		await sql`
			UPDATE bot.db_episodes SET availability = ${sql.json(fusionne(r.availability, entree))}
			WHERE id = ${r.id}
		`;
	}
	console.log(
		`  ${series.padEnd(14)} adn:${show}${offset ? ` +${offset}` : ""} → ${ok}/${rows.length} épisode(s) disponibles`
	);
}

// ── Films ───────────────────────────────────────────────────────────────────
const shows = new Map<number, AdnShow>();
for (const q of RECHERCHES) {
	const d = await getJson<{ shows?: AdnShow[] }>(
		`${API}/show/catalog?search=${encodeURIComponent(q)}&limit=50`
	);
	for (const s of d?.shows ?? []) if (/dragon ?ball/i.test(s.title ?? "")) shows.set(s.id, s);
	await sleep(200);
}
const filmsAdn = [...shows.values()].filter((s) => s.type === "MOV");
console.log(`  films ADN découverts : ${filmsAdn.length}`);

/** titre normalisé → show film ADN (+ sa vidéo unique, pour l'URL de lecture). */
const filmParCle = new Map<string, AdnShow>();
for (const f of filmsAdn) filmParCle.set(cle(f.title), f);

/**
 * Films dont NOTRE titre est anglais là où ADN titre en français : la
 * jointure par titre échoue alors sans que le film soit absent du catalogue.
 * Clé = slug de la base, valeur = id du show ADN.
 */
const ALIAS: Record<string, number> = {
	// Base : « Dragon Ball Z: Resurrection 'F' » — ADN 430 : « La Résurrection de ‘F’ ».
	"dragon-ball-z-movie-15-fukkatsu-no-f": 430,
};
for (const [slug, id] of Object.entries(ALIAS)) {
	const f = filmsAdn.find((x) => x.id === id);
	if (f) filmParCle.set(`@${slug}`, f);
}

const movies = (await sql`
	SELECT id, slug, title, availability FROM bot.db_movies ORDER BY id
`) as unknown as { id: number; slug: string; title: string; availability: unknown }[];

let fMaj = 0;
let fVf = 0;
let fVostfr = 0;
const fSans: string[] = [];

for (const m of movies) {
	const f = filmParCle.get(`@${m.slug}`) ?? filmParCle.get(cle(m.title));
	if (!f) {
		fSans.push(`${m.slug} « ${m.title} »`);
		if (!DRY) {
			// Un film retiré du catalogue doit PERDRE son entrée ADN, sinon la page
			// promet une offre qui n'existe plus.
			const reste = fusionne(m.availability, null);
			await sql`UPDATE bot.db_movies SET availability = ${sql.json(reste)} WHERE id = ${m.id}`;
		}
		continue;
	}
	const vids = await videos(f.id);
	const v = vids.find((x) => x.available) ?? vids[0];
	const langs = langues(v?.languages ?? f.languages);
	const entree: Entree = {
		provider: "adn",
		label: "ADN",
		url: v?.url ?? `https://animationdigitalnetwork.com/video/${f.id}`,
		embedUrl: v?.embeddedUrl ?? null,
		langs,
		available: v?.available ?? true,
		checkedAt: maintenant,
	};
	if (langs.includes("vf")) fVf++;
	if (langs.includes("vostfr")) fVostfr++;
	fMaj++;
	if (DRY) {
		console.log(`  [dry] ${m.slug} ← adn:${f.id} « ${f.title} » [${langs.join(", ")}]`);
		continue;
	}
	await sql`
		UPDATE bot.db_movies SET availability = ${sql.json(fusionne(m.availability, entree))}
		WHERE id = ${m.id}
	`;
	await sleep(150);
}

console.log(
	`${DRY ? "≈" : "✓"} Épisodes : ${epMaj} avec offre ADN (VF ${epVf}, VOSTFR ${epVostfr}), ${epSans} sans.`
);
console.log(`${DRY ? "≈" : "✓"} Films : ${fMaj} avec offre ADN (VF ${fVf}, VOSTFR ${fVostfr}).`);
if (fSans.length) {
	console.log(`⚠ ${fSans.length} film(s) absents du catalogue ADN :`);
	for (const s of fSans) console.log(`   · ${s}`);
}
await sql.end();
