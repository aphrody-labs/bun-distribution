/**
 * wiki-articles.ts — Orchestrateur de génération des ARTICLES de wiki long-format.
 *
 * Contexte. Les tables éditoriales `bot.*` (PostgreSQL du site, source de vérité)
 * n'avaient qu'un champ `description` court (~50-220 c). Ce script ajoute et
 * peuple un vrai champ `article` long-format (markdown encyclopédique), sourcé sur
 * le corpus RAG (planches manga + databooks + données structurées) avec citations.
 *
 * Colonnes ajoutées (PG-only, ignorées par le reverse-sync Neon→SQLite via
 * intersection de colonnes, comme `players`/`frames`/`pages`) :
 *   - article            text      → corps markdown long
 *   - article_sources    jsonb     → [{ n, label, url, kind }] citations
 *   - article_updated_at bigint    → epoch secondes
 *
 * Le site lit ces colonnes directement (Drizzle, schéma `bot`) et les rend via
 * <WikiMarkdown/>. AUCUNE écriture côté SQLite du bot (replica de lecture).
 *
 * Sous-commandes :
 *   migrate                              → DDL idempotent (ADD COLUMN IF NOT EXISTS)
 *   list <type> [--missing] [--limit N]  → entités à remplir (JSON)
 *        [--has-article] (régénération)   [--ids 1,2] [--names "a,b"] [--has-desc]
 *        [--sans-sources] (bibliographie vide après la purge Fandom)
 *   context <type> <id>                  → bundle de grounding RAG (texte sourcé)
 *   write <type> <id> --article-file F --sources-file F   → UPDATE PG
 *   stats                                → couverture article par table
 *
 * Types : characters | planets | sagas | arcs | techniques | transformations | races
 *
 * Grounding : recherche manga via Aphrody en mode RAG_BACKEND=aphrody ;
 * l'index FTS5 local reste disponible pour les déploiements antérieurs.
 *
 * Env : DATABASE_URL = PG du site (via ~/.shenron-neon.env). BOT_DB = chemin sqlite.
 * Usage : bun apps/shenron/bot/scripts/wiki-articles.ts <cmd> [...]
 */
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { AphrodyComputeClient } from "@shenron/pipeline/aphrody";
import {
	applyIllustration,
	illustrationTypeFor,
	WikiIllustrator,
} from "../src/lib/images/wiki-illustration";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
	console.error("✗ DATABASE_URL (PG du site) requis dans l'environnement.");
	process.exit(1);
}
const BOT_DB = process.env.BOT_DB ?? new URL("../data/bot.db", import.meta.url).pathname;

// ── Config par type d'entité ────────────────────────────────────────────────
interface EntityType {
	/** Nom de table SQL (schéma bot). */
	table: string;
	/** Colonne d'affichage principale. */
	nameCol: string;
	/** Colonnes contextuelles à inclure dans le grounding. */
	extra: string[];
	/** Mot pour les requêtes RAG (« le personnage », « la planète »…). */
	noun: string;
	/** Facettes de requête RAG (FR). */
	facets: string[];
}

const TYPES: Record<string, EntityType> = {
	characters: {
		table: "db_characters",
		nameCol: "name",
		extra: ["name_ja", "name_romaji", "race", "gender", "affiliation", "ki", "max_ki"],
		noun: "le personnage",
		facets: [
			"histoire enfance origine naissance",
			"pouvoirs techniques transformations combats",
			"personnalite famille relations",
			"apparitions saga arc manga",
		],
	},
	planets: {
		table: "db_planets",
		nameCol: "name",
		extra: ["name_ja", "name_romaji", "is_destroyed"],
		noun: "la planete",
		facets: ["histoire habitants peuple", "destruction", "geographie environnement"],
	},
	sagas: {
		table: "db_sagas",
		nameCol: "name",
		extra: ["name_ja", "series"],
		noun: "la saga",
		facets: ["intrigue resume", "personnages affrontements", "arcs episodes"],
	},
	arcs: {
		table: "db_arcs",
		nameCol: "name",
		extra: ["name_ja"],
		noun: "l'arc",
		facets: ["intrigue resume", "combats personnages", "denouement"],
	},
	techniques: {
		table: "db_techniques",
		nameCol: "name",
		extra: ["name_ja", "name_romaji", "type"],
		noun: "la technique",
		facets: ["utilisateurs createur", "fonctionnement effet", "premiere apparition manga"],
	},
	transformations: {
		table: "db_transformations",
		nameCol: "name",
		extra: ["ki"],
		noun: "la transformation",
		facets: ["conditions activation", "apparence pouvoir", "premiere apparition"],
	},
	races: {
		table: "db_races",
		nameCol: "name",
		extra: ["name_ja"],
		noun: "la race",
		facets: ["caracteristiques biologie", "planete origine", "membres notables"],
	},
};

