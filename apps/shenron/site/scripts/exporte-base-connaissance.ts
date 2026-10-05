#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0

/**
 * Exporte une base de connaissance Dragon Ball autonome, destinée à un agent
 * de relecture des transcriptions de databooks qui travaille HORS du dépôt.
 *
 * Le problème que ça résout : l'agent OCR corrige du japonais sans savoir ce qui
 * existe dans l'univers. Il ne peut pas trancher entre 「ギャリック」(Galick, une
 * technique) et 「ガーリック」(Garlic, un personnage) parce que rien, dans une
 * planche isolée, ne le lui dit. Ce qui le lui dit est en base : 1 732 graphies
 * japonaises attestées, 1 323 personnages, 825 techniques, 318 ouvrages avec
 * leur auteur et leur date. L'export met tout ça à plat, à côté des 11 778
 * transcriptions à relire et de leur verdict.
 *
 * L'export est un CONSTAT, pas une vérité : il embarque ses propres trous
 * (couverture `name_ja` par table, planches déjà jugées fautives) dans
 * `manifeste.json`, parce qu'une base de connaissance dont on ignore les
 * lacunes fait plus de dégâts qu'elle n'en évite — un agent qui croit le
 * lexique complet « corrigera » tout ce qui n'y figure pas.
 *
 * Usage :
 *   bun apps/shenron/site/scripts/exporte-base-connaissance.ts
 *   bun apps/shenron/site/scripts/exporte-base-connaissance.ts --sortie ~/kb --sans-api
 *   bun apps/shenron/site/scripts/exporte-base-connaissance.ts --sans-transcriptions
 */
import { mkdir, writeFile, cp } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { classerDefaut, noteQualite, type Defaut } from "../src/lib/databooks-defauts";
import { contientJaponais } from "../src/lib/ja/normalisation";
import { graphiesJmdict } from "../src/lib/ja/dictionnaire";
import { distanceBornee } from "../src/lib/ja/anomalies";
import { normaliserJa } from "../src/lib/ja/normalisation";

const args = process.argv.slice(2);
const opt = (nom: string, defaut?: string) => {
	const i = args.indexOf(`--${nom}`);
	return i !== -1 && args[i + 1] ? args[i + 1]! : defaut;
};
const flag = (nom: string) => args.includes(`--${nom}`);

const SORTIE = opt("sortie", join(process.env.HOME ?? ".", "base-connaissance-dragon-ball"))!;
const SANS_TRANSCRIPTIONS = flag("sans-transcriptions");
const SANS_API = flag("sans-api");
const RACINE = join(import.meta.dir, "..");

/**
 * `apps/shenron/site/.env` porte DEUX lignes `DATABASE_URL` (l'ancienne Neon, en
 * commentaire mais placée avant, puis la locale). On ancre sur le début de
 * ligne et on prend la DERNIÈRE : un `grep | head -1` tape la Neon morte.
 */
function urlBase(): string {
	const lignes = readFileSync(join(RACINE, ".env"), "utf8").split("\n");
	const trouvees = lignes
		.filter((l) => l.startsWith("DATABASE_URL="))
		.map((l) => l.slice("DATABASE_URL=".length).replace(/^"|"$/g, "").trim());
	const url = trouvees.at(-1);
	if (!url) throw new Error("DATABASE_URL introuvable dans apps/shenron/site/.env");
	return url;
}

const sql = postgres(urlBase(), { max: 2 });