function pickType(name: string | undefined): EntityType {
	const t = name && TYPES[name];
	if (!t) {
		console.error(`✗ Type inconnu « ${name} ». Attendus : ${Object.keys(TYPES).join(", ")}`);
		process.exit(1);
	}
	return t;
}

// ── Helpers FTS5 ────────────────────────────────────────────────────────────
const STOP = new Set([
	"le",
	"la",
	"les",
	"un",
	"une",
	"des",
	"de",
	"du",
	"et",
	"ou",
	"a",
	"au",
	"aux",
	"en",
	"the",
	"of",
	"and",
	"son",
	"sa",
	"ses",
	"ce",
	"cette",
	"dans",
	"pour",
	"par",
	"sur",
	"est",
	"the",
	"to",
	"in",
]);

/** Fold accents + minuscule + alnum → tokens (le tokenizer FTS est remove_diacritics 2). */
function tokens(s: string): string[] {
	return s
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, " ")
		.split(/\s+/)
		.filter((w) => w.length >= 2 && !STOP.has(w));
}

/** Phrase FTS quotée à partir d'un nom (ex. `"son goku"`). */
function phrase(name: string): string {
	const t = tokens(name);
	return t.length ? `"${t.join(" ")}"` : "";
}

/** Groupe OR de tokens d'une facette (ex. `(histoire OR enfance OR origine)`). */
function orGroup(facet: string): string {
	const t = [...new Set(tokens(facet))];
	return t.length ? `(${t.join(" OR ")})` : "";
}

interface Hit {
	rowid: number;
	sourceId?: string;
	kind: string;
	title: string;
	url: string;
	content: string;
	lang: string;
	source_id: string;
}

async function remoteManga(query: string, limit: number): Promise<Hit[]> {
	const hits = await new AphrodyComputeClient().ragSearch(query, limit, { sourceId: "manga" });
	return hits.map((hit, index) => ({
		rowid: Number(hit.sourceId?.match(/^shenron:(\d+)$/)?.[1] ?? index + 1),
		sourceId: hit.sourceId,
		kind: hit.kind,
		title: hit.title,
		url: hit.url,
		content: hit.content ?? hit.snippet,
		lang: hit.lang ?? "",
		source_id: hit.originSourceId ?? "manga",
	}));
}

/** Recherche FTS5 read-only, FR d'abord, repli toutes langues. */
function ftsSearch(db: Database, match: string, limit: number, frOnly: boolean): Hit[] {
	const sql = `SELECT rowid, kind, title, url, content, lang, source_id
		FROM rag_chunks WHERE rag_chunks MATCH ?${frOnly ? " AND lang = 'fr'" : ""}
		ORDER BY rank LIMIT ?`;
	try {
		return db.query(sql).all(match, limit) as unknown as Hit[];
	} catch {
		return [];
	}
}

/**
 * Recherche FTS5 restreinte au corpus MANGA (`source_id='manga'`) — la
 * transcription OCR des planches (2412 chunks). SOURCE UNIQUE du grounding
 * (les wikis de fans sont bannis : on veut un wiki ancré manga). Cf. boost/quota rag.ts.
 */
function ftsManga(db: Database, match: string, limit: number): Hit[] {
	const sql = `SELECT rowid, kind, title, url, content, lang, source_id
		FROM rag_chunks WHERE rag_chunks MATCH ? AND source_id = 'manga'
		ORDER BY rank LIMIT ?`;
	try {
		return db.query(sql).all(match, limit) as unknown as Hit[];
	} catch {
		return [];
	}
}

// Bruit OCR récurrent à purger des planches (watermarks scanteam, marques).
const MANGA_NOISE =
	/scantrad\.?net|krash|edizioni|star\s*co[mh]ics|fullcolor|\bdrag\b|\bcohics\b|©|scan[-\s]?vf/gi;
// SFX / onomatopées (bulles de son) : suites de capitales avec voyelle redoublée
// ou consonnes répétées, mono-syllabes bruitées. Heuristique volontairement large.
const SFX =
	/\b(?:[BCDFGHJKLMNPQRSTVWXZ]*(?:A{2,}|E{2,}|O{2,}|U{2,}|I{2,})[BCDFGHJKLMNPQRSTVWXZ]*|[BCDFGHJKLMNPQRSTVWXZ]{2,}|H[AEU]+|GW[A]+SH|TH[OM]+|RM+BL|BAO+M|BOBO[MN]+|DOM|THM|SHH+|GYA+H|WAA+H|VLATOH|TAC|TAP|TOC|BRR|HII+|KII+H|GNN|UUH|HEHE|HMM|BLA)\b/g;

/** Nettoie une planche OCR : purge watermarks/SFX/bruit, garde le dialogue FR. */
function cleanManga(text: string): string {
	return (
		text
			.replace(MANGA_NOISE, " ")
			// retire les runs de caractères japonais résiduels (SFX/onomatopées JP)
			.replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu, " ")
			.replace(SFX, " ")
			// tokens poubelle : isolés non alphabétiques, runs de symboles, nombres seuls de page
			.replace(/\b[A-Z]?\d{1,4}\b/g, " ")
			.replace(/[^\p{L}\p{N}\s'’!?.,:;«»()-]/gu, " ")
			// lettres isolées (bruit) MAIS on préserve les élisions FR (C', L', J', qu'…)
			.replace(/(?<![\p{L}'’])\p{L}(?![\p{L}'’])/gu, " ")
			.replace(/\s+([.,!?;:])/g, "$1")
			.replace(/\s{2,}/g, " ")
			.replace(/([!?.])\1{2,}/g, "$1$1")
			.trim()
	);
}

/**
 * Coupe un titre de chapitre OCR à son 1er fragment PROPRE :
 * stoppe au 1er mot tout-en-capitales (≥2, bruit OCR / teaser collé : « DRAON RAY »,
 * « CESTUN INCONNU », « ILEST VAINQUEUR ») ou run CJK déjà retiré.
 */
function cleanTitle(raw: string): string {
	const s = raw.replace(/[　-鿿＀-￯]/g, " ").replace(MANGA_NOISE, " ");
	const out: string[] = [];
	for (const w of s.split(/\s+/)) {
		const letters = w.replace(/[^A-Za-zÀ-ÿ]/g, "");
		if (letters.length >= 2 && letters === letters.toUpperCase()) break; // run OCR / SFX
		if (w) out.push(w);
	}
	return out
		.join(" ")
		.replace(/\s{2,}/g, " ")
		.trim();
}

/** Extrait les titres de chapitres PROPRES d'un texte de planche (repères sûrs). */
function chapterTitles(text: string): string[] {
	const out: string[] = [];
	const re = /Chapitre\s*(\d{1,3})\s*:\s*([A-Za-zÀ-ÿ][^!?.\n]{2,60})/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(text))) {
		const title = cleanTitle(m[2]);
		if (title.length > 3) out.push(`Chapitre ${m[1]} : ${title}`);
	}
	return out;
}