const journal = (m: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

async function ecrireJsonl(chemin: string, lignes: unknown[]): Promise<number> {
	const contenu = lignes.map((l) => JSON.stringify(l)).join("\n") + (lignes.length ? "\n" : "");
	await writeFile(chemin, contenu, "utf8");
	return Buffer.byteLength(contenu);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Données du wiki — une table = un fichier JSONL, colonnes telles quelles.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Colonnes volontairement écartées : elles pèsent lourd et n'apprennent rien à
 * une relecture de texte japonais (lecteurs vidéo morts, en-têtes de flux,
 * images extraites d'épisodes). `pages` des databooks part dans son propre
 * fichier, avec son verdict.
 */
const COLONNES_ECARTEES: Record<string, string[]> = {
	db_episodes: ["players", "stream_headers", "frames", "subtitles"],
	db_movies: ["players", "stream_headers", "subtitles"],
	db_databooks: ["pages"],
	db_manga_chapters: ["pages"],
};

const TABLES: { table: string; fichier: string; ordre: string }[] = [
	{ table: "db_characters", fichier: "personnages", ordre: "id" },
	{ table: "db_techniques", fichier: "techniques", ordre: "id" },
	{ table: "db_planets", fichier: "planetes", ordre: "id" },
	{ table: "db_races", fichier: "races", ordre: "id" },
	{ table: "db_transformations", fichier: "transformations", ordre: "id" },
	{ table: "db_sagas", fichier: "sagas", ordre: "order_idx" },
	{ table: "db_arcs", fichier: "arcs", ordre: "order_idx" },
	{ table: "db_episodes", fichier: "episodes", ordre: "id" },
	{ table: "db_movies", fichier: "films", ordre: "id" },
	{ table: "db_games", fichier: "jeux", ordre: "id" },
	{ table: "db_manga_volumes", fichier: "manga-tomes", ordre: "id" },
	{ table: "db_manga_chapters", fichier: "manga-chapitres", ordre: "id" },
	{ table: "db_databooks", fichier: "databooks", ordre: "id" },
	{ table: "db_wiki_sections", fichier: "sections-wiki", ordre: "id" },
	{
		table: "db_character_techniques",
		fichier: "liens-personnage-technique",
		ordre: "character_id",
	},
	{ table: "db_character_arcs", fichier: "liens-personnage-arc", ordre: "character_id" },
	{ table: "db_game_characters", fichier: "liens-jeu-personnage", ordre: "game_id" },
	{ table: "db_sources", fichier: "sources", ordre: "id" },
	{ table: "db_licenses", fichier: "licences", ordre: "key" },
	{ table: "db_tools", fichier: "outils-communautaires", ordre: "id" },
	{ table: "db_news", fichier: "actualites", ordre: "id" },
];

async function exporterTables(dossier: string) {
	const inventaire: Record<string, { lignes: number; octets: number; colonnes: string[] }> = {};
	for (const { table, fichier, ordre } of TABLES) {
		const colonnes = (
			await sql<{ column_name: string }[]>`
				SELECT column_name FROM information_schema.columns
				WHERE table_schema = 'bot' AND table_name = ${table}
				ORDER BY ordinal_position`
		)
			.map((c) => c.column_name)
			.filter((c) => !(COLONNES_ECARTEES[table] ?? []).includes(c));

		const lignes = await sql.unsafe(
			`SELECT ${colonnes.map((c) => `"${c}"`).join(", ")} FROM bot.${table} ORDER BY ${ordre}`
		);
		const octets = await ecrireJsonl(join(dossier, `${fichier}.jsonl`), lignes);
		inventaire[fichier] = { lignes: lignes.length, octets, colonnes };
		journal(`  ${fichier.padEnd(28)} ${String(lignes.length).padStart(6)} lignes`);
	}
	return inventaire;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Lexique japonais — l'ancre de toute correction de nom propre.
// ─────────────────────────────────────────────────────────────────────────────

interface EntreeLexique {
	ja: string;
	fr: string;
	romaji: string | null;
	type: string;
	id: string | number;
}

/**
 * `name_ja` empile les variantes ET leur romaji dans une seule cellule, séparés
 * par des virgules (« ザマスの意思, Zamasu no Ishi, 無限ザマス, Mugen Zamasu »).
 * On éclate, on ne garde que les fragments qui contiennent réellement du
 * japonais, et on rattache le romaji voisin quand il y en a un.
 */
function eclaterVariantes(brut: string): { ja: string; romaji: string | null }[] {
	const morceaux = brut
		.split(/[,、;]/)
		.map((m) =>
			m
				.trim()
				.replace(/^[（(]+|[）)]+$/g, "")
				.trim()
		)
		.filter(Boolean);
	const sortie: { ja: string; romaji: string | null }[] = [];
	for (let i = 0; i < morceaux.length; i++) {
		const m = morceaux[i]!;
		if (!contientJaponais(m) || m.length < 2) continue;
		const suivant = morceaux[i + 1];
		const romaji = suivant && !contientJaponais(suivant) ? suivant : null;
		sortie.push({ ja: m, romaji });
	}
	return sortie;
}

const SOURCES_LEXIQUE: { table: string; ja: string; fr: string; romaji?: string; type: string }[] =
	[
		{
			table: "db_characters",
			ja: "name_ja",
			fr: "name",
			romaji: "name_romaji",
			type: "personnage",
		},
		{ table: "db_techniques", ja: "name_ja", fr: "name", romaji: "name_romaji", type: "technique" },
		{ table: "db_planets", ja: "name_ja", fr: "name", type: "planete" },
		{ table: "db_races", ja: "name_ja", fr: "name", type: "race" },
		{ table: "db_sagas", ja: "name_ja", fr: "name", type: "saga" },
		{ table: "db_arcs", ja: "name_ja", fr: "name", type: "arc" },
		{ table: "db_episodes", ja: "title_ja", fr: "title", romaji: "title_romaji", type: "episode" },
		{ table: "db_movies", ja: "title_ja", fr: "title", romaji: "title_romaji", type: "film" },
		{ table: "db_games", ja: "title_ja", fr: "title", type: "jeu" },
		{ table: "db_manga_volumes", ja: "title_ja", fr: "title", type: "tome" },
		{ table: "db_manga_chapters", ja: "title_ja", fr: "title", type: "chapitre" },
		{ table: "db_databooks", ja: "title_ja", fr: "title", type: "databook" },
	];

async function construireLexique(): Promise<{
	entrees: EntreeLexique[];
	couverture: { type: string; table: string; total: number; avec_ja: number; taux: number }[];
}> {
	const entrees: EntreeLexique[] = [];
	const vus = new Set<string>();
	const couverture: {
		type: string;
		table: string;
		total: number;
		avec_ja: number;
		taux: number;
	}[] = [];

	for (const s of SOURCES_LEXIQUE) {
		const lignes = await sql.unsafe<
			{ id: string | number; ja: string; fr: string; romaji: string | null }[]
		>(
			`SELECT id, "${s.ja}" AS ja, "${s.fr}" AS fr, ${s.romaji ? `"${s.romaji}"` : "NULL"} AS romaji
			 FROM bot.${s.table} WHERE "${s.ja}" IS NOT NULL AND "${s.ja}" <> ''`
		);
		const total = Number(
			(await sql.unsafe<{ n: string }[]>(`SELECT count(*)::text AS n FROM bot.${s.table}`))[0]!.n
		);
		couverture.push({
			type: s.type,
			table: `bot.${s.table}`,
			total,
			avec_ja: lignes.length,
			taux: total ? Math.round((lignes.length / total) * 1000) / 10 : 0,
		});

		for (const l of lignes) {
			// Le libellé français porte parfois une désambiguïsation entre
			// parenthèses (« Piccolo (futur) ») : utile en base, parasite dès
			// qu'on réinjecte le terme dans une phrase.
			const fr = String(l.fr ?? "")
				.replace(/\s*\([^)]*\)\s*$/, "")
				.trim();
			for (const v of eclaterVariantes(String(l.ja))) {
				const cle = `${v.ja} ${s.type}`;
				if (vus.has(cle)) continue;
				vus.add(cle);
				entrees.push({
					ja: v.ja,
					fr,
					romaji: v.romaji ?? l.romaji ?? null,
					type: s.type,
					id: l.id,
				});
			}
		}
	}

	// Du plus long au plus court : à l'appariement, « サイヤ人 » doit être
	// reconnu avant que « サイヤ » ne morde dessus.
	entrees.sort((a, b) => b.ja.length - a.ja.length || a.ja.localeCompare(b.ja));
	return { entrees, couverture };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Graphies réellement observées dans le corpus des databooks.
//
// Le lexique dit ce qui EXISTE ; le corpus dit ce qui est ÉCRIT. Une graphie
// fréquente, stable d'un ouvrage à l'autre et absente du lexique n'est pas une
// faute : c'est du vocabulaire qui nous manque (les 825 techniques n'ont que
// 17 noms japonais en base). Une graphie rare et proche d'un terme connu, si.
// ─────────────────────────────────────────────────────────────────────────────

const KATAKANA_SUITE = /[゠-ヿー]{2,}/g;

/**
 * Le japonais ne sépare pas les mots par des espaces : une suite de katakana
 * brute peut couvrir une phrase entière (`ブイジャンプジャンプビクトリー`). La
 * compter telle quelle rendait l'indicateur inutilisable — 34 527 « graphies
 * hors lexique » sur 34 850, parce qu'une suite longue n'égale jamais une
 * entrée du lexique.
 *
 * On segmente donc sur ce qui EST une frontière de mot en katakana : le point
 * médian `・` (séparateur des noms étrangers, ミスター・ポポ) et le signe `＝`.
 * On borne à 16 signes — au-delà, c'est une agglutination, pas un mot — et on
 * garde aussi la suite entière quand elle tient dans cette borne.
 */
const LONGUEUR_MAX_GRAPHIE = 16;

interface GraphieCorpus {
	graphie: string;
	occurrences: number;
	ouvrages: number;
	sur_planches_saines: number;
}

function graphiesDuCorpus(
	planches: { fiche: number; texte: string | null; defaut: Defaut | null }[]
): GraphieCorpus[] {
	const compte = new Map<string, { n: number; saines: number; ouvrages: Set<number> }>();
	const noter = (g: string, p: { fiche: number; defaut: Defaut | null }) => {
		if (g.length < 2 || g.length > LONGUEUR_MAX_GRAPHIE) return;
		let e = compte.get(g);
		if (!e) compte.set(g, (e = { n: 0, saines: 0, ouvrages: new Set() }));
		e.n++;
		e.ouvrages.add(p.fiche);
		if (!p.defaut) e.saines++;
	};
	for (const p of planches) {
		if (!p.texte) continue;
		for (const m of p.texte.matchAll(KATAKANA_SUITE)) {
			const suite = m[0]!;
			const segments = suite.split(/[・＝=]/).filter(Boolean);
			for (const s of segments) noter(s, p);
			// La suite entière n'est comptée à part que si elle était réellement
			// composée (sinon on compterait deux fois le même mot).
			if (segments.length > 1) noter(suite, p);
		}
	}
	return [...compte.entries()]
		.map(([graphie, e]) => ({
			graphie,
			occurrences: e.n,
			ouvrages: e.ouvrages.size,
			sur_planches_saines: e.saines,
		}))
		.toSorted((a, b) => b.occurrences - a.occurrences);
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. API — de quoi interroger la source vivante plutôt que ce cliché.
// ─────────────────────────────────────────────────────────────────────────────

const API = process.env.SHENRON_API_URL ?? "https://bot.dragonballfr.com";
// Pas de constante MCP : `mcp.dragonballfr.com` a été retiré le 2026-09-25
// (shenron-mcp fusionné dans les outils `aphrody-mcp` dragonball.*, sans
// équivalent HTTP public — aphrody-infra config/nginx-routes.json et
// config/service-catalog.json). L'export ci-dessous échouait silencieusement
// contre cet hôte mort ; il n'écrit plus `mcp-outils.json`.

async function exporterApi(dossier: string) {
	const resultats: Record<string, string> = {};

	try {
		const spec = await fetch(`${API}/api/openapi.json`).then((r) => r.json());
		await writeFile(join(dossier, "openapi.json"), JSON.stringify(spec, null, 2));
		resultats.openapi = `${Object.keys((spec as { paths?: object }).paths ?? {}).length} routes`;
	} catch (e) {
		resultats.openapi = `échec : ${(e as Error).message}`;
	}

	try {
		const r = await fetch(`${API}/graphql`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ query: INTROSPECTION }),
		});
		const json = (await r.json()) as { data?: { __schema?: unknown } };
		await writeFile(join(dossier, "graphql-introspection.json"), JSON.stringify(json, null, 2));
		resultats.graphql = json.data?.__schema ? "schéma récupéré" : "réponse sans schéma";
	} catch (e) {
		resultats.graphql = `échec : ${(e as Error).message}`;
	}

	return resultats;
}

const INTROSPECTION = `query{__schema{queryType{name}types{kind name description fields{name description args{name type{kind name ofType{kind name ofType{kind name}}}}type{kind name ofType{kind name ofType{kind name}}}}enumValues{name}inputFields{name type{kind name ofType{kind name}}}}}}`;

// ─────────────────────────────────────────────────────────────────────────────
// 5. Règles de correction déjà automatisées — pour ne pas les refaire à la main.
// ─────────────────────────────────────────────────────────────────────────────

const REGLES_A_COPIER = [
	"src/lib/databooks-defauts.ts",
	"src/lib/databooks-ocr-corrections.ts",
	"src/lib/ja/normalisation.ts",
	"src/lib/ja/anomalies.ts",
	"src/lib/ja/coherence.ts",
	"src/lib/ja/appariement.ts",
	"src/lib/databooks-ocr/noms-propres.ts",
	"src/lib/databooks-ocr/sosies-intrusions.ts",
	"src/lib/databooks-ocr/artefacts-modele.ts",
	"src/lib/databooks-ocr/generations-deraillees.ts",
];

async function copierRegles(dossier: string): Promise<string[]> {
	const copiees: string[] = [];
	for (const rel of REGLES_A_COPIER) {
		const src = join(RACINE, rel);
		if (!existsSync(src)) continue;
		const dest = join(dossier, rel.split("/").pop()!);
		await cp(src, dest);
		copiees.push(rel);
	}
	return copiees;
}

// ─────────────────────────────────────────────────────────────────────────────

async function principal() {
	journal(`sortie : ${SORTIE}`);
	for (const d of ["donnees", "japonais", "transcriptions", "api", "regles"]) {
		await mkdir(join(SORTIE, d), { recursive: true });
	}

	journal("tables du wiki…");
	const inventaire = await exporterTables(join(SORTIE, "donnees"));

	journal("lexique japonais…");
	const { entrees, couverture } = await construireLexique();
	await writeFile(
		join(SORTIE, "japonais", "lexique.tsv"),
		"ja\tromaji\tfr\ttype\tid\n" +
			entrees.map((e) => [e.ja, e.romaji ?? "", e.fr, e.type, e.id].join("\t")).join("\n") +
			"\n",
		"utf8"
	);
	await ecrireJsonl(join(SORTIE, "japonais", "lexique.jsonl"), entrees);
	journal(`  ${entrees.length} graphies japonaises attestées`);

	journal("transcriptions des databooks…");
	const fiches = await sql<
		{ id: number; title: string; title_ja: string | null; pages: unknown }[]
	>`SELECT id, title, title_ja, pages FROM bot.db_databooks ORDER BY id`;

	type Planche = {
		fiche: number;
		ouvrage: string;
		ouvrage_ja: string | null;
		page: number;
		image: string | null;
		texte: string | null;
		defaut: Defaut | null;
		note: number;
		signes: number;
	};
	const planches: Planche[] = [];
	for (const f of fiches) {
		const pages = (f.pages ?? []) as { number?: number; image?: string; text?: string }[];
		for (const p of Array.isArray(pages) ? pages : []) {
			const texte = typeof p.text === "string" && p.text.trim() ? p.text : null;
			planches.push({
				fiche: f.id,
				ouvrage: f.title,
				ouvrage_ja: f.title_ja,
				page: Number(p.number ?? 0),
				image: p.image ?? null,
				texte,
				defaut: texte ? classerDefaut(texte) : "vide",
				note: texte ? noteQualite(texte) : 0,
				signes: texte ? texte.length : 0,
			});
		}
	}

	const parDefaut: Record<string, number> = {};
	for (const p of planches)
		parDefaut[p.defaut ?? "saine"] = (parDefaut[p.defaut ?? "saine"] ?? 0) + 1;

	if (!SANS_TRANSCRIPTIONS) {
		await ecrireJsonl(join(SORTIE, "transcriptions", "databooks-planches.jsonl"), planches);
		// La file de relecture, déjà triée : le plus grave d'abord.
		await ecrireJsonl(
			join(SORTIE, "transcriptions", "databooks-a-relire.jsonl"),
			planches.filter((p) => p.defaut).toSorted((a, b) => a.note - b.note)
		);
		const manga = await sql`
			SELECT id, series, tome, planche, lang, has_ja, line_count, char_count, text
			FROM bot.db_manga_pages ORDER BY series, tome, planche`;
		await ecrireJsonl(join(SORTIE, "transcriptions", "manga-planches.jsonl"), manga);
		journal(`  ${planches.length} planches de databooks, ${manga.length} planches de manga`);
	}

	journal("graphies observées dans le corpus…");
	const graphies = graphiesDuCorpus(planches);
	const connues = new Set(entrees.map((e) => e.ja));
	/**
	 * Comparer les graphies BRUTES ne marche pas : le lexique écrit
	 * 「ミスター·ポポ」 avec un point médian latin (U+00B7), le corpus
	 * 「ミスター・ポポ」 avec le point médian katakana (U+30FB). Sans
	 * normalisation, un personnage parfaitement connu ressortait en « faute de
	 * lecture probable » — la correction aurait cassé une graphie juste.
	 * `normaliserJa` retire les deux, comme partout ailleurs dans `lib/ja`.
	 */
	const connuesNorm = new Set([...connues].map(normaliserJa));

	/**
	 * Deux façons d'être ancré au lexique, et il faut les DEUX — le cas Galick
	 * le montre : 「ギャリック」 apparaît 65 fois dans 27 ouvrages sans être dans
	 * le lexique, parce que l'entrée est 「ギャリック砲」 et que le kanji 砲 coupe
	 * la suite de katakana. Ne tester que l'inclusion « la graphie contient un
	 * terme » le laisse passer pour inconnu, et c'est très exactement comme ça
	 * qu'il finit « corrigé » en 「ガーリック」 (Garlic, un personnage).
	 *
	 *   - `contient` : la graphie englobe un terme (スーパーサイヤ人ベジータ) ;
	 *   - `sous_chaine` : la graphie est un morceau d'un terme (ギャリック).
	 *
	 * On indexe une fois toutes les sous-chaînes des 1 671 entrées plutôt que de
	 * balayer le lexique pour chacune des 34 000 graphies.
	 */
	const sousChainesLexique = new Set<string>();
	for (const e of connuesNorm) {
		for (let i = 0; i < e.length; i++) {
			for (let j = i + 2; j <= Math.min(e.length, i + LONGUEUR_MAX_GRAPHIE); j++) {
				sousChainesLexique.add(e.slice(i, j));
			}
		}
	}
	const contientConnu = (g: string): boolean => {
		for (let i = 0; i < g.length; i++) {
			for (let j = i + 2; j <= g.length; j++) if (connuesNorm.has(g.slice(i, j))) return true;
		}
		return false;
	};

	// JMdict (218 000 entrées) sépare le vocabulaire japonais ordinaire du
	// vocabulaire de la série. Sans lui, カード (carte), ゲーム (jeu) et バトル
	// (combat) ressortent en tête des « termes manquants » — ce sont juste des
	// mots. Absent → la colonne vaut -1 et le filtre le dit.
	const jmdict = await graphiesJmdict();
	const avecJmdict = jmdict.size > 0;
	if (!avecJmdict) {
		journal("  ⚠ JMdict absent (.ja-data) : impossible de distinguer un mot japonais courant");
	}

	const enrichies = graphies.map((g) => {
		const norme = normaliserJa(g.graphie);
		return Object.assign(g, {
	dans_lexique: connuesNorm.has(norme) ? 1 : 0,
	contient_terme_lexique: contientConnu(norme) ? 1 : 0,
	sous_chaine_lexique: sousChainesLexique.has(norme) ? 1 : 0,
	dans_jmdict: avecJmdict ? jmdict.has(g.graphie) || jmdict.has(norme) ? 1 : 0 : -1
});
	});
	const ancree = (g: (typeof enrichies)[number]) =>
		g.dans_lexique || g.contient_terme_lexique || g.sous_chaine_lexique;

	await writeFile(
		join(SORTIE, "japonais", "graphies-corpus.tsv"),
		"graphie\toccurrences\touvrages\tsur_planches_saines\tdans_lexique\tcontient_terme_lexique\tsous_chaine_lexique\tdans_jmdict\n" +
			enrichies
				.map((g) =>
					[
						g.graphie,
						g.occurrences,
						g.ouvrages,
						g.sur_planches_saines,
						g.dans_lexique,
						g.contient_terme_lexique,
						g.sous_chaine_lexique,
						g.dans_jmdict,
					].join("\t")
				)
				.join("\n") +
			"\n",
		"utf8"
	);

	/**
	 * Une graphie inconnue peut être deux choses opposées, et la fréquence seule
	 * ne les sépare pas : 「バードスタジオ」 (Bird Studio, 147 ouvrages) est du
	 * vocabulaire qui manque à la base ; 「パトル」 (444 fois) est 「バトル」 mal
	 * lu — un dakuten perdu, répété des centaines de fois par le même modèle.
	 *
	 * Ce qui les sépare est la proximité à une forme ATTESTÉE. On cherche donc,
	 * pour chaque inconnue, le voisin le plus proche parmi le lexique du domaine
	 * ET les graphies bien attestées du corpus (vues 20 fois et reconnues par
	 * JMdict ou par le lexique). On indexe par longueur : la distance bornée
	 * exclut d'emblée tout ce qui diffère de plus de `max` signes.
	 */
	const frequence = new Map(enrichies.map((g) => [g.graphie, g.occurrences] as const));
	const references: { graphie: string; source: "lexique" | "corpus" }[] = [
		...[...connues].map((g) => ({ graphie: g, source: "lexique" as const })),
		// (les graphies du lexique restent sous leur forme d'origine : c'est elle
		// qu'on veut voir affichée dans `proche_de`, la normalisation ne sert qu'à
		// la comparaison, faite dans `voisinAtteste`)
		...enrichies
			.filter((g) => g.occurrences >= 20 && (g.dans_jmdict === 1 || ancree(g)))
			.map((g) => ({ graphie: g.graphie, source: "corpus" as const })),
	];
	const parLongueur = new Map<number, typeof references>();
	for (const r of references) {
		const n = normaliserJa(r.graphie);
		if (n.length < 3) continue;
		const seau = parLongueur.get(n.length);
		if (seau) seau.push(r);
		else parLongueur.set(n.length, [r]);
	}
	interface Voisin {
		attendu: string;
		distance: number;
		source: "lexique" | "corpus";
		occurrences: number | null;
	}
	function voisinAtteste(mot: string): Voisin | null {
		const norme = normaliserJa(mot);
		if (norme.length < 3) return null;
		const max = norme.length <= 4 ? 1 : 2;
		let meilleur: Voisin | null = null;
		for (let l = norme.length - max; l <= norme.length + max; l++) {
			for (const r of parLongueur.get(l) ?? []) {
				const d = distanceBornee(norme, normaliserJa(r.graphie), max);
				if (d === 0 || d > max) continue;
				const occ = frequence.get(r.graphie) ?? null;
				// À distance égale, le voisin le mieux attesté l'emporte : c'est la
				// seule chose qui rende la suggestion vérifiable.
				if (
					!meilleur ||
					d < meilleur.distance ||
					(d === meilleur.distance && (occ ?? 0) > (meilleur.occurrences ?? 0))
				) {
					meilleur = { attendu: r.graphie, distance: d, source: r.source, occurrences: occ };
				}
			}
		}
		return meilleur;
	}

	/**
	 * Un voisin proche ne prouve rien à lui seul, et s'en contenter produit des
	 * corrections fausses : 「アビリティ」 (798 fois, mot japonais courant) est à
	 * distance 2 de 「レアリティ」 (178 fois), 「チョコボ」 de 「チョコ」,
	 * 「ナルト」 de 「ボルト」. Aucun n'est une faute — ce sont des mots, et ils
	 * sont PLUS fréquents que leur prétendu modèle.
	 *
	 * Ce qui distingue une vraie faute de lecture est le rapport de fréquence :
	 * 「パトル」 (444 fois) contre 「バトル」 (1 884 fois) — le modèle a perdu un
	 * dakuten sur une forme quatre fois mieux attestée. En dessous de 2×, on ne
	 * conclut pas : on renvoie l'arbitrage à la planche.
	 */
	const RAPPORT_MIN = 2;
	function hypotheseDe(g: { occurrences: number; ouvrages: number }, v: Voisin | null): string {
		if (!v) {
			return g.occurrences >= 8 && g.ouvrages >= 2
				? "vocabulaire manquant probable"
				: "à vérifier sur l'image";
		}
		if (v.occurrences !== null && v.occurrences >= RAPPORT_MIN * g.occurrences) {
			return "faute de lecture probable";
		}
		// Un nom canonique du wiki à un signe près, sur une graphie rare : c'est
		// le cas nominal de `lib/ja/anomalies.ts`.
		if (v.source === "lexique" && g.occurrences < 8) return "faute de lecture probable";
		return "voisin attesté mais moins fréquent — à trancher sur l'image";
	}

	const ancrees = enrichies.filter(ancree).length;
	const inconnues = enrichies.filter((g) => !ancree(g) && g.dans_jmdict !== 1);

	// Fichier dédié : la liste de travail réelle, pas le corpus entier.
	const aTrancher = inconnues
		.filter((g) => g.occurrences >= 3)
		.map((g) => {
			const v = voisinAtteste(g.graphie);
			return {
				graphie: g.graphie,
				occurrences: g.occurrences,
				ouvrages: g.ouvrages,
				sur_planches_saines: g.sur_planches_saines,
				proche_de: v?.attendu ?? null,
				distance: v?.distance ?? null,
				proche_source: v?.source ?? null,
				occurrences_proche: v?.occurrences ?? null,
				// Une hypothèse, avec les chiffres qui la fondent à côté : c'est à
				// la relecture de trancher, pas au script.
				hypothese: hypotheseDe(g, v),
			};
		})
		.toSorted((a, b) => b.occurrences - a.occurrences);
	await ecrireJsonl(join(SORTIE, "japonais", "graphies-a-trancher.jsonl"), aTrancher);
	const fautesProbables = aTrancher.filter(
		(g) => g.hypothese === "faute de lecture probable"
	).length;
	const aArbitrer = aTrancher.filter((g) => g.hypothese.startsWith("voisin attesté")).length;
	journal(
		`  ${aTrancher.length} graphies inconnues vues ≥3 fois · ${fautesProbables} fautes probables · ` +
			`${aArbitrer} à arbitrer sur l'image`
	);
	// Vue souvent, dans plusieurs ouvrages, rattachable ni au lexique ni à un
	// dictionnaire général : c'est du vocabulaire qui nous manque, pas une faute.
	const vocabulaireManquant = inconnues.filter((g) => g.occurrences >= 8 && g.ouvrages >= 2).length;
	// L'autre extrême : jamais vue sur une seule planche jugée saine.
	const suspectes = inconnues.filter((g) => g.sur_planches_saines === 0).length;
	journal(
		`  ${enrichies.length} graphies distinctes · ${ancrees} ancrées au lexique · ` +
			`${vocabulaireManquant} vocabulaire manquant probable · ${suspectes} jamais vues sur une planche saine`
	);

	journal("règles de correction déjà automatisées…");
	const regles = await copierRegles(join(SORTIE, "regles"));

	let api: Record<string, string> = { ignore: "--sans-api" };
	if (!SANS_API) {
		journal("API publiques…");
		api = await exporterApi(join(SORTIE, "api"));
		for (const [k, v] of Object.entries(api)) journal(`  ${k} : ${v}`);
	}

	const manifeste = {
		genere_le: new Date().toISOString(),
		source: "PostgreSQL local du VPS, base shenron_site, schéma bot (source de vérité du wiki)",
		donnees: inventaire,
		lexique: {
			graphies: entrees.length,
			couverture_name_ja: couverture,
			lacune_connue:
				"825 techniques pour 17 noms japonais renseignés : かめはめ波 et 界王拳 ne sont PAS dans le lexique. Une graphie de technique absente du lexique n'est donc pas une faute.",
		},
		transcriptions: {
			planches: planches.length,
			par_defaut: parDefaut,
			juge: "src/lib/databooks-defauts.ts — classerDefaut / noteQualite",
		},
		graphies_corpus: {
			distinctes: enrichies.length,
			ancrees_au_lexique: ancrees,
			hors_lexique: inconnues.length,
			vocabulaire_manquant_probable: vocabulaireManquant,
			jamais_sur_planche_saine: suspectes,
			jmdict: avecJmdict ? `${jmdict.size} graphies` : "absent (colonne dans_jmdict = -1)",
			a_trancher: aTrancher.length,
			avec_voisin_atteste: fautesProbables,
			a_arbitrer_sur_image: aArbitrer,
			lecture:
				"Fréquente + plusieurs ouvrages + hors lexique = vocabulaire manquant, PAS une faute. Rare + jamais sur une planche saine = hallucination probable.",
		},
		regles_copiees: regles,
		api,
	};
	await writeFile(join(SORTIE, "manifeste.json"), JSON.stringify(manifeste, null, 2), "utf8");
	await writeFile(join(SORTIE, "LISEZMOI.md"), lisezmoi(manifeste), "utf8");

	journal("terminé.");
	await sql.end();
}

function lisezmoi(m: {
	genere_le: string;
	donnees: Record<string, { lignes: number }>;
	lexique: {
		graphies: number;
		couverture_name_ja: { type: string; total: number; avec_ja: number; taux: number }[];
	};
	transcriptions: { planches: number; par_defaut: Record<string, number> };
	graphies_corpus: {
		distinctes: number;
		ancrees_au_lexique: number;
		hors_lexique: number;
		vocabulaire_manquant_probable: number;
		jamais_sur_planche_saine: number;
		a_trancher: number;
		avec_voisin_atteste: number;
		a_arbitrer_sur_image: number;
	};
	regles_copiees: string[];
}): string {
	const cov = m.lexique.couverture_name_ja
		.toSorted((a, b) => a.taux - b.taux)
		.map((c) => `| ${c.type} | ${c.avec_ja} / ${c.total} | ${c.taux} % |`)
		.join("\n");
	const def = Object.entries(m.transcriptions.par_defaut)
		.toSorted((a, b) => b[1] - a[1])
		.map(([k, v]) => `| ${k} | ${v} |`)
		.join("\n");
	const tables = Object.entries(m.donnees)
		.toSorted((a, b) => b[1].lignes - a[1].lignes)
		.map(([k, v]) => `| \`donnees/${k}.jsonl\` | ${v.lignes} |`)
		.join("\n");

	return `# Base de connaissance Dragon Ball — relecture des transcriptions

Généré le ${m.genere_le} depuis le PostgreSQL de dragonballfr.com (schéma \`bot\`,
source de vérité du wiki). Tout est en JSONL (une ligne = un enregistrement) ou
en TSV, lisible sans dépendance.

## À quoi ça sert

Les 11 778 planches de databooks portent une transcription produite par un
modèle de vision. Environ une sur cinq est fautive — pas « mal lue » :
**hallucinée** (cyrillique au milieu du japonais, boucles jusqu'à la limite de
sortie, faux chinois). Pour corriger, il faut savoir ce qui existe dans
l'univers. C'est ce que contient cet export.

## Par où commencer

1. \`japonais/lexique.tsv\` — ${m.lexique.graphies} graphies japonaises attestées,
   avec leur romaji, leur nom français, leur type et l'identifiant de la fiche.
   C'est l'ancre : si une graphie y figure, elle est correcte.
2. \`japonais/graphies-corpus.tsv\` — ${m.graphies_corpus.distinctes} mots
   katakana réellement écrits dans le corpus, avec leur fréquence, le nombre
   d'ouvrages distincts où ils apparaissent, s'ils sont dans le lexique et s'ils
   en contiennent un terme. ${m.graphies_corpus.ancrees_au_lexique} sont ancrés au
   lexique, ${m.graphies_corpus.vocabulaire_manquant_probable} ressemblent à du
   vocabulaire qui manque à la base (fréquents, présents dans plusieurs
   ouvrages, rattachables à rien) et ${m.graphies_corpus.jamais_sur_planche_saine}
   n'apparaissent jamais sur une planche saine — c'est là que sont les
   hallucinations.
3. \`japonais/graphies-a-trancher.jsonl\` — ${m.graphies_corpus.a_trancher} mots
   inconnus vus au moins trois fois, chacun avec son voisin attesté le plus
   proche quand il en a un. ${m.graphies_corpus.avec_voisin_atteste} sont des
   fautes de lecture probables, ${m.graphies_corpus.a_arbitrer_sur_image} ont un
   voisin trop peu attesté pour conclure. C'est la liste qui sépare la faute du
   vocabulaire.
4. \`transcriptions/databooks-a-relire.jsonl\` — la file de travail, triée du
   plus grave au moins grave.

### Lire \`graphies-a-trancher.jsonl\`

Deux choses opposées s'y ressemblent, et la fréquence seule ne les sépare pas :

- 「バードスタジオ」 — Bird Studio, vu dans 147 ouvrages, voisin d'aucune forme
  connue : **du vocabulaire qui manque à la base**. Ne pas corriger.
- 「パトル」 — vu 444 fois, à un dakuten de 「バトル」 (attesté 1 884 fois) :
  **une faute de lecture systématique du modèle**. À corriger.

Ce qui les sépare n'est pas la ressemblance — 「アビリティ」 (798 fois, mot
japonais courant) ressemble à 「レアリティ」 (178 fois), 「チョコボ」 à
「チョコ」, 「ナルト」 à 「ボルト」, et aucun n'est une faute. C'est le **rapport
de fréquence** : une faute de lecture est toujours moins attestée que la forme
dont elle dérive. \`occurrences\` et \`occurrences_proche\` sont là pour ça, et
en dessous d'un facteur 2 le champ \`hypothese\` refuse de conclure.

Ce sont des hypothèses. La planche fait foi.

## Le piège à ne pas tomber dedans

**Le lexique est incomplet, et il l'est très inégalement.**

| type | \`name_ja\` renseignés | couverture |
|---|---|---|
${cov}

Les techniques sont le trou béant : 17 noms japonais sur 825 fiches. Ni
かめはめ波, ni 界王拳, ni ギャリック砲 ne sont dans le lexique. Une graphie
absente du lexique **n'est donc pas une faute** — c'est souvent du vocabulaire
qui manque à la base.

C'est exactement le mécanisme qui produit les mauvaises corrections :
「ギャリック」 (de ギャリック砲, le Galick Gun) se fait « corriger » en
「ガーリック」 (Garlic, un personnage), parce que le personnage est dans le
lexique et pas la technique. Le croisement à faire avant toute correction :
une graphie **fréquente et vue dans plusieurs ouvrages** est du vocabulaire,
pas une faute — même si le lexique l'ignore. C'est ce que donnent les colonnes
\`occurrences\` et \`ouvrages\` de \`graphies-corpus.tsv\`.

## Verdicts des planches

Le juge unique est \`regles/databooks-defauts.ts\` (\`classerDefaut\`,
\`noteQualite\`). Il ne corrige rien : il constate des signatures mécaniques
d'échec du modèle.

| défaut | planches |
|---|---|
${def}

## Ce qui est DÉJÀ automatisé

Ne pas refaire à la main ce que ces modules purs font déjà :

${m.regles_copiees.map((r) => `- \`regles/${r.split("/").pop()}\` (\`${r}\`)`).join("\n")}

## Données

| fichier | lignes |
|---|---|
${tables}

Toutes les colonnes de la base sont conservées telles quelles, sauf les lecteurs
vidéo, en-têtes de flux, sous-titres et images d'épisodes (lourds, sans rapport
avec une relecture de texte).

## API vivante

Ce dossier est un cliché. Pour interroger l'état courant :

- REST : \`api/openapi.json\` — base \`https://bot.dragonballfr.com\`
- GraphQL : \`api/graphql-introspection.json\` — \`https://bot.dragonballfr.com/graphql\` (GraphiQL activé)
- RAG : \`POST /api/public/rag/search\` — recherche hybride BM25 + embeddings + reranking sur ~40 874 passages
- MCP : \`mcp.dragonballfr.com\` a été retiré le 2026-09-25 (fusionné dans les outils \`aphrody-mcp\` dragonball.*, sans équivalent HTTP public)

## Rappel de méthode

Sur un scan basse définition, on transcrit les titres lisibles et **on
s'arrête**. Une transcription plausible mais inventée est pire que l'absence de
texte : elle est indétectable en aval, alors qu'un trou se voit.
`;
}

await principal();