// ── Commande: context ───────────────────────────────────────────────────────
async function cmdContext(typeName: string, idArg: string) {
	const T = pickType(typeName);
	const id = Number(idArg);
	const pg = postgres(DATABASE_URL!, { max: 1, prepare: false });
	const cols = [T.nameCol, "description", "article", ...T.extra].map((c) => `"${c}"`).join(", ");
	const rows = (await pg.unsafe(
		`SELECT ${cols} FROM bot."${T.table}" WHERE id = ${id} LIMIT 1`
	)) as unknown as Record<string, unknown>[];
	await pg.end();
	if (!rows.length) {
		console.error(`✗ ${typeName} #${id} introuvable.`);
		process.exit(1);
	}
	const row = rows[0];
	const name = String(row[T.nameCol] ?? "");
	const desc = String(row.description ?? "");
	const existing = String(row.article ?? "");

	const remote = process.env.RAG_BACKEND === "aphrody";
	const db = remote ? null : new Database(BOT_DB, { readonly: true });
	const namePhrase = phrase(name);
	const seen = new Map<string, Hit>();
	const order: string[] = [];

	const addHits = (hits: Hit[], cap: number) => {
		let n = 0;
		for (const h of hits) {
			if (n >= cap) break;
			const key = h.sourceId ?? `${h.rowid}`;
			if (seen.has(key)) continue;
			// On veut de la prose : on écarte les stubs trop courts (titres manga ~73 c)
			// sauf s'ils référencent un débUT (utile en citation). On garde >120 c.
			if ((h.content?.length ?? 0) < 120) continue;
			seen.set(key, h);
			order.push(key);
			n++;
		}
	};

	if (namePhrase) {
		// MANGA UNIQUEMENT — source de vérité. Les wikis de fans sont BANNIS du
		// grounding : on veut un wiki ancré sur les planches, pas une reformulation.
		addHits(remote ? await remoteManga(name, 16) : ftsManga(db!, namePhrase, 16), 14);
		for (const f of T.facets) {
			const g = orGroup(f);
			if (g) addHits(remote ? await remoteManga(`${name} ${f}`, 4) : ftsManga(db!, `${namePhrase} AND ${g}`, 4), 3);
		}
	}
	db?.close();

	const passages = order.map((rid) => seen.get(rid)!).slice(0, 16);
	const PER = 900;
	const sources: { n: number; label: string; url: string; kind: string }[] = [];
	const blocks: string[] = [];
	const chaptersSet = new Set<string>();
	passages.forEach((h, i) => {
		const n = i + 1;
		// Repères de chapitres (titres PROPRES) extraits de la planche.
		for (const c of chapterTitles(h.content ?? "")) chaptersSet.add(c);
		// Nettoyage agressif de l'OCR pour ne donner à l'agent que du dialogue lisible.
		const body = cleanManga(h.content ?? "").slice(0, PER);
		const rawLabel = (h.title ?? "").trim() || `planche #${h.rowid}`;
		const label = `Manga ${rawLabel}`;
		sources.push({ n, label, url: "/wiki/manga", kind: "manga" });
		blocks.push(`[${n}] (MANGA ${rawLabel})\n${body}`);
	});
	const mangaCount = passages.length;
	// Repères de chapitres triés (numériquement) — squelette propre et citable.
	const chapters = [...chaptersSet].toSorted((a, b) => {
		const na = Number(a.match(/\d+/)?.[0] ?? 0);
		const nb = Number(b.match(/\d+/)?.[0] ?? 0);
		return na - nb;
	});

	const extraFacts = T.extra
		.map((c) => (row[c] != null && String(row[c]).length ? `${c} = ${row[c]}` : null))
		.filter(Boolean)
		.join(" · ");

	// Sortie texte que l'agent rédacteur consomme.
	const out = [
		`ENTITÉ (${typeName} #${id}): ${name}`,
		extraFacts ? `FAITS STRUCTURÉS (notre base): ${extraFacts}` : "",
		desc ? `DESCRIPTION ACTUELLE (seed, NE PAS citer): ${desc}` : "",
		"",
		existing
			? `ARTICLE EXISTANT (BASE DE TRAVAIL — à MIGRER, pas à jeter) :\n` +
				`Cet article est déjà rédigé mais ses citations pointent FANDOM/jeux (INTERDIT). ` +
				`Conserve sa STRUCTURE, sa PROSE de qualité et les ENTITÉS qu'il mentionne (= liens internes & sujets à creuser), ` +
				`mais RÉ-ANCRE chaque fait notable sur les PLANCHES MANGA et REPÈRES CHAPITRES ci-dessous : remplace les renvois [n] Fandom par des citations manga, ` +
				`APPROFONDIS les passages que le manga éclaire, et SUPPRIME tout fait qui n'est ni dans le manga ni dans les faits structurés. ` +
				`Le résultat doit être au moins aussi riche que l'existant, mais 100 % sourcé manga.\n--- DÉBUT ARTICLE EXISTANT ---\n${existing}\n--- FIN ARTICLE EXISTANT ---`
			: "",
		"",
		chapters.length
			? `REPÈRES CHAPITRES MANGA (titres propres, citables tels quels) :\n` +
				chapters.map((c) => `  • ${c}`).join("\n")
			: "",
		"",
		mangaCount
			? `PLANCHES MANGA (${mangaCount}) — SOURCE UNIQUE autorisée avec les FAITS STRUCTURÉS. ` +
				`Le Fandom est INTERDIT : ne cite JAMAIS Fandom ni aucune URL externe, n'invente rien hors de ces planches + faits structurés.\n` +
				`Ces extraits sont de l'OCR de planches (bulles parfois désordonnées) DÉJÀ nettoyé : sers-t'en pour établir CE QUI SE PASSE dans le manga et À QUEL chapitre/tome, puis rédige une prose propre de ta plume. ANCRE chaque fait en citant la planche/chapitre [n] (ex. « …(Manga, ${name === "" ? "Tome X" : "Tome X / Chapitre NN"}) [n] »). N'invente pas de niveaux de ki.`
			: `AUCUNE PLANCHE MANGA trouvée pour cette entité → elle n'apparaît pas (ou très peu) dans le manga. Rédige un article COURT et factuel à partir des seuls FAITS STRUCTURÉS, en le signalant (« n'apparaît pas dans le manga original »). NE cite PAS Fandom.`,
		"",
		...blocks,
		"",
		`SOURCES_JSON: ${JSON.stringify(sources)}`,
	]
		.filter((l) => l !== "")
		.join("\n");
	process.stdout.write(out + "\n");
}

// ── Commande: list ──────────────────────────────────────────────────────────
async function cmdList(typeName: string, args: Args) {
	const T = pickType(typeName);
	const pg = postgres(DATABASE_URL!, { max: 1, prepare: false });
	const conds: string[] = [];
	if (args.flags.has("missing")) conds.push("(article IS NULL OR length(article) = 0)");
	if (args.flags.has("has-article")) conds.push("(article IS NOT NULL AND length(article) > 0)");
	// Régénération idempotente : articles encore sourcés Fandom/jeux (≠ manga pur).
	// Un article migré (sources manga) sort automatiquement de ce filtre → relance reprenable.
	if (args.flags.has("fandom-sources"))
		conds.push(
			"(article IS NOT NULL AND length(article) > 0 AND article_sources::text ~* '(fandom|wikia|xenoverse)')"
		);
	// Fiches laissées SANS bibliographie par la purge des sources Fandom : leur
	// texte survit mais plus rien ne l'atteste → prioritaires à ré-ancrer.
	if (args.flags.has("sans-sources"))
		conds.push(
			"(article IS NOT NULL AND length(article) > 0 AND coalesce(CASE WHEN jsonb_typeof(article_sources) = 'array' THEN jsonb_array_length(article_sources) END, 0) = 0)"
		);
	if (args.flags.has("has-desc")) conds.push("length(coalesce(description,'')) > 0");
	if (args.opts.ids) {
		const ids = args.opts.ids
			.split(",")
			.map((x) => Number(x.trim()))
			.filter((n) => !isNaN(n));
		if (ids.length) conds.push(`id IN (${ids.join(",")})`);
	}
	if (args.opts.names) {
		const ns = args.opts.names
			.split(",")
			.map((x) => x.trim().replace(/'/g, "''"))
			.filter(Boolean);
		if (ns.length)
			conds.push(`lower(${T.nameCol}) IN (${ns.map((n) => `'${n.toLowerCase()}'`).join(",")})`);
	}
	const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
	const limit = args.opts.limit ? `LIMIT ${Number(args.opts.limit)}` : "";
	const cols = ["id", T.nameCol, ...T.extra].map((c) => `"${c}"`).join(", ");
	const rows = (await pg.unsafe(
		`SELECT ${cols} FROM bot."${T.table}" ${where} ORDER BY id ${limit}`
	)) as unknown as Record<string, unknown>[];
	await pg.end();
	for (const r of rows) r.type = typeName;
	process.stdout.write(JSON.stringify(rows) + "\n");
}

// ── Commande: write ─────────────────────────────────────────────────────────
async function cmdWrite(typeName: string, idArg: string, args: Args) {
	const T = pickType(typeName);
	const id = Number(idArg);
	const articleFile = args.opts["article-file"];
	const sourcesFile = args.opts["sources-file"];
	if (!articleFile) {
		console.error("✗ --article-file requis.");
		process.exit(1);
	}
	const article = readFileSync(articleFile, "utf8").trim();
	if (article.length < 200) {
		console.error(`✗ Article trop court (${article.length} c) — refus (min 200).`);
		process.exit(1);
	}
	let sources: unknown = [];
	if (sourcesFile) {
		try {
			sources = JSON.parse(readFileSync(sourcesFile, "utf8"));
		} catch (e) {
			console.error(`✗ sources-file JSON invalide: ${e}`);
			process.exit(1);
		}
	}
	const pg = postgres(DATABASE_URL!, { max: 1, prepare: false });
	// jsonb : `pg.json(value)` impératif — `JSON.stringify(...)::jsonb` produirait un
	// SCALAIRE string, pas un array exploitable (pitfall CLAUDE.md `db_episodes.players`).
	// `pg(T.table)` quote l'identifiant de table (schéma `bot` littéral, lowercase).
	const res = await pg`
		UPDATE bot.${pg(T.table)}
		SET article = ${article},
		    article_sources = ${pg.json(sources as never)},
		    article_updated_at = ${Math.floor(Date.now() / 1000)}
		WHERE id = ${id}
		RETURNING id`;
	if (!(res as unknown as unknown[]).length) {
		await pg.end();
		console.error(`✗ ${typeName} #${id} introuvable (0 lignes).`);
		process.exit(1);
	}
	console.log(
		`✓ ${typeName} #${id} : article ${article.length} c, ${(sources as unknown[]).length ?? 0} sources.`
	);
	// ── Étape « illustration sourcée » (--illustrate) ─────────────────────────
	// Ne touche jamais au texte : pose `image` seulement si la fiche n'en a pas
	// (ou si le fichier manque), depuis nos propres sources (XV2, databooks, manga).
	// Une fiche sans candidat reste vide. Révision `public.wiki_revisions` par écriture.
	if (args.flags.has("illustrate")) {
		const T2 = illustrationTypeFor(typeName);
		if (T2) {
			const rows = (await pg.unsafe(
				`select id, name, ${T2.hasNameJa ? "name_ja" : "null as name_ja"}, image from bot.${T2.table} where id = $1`,
				[id]
			)) as unknown as { id: number; name: string; name_ja: string | null; image: string | null }[];
			const row = rows[0];
			const ill = new WikiIllustrator(pg, {
				bot: join(import.meta.dir, ".."),
				site: join(import.meta.dir, "..", "..", "site"),
			});
			await ill.loadInventoryCache();
			const need = row ? await ill.needsIllustration(row.image) : null;
			if (row && need && !need.lowRes) {
				const pick = await ill.pick({ type: typeName, id, name: row.name, nameJa: row.name_ja }, T2.sources);
				if (pick && pick.confidence >= 0.85) {
					await applyIllustration(pg, T2.table, id, row.image, pick, "wiki-articles");
					console.log(`  ✓ illustration ${pick.source} : ${pick.path} (${pick.provenance})`);
				} else console.log(pick ? `  – candidat faible (${pick.source}, confiance ${pick.confidence}) non appliqué : ${pick.path}` : "  – aucune illustration sourcée : la fiche reste sans image.");
			} else if (row && need?.lowRes) console.log(`  – image existante ${need.detail} conservée (voir wiki-illustrer --apply-low-res).`);
		}
	}
	await pg.end();
}

// ── Commande: migrate ───────────────────────────────────────────────────────
async function cmdMigrate() {
	const pg = postgres(DATABASE_URL!, { max: 1, prepare: false });
	for (const T of Object.values(TYPES)) {
		await pg.unsafe(`ALTER TABLE bot."${T.table}" ADD COLUMN IF NOT EXISTS article text`);
		await pg.unsafe(`ALTER TABLE bot."${T.table}" ADD COLUMN IF NOT EXISTS article_sources jsonb`);
		await pg.unsafe(
			`ALTER TABLE bot."${T.table}" ADD COLUMN IF NOT EXISTS article_updated_at bigint`
		);
		console.log(`✓ ${T.table} : colonnes article/article_sources/article_updated_at OK`);
	}
	await pg.end();
}

// ── Commande: stats ─────────────────────────────────────────────────────────
async function cmdStats() {
	const pg = postgres(DATABASE_URL!, { max: 1, prepare: false });
	console.log("type            total  article  %      avg_len");
	for (const [name, T] of Object.entries(TYPES)) {
		const r = (await pg.unsafe(
			`SELECT count(*)::int AS total,
			        count(*) FILTER (WHERE length(coalesce(article,''))>0)::int AS arts,
			        coalesce(round(avg(length(article)) FILTER (WHERE length(coalesce(article,''))>0)),0)::int AS avglen
			 FROM bot."${T.table}"`
		)) as unknown as { total: number; arts: number; avglen: number }[];
		const { total, arts, avglen } = r[0];
		const pct = total ? Math.round((arts / total) * 100) : 0;
		console.log(
			`${name.padEnd(15)} ${String(total).padStart(5)}  ${String(arts).padStart(6)}  ${String(pct).padStart(3)}%  ${String(avglen).padStart(6)}`
		);
	}
	await pg.end();
}

// ── Parsing CLI ─────────────────────────────────────────────────────────────
interface Args {
	flags: Set<string>;
	opts: Record<string, string>;
	positional: string[];
}
function parseArgs(argv: string[]): Args {
	const flags = new Set<string>();
	const opts: Record<string, string> = {};
	const positional: string[] = [];
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a.startsWith("--")) {
			const key = a.slice(2);
			const next = argv[i + 1];
			if (next !== undefined && !next.startsWith("--")) {
				opts[key] = next;
				i++;
			} else {
				flags.add(key);
			}
		} else {
			positional.push(a);
		}
	}
	return { flags, opts, positional };
}

async function main() {
	const [cmd, ...rest] = process.argv.slice(2);
	const args = parseArgs(rest);
	switch (cmd) {
		case "migrate":
			return cmdMigrate();
		case "stats":
			return cmdStats();
		case "list":
			return cmdList(args.positional[0], args);
		case "context":
			return cmdContext(args.positional[0], args.positional[1]);
		case "write":
			return cmdWrite(args.positional[0], args.positional[1], args);
		default:
			console.error(
				"Usage: bun apps/shenron/bot/scripts/wiki-articles.ts <migrate|stats|list|context|write> ..."
			);
			process.exit(1);
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
