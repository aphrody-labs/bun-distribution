#!/usr/bin/env bun
/**
 * Amorce les **variantes de personnage par saga** (`bot.db_character_variants`)
 * — « Goku, saga Namek », « Vegeta, saga Cyborgs » — à partir de ce que la base
 * sait vraiment, et de rien d'autre.
 *
 * ── Pourquoi une mesure et pas une liste écrite à la main ────────────────────
 * La base ne savait pas qui apparaît dans quelle saga : `debut_saga_id` est
 * renseigné pour 1 personnage sur 1 323, `db_character_arcs` compte 4 lignes,
 * 36 épisodes sur 826 portent un arc. Écrire « Goku apparaît dans la saga
 * Namek » à la main, c'est recopier ce qu'on croit savoir — et c'est ainsi
 * qu'on finit par affirmer que Yamcha combat sur Namek.
 *
 * Le seul fait vérifiable dont on dispose est l'OCR VF du manga :
 * `bot.db_manga_pages` porte 8 222 planches pour les 42 tomes de Dragon Ball.
 * Croisé aux bornes de tomes de chaque saga (`db_sagas.manga_volume_*`, posées
 * par `--bornes`), il donne une présence MESURÉE, avec sa preuve : les tomes,
 * le nombre de planches, les graphies recherchées.
 *
 * ── Ce que le script ne fait PAS ─────────────────────────────────────────────
 * Il ne remplit ni la puissance, ni la forme atteinte, ni le récit de la saga :
 * l'OCR d'une bulle ne dit pas si Goku est Super Saiyan à ce moment-là. Ces
 * champs restent vides et se remplissent depuis le back-office. Une variante
 * amorcée est marquée `origin = 'ocr-manga'` ; une variante retouchée à la main
 * passe à `'editorial'` et n'est plus jamais écrasée par une nouvelle mesure.
 *
 ── Deux sources, jamais confondues ─────────────────────────────────────────
 * 1. **OCR du manga** (`bot.db_manga_pages`, série DB, 42 tomes) : la source de
 *    référence, c'est le texte de l'œuvre. Les planches `series='DBS'` sont
 *    indexées par identifiant interne de chapitre (`ch1315`…), pas par numéro
 *    publié : aucun rattachement fiable aux sagas Moro/Granolah/Black Freezer.
 * 2. **Synopsis des épisodes** (`bot.db_episodes.synopsis`) : la seule source
 *    des 18 sagas sans manga (GT, Daima, DBS anime). 636 résumés en français
 *    qui nomment les personnages en clair.
 *
 * `evidence.methode` garde laquelle a parlé. Une présence attestée par l'anime
 * SEUL peut être du remplissage absent du manga — le distinguer n'est pas un
 * détail de traçabilité, c'est la différence entre canon et adaptation.
 *
 * Usage :
 *   bun scripts/variantes-par-saga.ts --bornes [--appliquer]   # bornes de tomes des sagas
 *   bun scripts/variantes-par-saga.ts --mesure                 # simulation (n'écrit rien)
 *   bun scripts/variantes-par-saga.ts --mesure --personnage Goku
 *   bun scripts/variantes-par-saga.ts --mesure --appliquer     # écrit les variantes
 *   bun scripts/variantes-par-saga.ts --mesure --reinitialiser --appliquer  # remesure à neuf
 *   bun scripts/variantes-par-saga.ts --etat                   # ce qu'il y a en base
 */
import { join } from "node:path";
import postgres from "postgres";

const args = process.argv.slice(2);
const opt = (nom: string, defaut?: string) => {
	const i = args.indexOf(`--${nom}`);
	return i !== -1 && args[i + 1] ? args[i + 1]! : defaut;
};
const flag = (nom: string) => args.includes(`--${nom}`);

const APPLIQUER = flag("appliquer");

/** URL de la base, lue dans `apps/shenron/site/.env` (ancrage `^DATABASE_URL=` : le
 *  fichier porte une ligne Neon COMMENTÉE avant la ligne active). */
async function urlBase(): Promise<string> {
	const direct = process.env.DATABASE_URL?.trim();
	if (direct) return direct;
	const texte = await Bun.file(join(import.meta.dir, "..", ".env"))
		.text()
		.catch(() => "");
	const ligne = texte.split("\n").find((l) => l.startsWith("DATABASE_URL="));
	const valeur = ligne
		?.slice("DATABASE_URL=".length)
		.trim()
		.replace(/^["']|["']$/g, "");
	if (!valeur) {
		console.error("✗ DATABASE_URL introuvable (environnement ou apps/shenron/site/.env).");
		process.exit(1);
	}
	return valeur;
}

// ── Bornes des sagas dans le manga 42 tomes ─────────────────────────────────
// Découpage éditorial de la publication française (Glénat), volontairement posé
// en TOMES et non en chapitres : les frontières de chapitre varient d'une source
// à l'autre, celles de tome ne bougent pas. Les chevauchements aux charnières
// (un tome qui clôt une saga et en ouvre une autre) sont assumés : un tome
// charnière compte pour les deux sagas, ce qui est exact.
//
// Ces bornes vivent en BASE une fois posées (`db_sagas.manga_volume_*`) : les
// corriger se fait dans le back-office, sans toucher à ce fichier.
const BORNES_MANGA: Record<string, [number, number]> = {
	pilaf: [1, 2],
	"tournament-21": [2, 4],
	"red-ribbon": [5, 8],
	"uranai-baba": [8, 9],
	"tournament-22b": [9, 11],
	"piccolo-daimao": [11, 13],
	"tournament-23": [13, 16],
	saiyan: [17, 20],
	namek: [20, 24],
	saga_freezer: [24, 28],
	retour_sur_terre: [28, 29],
	androids: [29, 33],
	cell: [33, 36],
	"great-saiyaman": [36, 38],
	buu: [38, 42],
};

// ── Bornes des sagas dans les séries animées ────────────────────────────────
// [série, premier épisode, dernier épisode]. La numérotation repart à 1 dans
// chaque série, d'où la série explicite. Découpage de diffusion Toei, celui que
// suivent les jaquettes des coffrets et les guides officiels.
//
// Absents volontaires : `saga_bardock` et `oav2008` (des OAV, pas des épisodes
// numérotés), `broly` et `super-hero` (des films), et les sagas manga-only de
// Super (`moro`, `granolah`, `black-frieza`, `galactic-patrol`) — leur adapter
// des bornes d'épisodes reviendrait à inventer une diffusion qui n'existe pas.
const BORNES_EPISODES: Record<string, [string, number, number]> = {
	pilaf: ["DB", 1, 13],
	"tournament-21": ["DB", 14, 28],
	"red-ribbon": ["DB", 29, 68],
	"uranai-baba": ["DB", 69, 83],
	"tournament-22b": ["DB", 84, 101],
	"piccolo-daimao": ["DB", 102, 122],
	"tournament-23": ["DB", 123, 153],
	saiyan: ["DBZ", 1, 35],
	namek: ["DBZ", 36, 74],
	saga_freezer: ["DBZ", 75, 107],
	retour_sur_terre: ["DBZ", 108, 117],
	androids: ["DBZ", 118, 152],
	cell: ["DBZ", 153, 194],
	"great-saiyaman": ["DBZ", 195, 219],
	buu: ["DBZ", 220, 291],
	"gt-black-star": ["DBGT", 1, 16],
	"gt-baby": ["DBGT", 17, 40],
	"gt-super-17": ["DBGT", 41, 47],
	"gt-shadow-dragons": ["DBGT", 48, 64],
	god: ["DBS", 1, 14],
	"golden-frieza": ["DBS", 15, 27],
	champa: ["DBS", 28, 46],
	"future-trunks": ["DBS", 47, 76],
	"tournament-of-power": ["DBS", 77, 131],
	daima: ["DB_DAIMA", 1, 20],
};

// ── Graphies : comment un personnage s'écrit dans l'OCR VF ──────────────────
// L'OCR rend des bulles en capitales, souvent sans accent et parfois abîmées.
// On cherche donc des formes normalisées (minuscules, sans accent), en mot
// entier. Les alias ne sont là que pour les noms dont la VF s'écarte du nom de
// la fiche — pas pour « améliorer » le rappel au jugé.
const ALIAS: Record<string, string[]> = {
	Goku: ["goku", "kakarot", "sangoku"],
	Vegeta: ["vegeta"],
	"Son Gohan": ["gohan"],
	Gohan: ["gohan"],
	Krilin: ["krilin", "kuririn"],
	Piccolo: ["piccolo", "petit coeur"],
	Boo: ["boo", "buu"],
	"Majin Boo": ["boo", "buu"],
	Tenshinhan: ["tenshinhan", "ten shin han"],
	Chaozu: ["chaozu", "chao zu"],
	"Tortue Géniale": ["tortue geniale", "kame sennin", "muten"],
	Freezer: ["freezer", "freeza"],
	Cell: ["cell"],
	Trunks: ["trunks"],
	Bulma: ["bulma"],
	Yamcha: ["yamcha"],
	Chichi: ["chichi", "chi chi"],
	Bardock: ["bardock", "baddack"],
	"Son Goten": ["goten"],
	Goten: ["goten"],
	Videl: ["videl"],
	Dendé: ["dende"],
	Kaïo: ["kaio"],
	"Kaïo du Nord": ["kaio"],
	"Mr Satan": ["satan", "hercule"],
	Babidi: ["babidi"],
	Dabra: ["dabra", "dabura"],
	Cooler: ["cooler"],
	Nappa: ["nappa"],
	Raditz: ["raditz"],
	Ginyu: ["ginyu", "ginyou"],
	Zabon: ["zabon"],
	Dodoria: ["dodoria"],
	Gotenks: ["gotenks"],
	Vegetto: ["vegetto", "vegeto"],
	Gogeta: ["gogeta"],
	Pilaf: ["pilaf"],
	Oolong: ["oolong", "plume"],
	Lunch: ["lunch"],
	Karin: ["karin"],
	"Dieu (Kami)": ["kami", "tout puissant"],
	Popo: ["popo"],
	Uub: ["uub", "oob"],
	Broly: ["broly"],
	Garlic: ["garlic"],
	"Garlic Jr.": ["garlic"],
};

/**
 * Graphies qu'on refuse de mesurer, avec la raison — chacune vient d'un faux
 * positif relevé sur la première passe, pas d'une précaution de principe.
 *
 * 1. MOTS_DU_RECIT — le nom de la fiche est d'abord un mot français courant.
 *    « Tard » (fiche 1189) remontait dans 10 sagas sur 15 : le compteur voyait
 *    « trois jours plus tard », « un jour de retard ». Aucun seuil ne sauve une
 *    mesure pareille — sur un texte français, ces noms ne sont PAS mesurables.
 *    Les personnages concernés se renseignent à la main, depuis le back-office.
 *
 * 2. HORS_DRAGON_BALL — autres œuvres d'Akira Toriyama, citées dans l'appareil
 *    éditorial du tome et non dans le récit. « Slump » remontait dans 8 sagas :
 *    les occurrences sont des notes de traduction (« référence au village
 *    d'Aralé dans Docteur Slump ») et la bio de l'auteur en fin de volume.
 */
const MOTS_DU_RECIT = new Set([
	"tard",
	"dieu",
	"note",
	"forte",
	"boing",
	"plume",
	"tortue",
	"singe",
	"roi",
	"reine",
	"ange",
	"diable",
	"mort",
	"vie",
	"force",
	"terre",
	"lune",
	"ciel",
	"sang",
	"coeur",
	"chef",
	"maitre",
	"monde",
	"univers",
	"espace",
	"mer",
	"vent",
	"feu",
	"glace",
	"tonnerre",
	"eclair",
	"pierre",
	"nuit",
	"jour",
	"temps",
	"guerre",
	"paix",
	"peur",
	"joie",
	"amour",
	"haine",
	"reve",
	"esprit",
	"corps",
	"tete",
	"main",
	"bras",
	"oeil",
	"epee",
	"sabre",
	"poing",
	"boule",
	"boules",
	"dragon",
	"robot",
	"monstre",
	"docteur",
	"general",
	"colonel",
	"sergent",
	"capitaine",
	"commandant",
	"soldat",
	"homme",
	"femme",
	"enfant",
	"grand",
	"petit",
	"jeune",
	"vieux",
	"nord",
	"ouest",
]);

const HORS_DRAGON_BALL = new Set([
	"slump",
	"arale",
	"kajika",
	"ackman",
	"cowa",
	"sandland",
	"wolf",
	"toriyama",
]);

function normalise(s: string): string {
	return s
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9 ]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Graphies à chercher pour un personnage.
 *
 * Trois refus délibérés, chacun venant d'un faux positif observé :
 *  - les noms de moins de 4 signes (« Boo » excepté par alias) : « ex », « oob »
 *    et consorts touchent une planche sur dix sans rien vouloir dire ;
 *  - les fiches à parenthèse (« Cell (présent) », « Chaozu (futur) ») : leur
 *    nom racine est déjà porté par la fiche principale, les compter deux fois
 *    ferait deux variantes concurrentes pour la même présence ;
 *  - les noms génériques d'une seule syllabe commune (« Roi », « Dieu »).
 */
function graphies(nom: string): string[] {
	const alias = ALIAS[nom];
	if (alias) return alias.length ? alias : [];
	if (/[()]/.test(nom)) return [];
	const base = normalise(nom.replace(/^son /i, ""));
	if (base.length < 4) return [];
	if (base.split(" ").length > 3) return [];
	if (MOTS_DU_RECIT.has(base) || HORS_DRAGON_BALL.has(base)) return [];
	return [base];
}

interface Saga {
	id: number;
	slug: string;
	name: string;
	orderIdx: number | null;
	/** Bornes de tomes du manga (null si la saga n'en a pas). */
	tomeDebut: number | null;
	tomeFin: number | null;
	/** Bornes d'épisodes, avec leur série (la numérotation repart à 1). */
	epSerie: string | null;
	epDebut: number | null;
	epFin: number | null;
}

const sql = postgres(await urlBase(), { max: 2, prepare: false });

try {
	// ── --bornes : pose les plages de tomes sur db_sagas ────────────────────
	if (flag("bornes")) {
		const sagas = await sql<{ id: number; slug: string; name: string }[]>`
			select id, slug, name from bot.db_sagas order by id`;
		let posees = 0;
		let posesEpisodes = 0;
		for (const s of sagas) {
			const b = BORNES_MANGA[s.slug];
			const e = BORNES_EPISODES[s.slug];
			if (!b && !e) continue;
			if (b) posees++;
			if (e) posesEpisodes++;
			if (APPLIQUER) {
				if (b) {
					await sql`update bot.db_sagas
						set manga_volume_start = ${b[0]}, manga_volume_end = ${b[1]}
						where id = ${s.id}`;
				}
				if (e) {
					await sql`update bot.db_sagas
						set episode_series = ${e[0]}, episode_start = ${e[1]}, episode_end = ${e[2]}
						where id = ${s.id}`;
				}
			}
			const detail = [b ? `tomes ${b[0]}–${b[1]}` : null, e ? `${e[0]} ${e[1]}–${e[2]}` : null]
				.filter(Boolean)
				.join(" · ");
			console.log(`${APPLIQUER ? "✓" : "·"} ${s.name.padEnd(36)} ${detail}`);
		}
		const sansRien = sagas.filter((s) => !BORNES_MANGA[s.slug] && !BORNES_EPISODES[s.slug]);
		console.log(
			`\n${posees} saga(s) bornée(s) sur le manga, ${posesEpisodes} sur les épisodes, ` +
				`${sansRien.length} sans aucune source mesurable :\n  ${sansRien.map((s) => s.name).join(", ")}`
		);
		if (!APPLIQUER) console.log("Simulation — relancer avec --appliquer pour écrire.");
		process.exit(0);
	}

	// ── --etat : ce qu'il y a déjà en base ──────────────────────────────────
	if (flag("etat")) {
		const lignes = await sql<
			{ personnage: string; variantes: number; sagas: string; origines: string }[]
		>`
			select c.name as personnage,
			       count(*)::int as variantes,
			       string_agg(s.name, ', ' order by s.order_idx) as sagas,
			       string_agg(distinct v.origin, '/') as origines
			from bot.db_character_variants v
			join bot.db_characters c on c.id = v.character_id
			join bot.db_sagas s on s.id = v.saga_id
			group by c.name order by count(*) desc, c.name limit 40`;
		if (!lignes.length) {
			console.log("Aucune variante en base. Lancer --mesure --appliquer.");
		} else {
			for (const l of lignes) {
				console.log(
					`${l.personnage.padEnd(24)} ${String(l.variantes).padStart(2)}  [${l.origines}]  ${l.sagas}`
				);
			}
			const [t] = await sql<
				{ n: number }[]
			>`select count(*)::int as n from bot.db_character_variants`;
			console.log(`\n${t?.n ?? 0} variante(s) au total.`);
		}
		process.exit(0);
	}

	if (!flag("mesure")) {
		console.log("Rien à faire. Voir --bornes, --mesure, --etat (et --appliquer).");
		process.exit(0);
	}

	// ── --mesure : présence par saga, mesurée sur les sources disponibles ───
	const sagas = (
		await sql<
			{
				id: number;
				slug: string;
				name: string;
				order_idx: number | null;
				manga_volume_start: number | null;
				manga_volume_end: number | null;
				episode_series: string | null;
				episode_start: number | null;
				episode_end: number | null;
			}[]
		>`select id, slug, name, order_idx, manga_volume_start, manga_volume_end,
		         episode_series, episode_start, episode_end
		  from bot.db_sagas
		  where (manga_volume_start is not null and manga_volume_end is not null)
		     or (episode_start is not null and episode_end is not null)
		  order by order_idx nulls last, id`
	).map((s): Saga => {
		// `Number(...)` obligatoire : postgres-js rend les `bigint` en CHAÎNES.
		// Sans conversion, `"9" <= "11"` est comparé lexicographiquement et vaut
		// faux — la saga du 22e Tenkaichi Budôkai (tomes 9 à 11) ne mesurait rien,
		// et `"163" <= "35"` valant vrai, la saga Saiyan récupérait des épisodes
		// de la saga Boo. Bug vu sur « Vegeta, saga Saiyan » à qui la mesure
		// attribuait l'épisode 268.
		const nb = (v: number | null): number | null => (v == null ? null : Number(v));
		return {
			id: Number(s.id),
			slug: s.slug,
			name: s.name,
			orderIdx: nb(s.order_idx),
			tomeDebut: nb(s.manga_volume_start),
			tomeFin: nb(s.manga_volume_end),
			epSerie: s.episode_series,
			epDebut: nb(s.episode_start),
			epFin: nb(s.episode_end),
		};
	});
	if (!sagas.length) {
		console.error("✗ Aucune saga bornée. Lancer d'abord : --bornes --appliquer");
		process.exit(1);
	}

	// Les deux corpus tiennent en mémoire (≈ 2,3 Mo de texte au total) et sont
	// tokenisés UNE fois : chercher 400 noms par expression régulière sur
	// 8 000 textes prendrait des minutes, un test d'appartenance à un ensemble
	// prend quelques secondes.
	interface Texte {
		/** Tome du manga, ou numéro d'épisode selon le corpus. */
		num: number;
		/** Série de l'épisode (corpus anime uniquement). */
		serie?: string;
		mots: Set<string>;
		/** Texte normalisé, pour les graphies en plusieurs mots. */
		plat: string;
	}
	const indexer = (texte: string | null): Pick<Texte, "mots" | "plat"> => {
		const plat = normalise(texte ?? "");
		return { plat, mots: new Set(plat.split(" ")) };
	};

	const planches = await sql<{ tome: string; text: string | null }[]>`
		select tome, text from bot.db_manga_pages
		where series = 'DB' and tome like 'vol%' and text is not null`;
	const corpusManga: Texte[] = [];
	for (const p of planches) {
		const tome = Number.parseInt(p.tome.replace(/\D/g, ""), 10);
		if (!Number.isFinite(tome)) continue;
		corpusManga.push({ num: tome, ...indexer(p.text) });
	}

	// `synopsis_fr` d'abord : quand la traduction existe elle est plus proche des
	// graphies françaises des fiches (« Végéta », « Petit Cœur »). Aujourd'hui
	// aucune ligne n'en porte, mais le jour où le script de traduction tourne,
	// la mesure suivra sans qu'on y touche.
	const resumes = await sql<
		{ series: string; number_in_series: number | null; synopsis: string | null }[]
	>`select series, number_in_series, coalesce(synopsis_fr, synopsis) as synopsis
	  from bot.db_episodes
	  where coalesce(synopsis_fr, synopsis) is not null and number_in_series is not null`;
	const corpusEpisodes: Texte[] = resumes.map((e) => ({
		num: Number(e.number_in_series!),
		serie: e.series,
		...indexer(e.synopsis),
	}));

	// Titres d'épisode : 122 des 826 nomment un personnage (« Sangoku dans le
	// grand nord », « Le dernier espoir de Piccolo »). C'est le seul contenu
	// éditorial de la variante qui se MESURE — les transformations et les
	// techniques, elles, ne se mesurent pas : leurs libellés en base viennent
	// des jeux vidéo (« Goku SSJ2 », « Pose de combat G ») et la VF du manga
	// traduit tout, « kamehameha » n'apparaît que sur UNE planche de l'OCR.
	const titres = await sql<
		{ id: number; series: string; number_in_series: number | null; title: string | null }[]
	>`select id, series, number_in_series, title from bot.db_episodes
	  where title is not null and number_in_series is not null`;
	const corpusTitres = titres.map((e) => ({
		// `id` en plus du numéro : c'est lui qui permet de lier la fiche à
		// `/wiki/episodes/<id>`. Le numéro seul ne suffit pas, il repart à 1 par série.
		id: Number(e.id),
		num: Number(e.number_in_series!),
		serie: e.series,
		titre: e.title!,
		...indexer(e.title),
	}));

	console.log(
		`${corpusManga.length} planches OCR (manga DB) et ${corpusEpisodes.length} synopsis d'épisode indexés.`
	);

	const filtre = opt("personnage");
	// `visible` : les fiches en double masquées par `doublons-personnages.ts`
	// (« Son Goku » quand « Goku » existe déjà) ne doivent pas être remesurées —
	// leurs variantes ne seraient jamais lues, mais elles fausseraient tous les
	// comptages de ce script.
	const personnages = await sql<{ id: number; name: string; image: string | null }[]>`
		select id, name, image from bot.db_characters
		where visible = true
		${filtre ? sql`and name ilike ${`%${filtre}%`}` : sql``}
		order by id`;

	// `--reinitialiser` : efface les variantes AMORCÉES avant de remesurer. Sans
	// lui, resserrer les graphies laisserait en base les faux positifs de la
	// passe précédente (rien ne les supprime, `on conflict` ne fait qu'ajouter).
	// Les variantes reprises à la main (`origin = 'editorial'`) sont épargnées.
	if (flag("reinitialiser") && APPLIQUER) {
		const supprimees = await sql`
			delete from bot.db_character_variants
			where origin is distinct from 'editorial' returning id`;
		console.log(`${supprimees.length} variante(s) amorcée(s) effacée(s) avant remesure.`);
	}

	// Seuils. Trois planches pour le manga : en dessous on est dans le bruit
	// d'OCR (mesuré sur « boo », qui touche 4 planches du tome 1 où il n'a rien
	// à faire). Deux synopsis pour l'anime : un résumé fait 500 à 1 000 signes
	// et ne cite qu'une poignée de noms, une seule mention peut être une
	// annonce d'épisode suivant.
	const SEUIL_PLANCHES = 3;
	const SEUIL_SYNOPSIS = 2;

	const mesureAt = Date.now();
	let ecrites = 0;
	let personnagesTouches = 0;
	const apercu: string[] = [];
	let parManga = 0;
	let parEpisodes = 0;
	let parLesDeux = 0;

	interface Preuve {
		saga: Saga;
		tomes: number[];
		planches: number;
		episodes: number[];
		synopsis: number;
		/** Épisodes dont le titre nomme le personnage. */
		titres: { id: number; num: number; title: string }[];
	}

	for (const p of personnages) {
		const formes = graphies(p.name);
		if (!formes.length) continue;
		const vu = (t: Texte) =>
			formes.some((f) => (f.includes(" ") ? t.plat.includes(f) : t.mots.has(f)));

		// Comptage par tome, et par (série, épisode).
		const parTome = new Map<number, number>();
		for (const t of corpusManga) if (vu(t)) parTome.set(t.num, (parTome.get(t.num) ?? 0) + 1);
		const parEpisode = new Map<string, number>();
		for (const t of corpusEpisodes) {
			if (vu(t))
				parEpisode.set(`${t.serie}#${t.num}`, (parEpisode.get(`${t.serie}#${t.num}`) ?? 0) + 1);
		}
		if (!parTome.size && !parEpisode.size) continue;

		const preuves: Preuve[] = [];
		for (const s of sagas) {
			const tomes: number[] = [];
			let planchesVues = 0;
			if (s.tomeDebut != null && s.tomeFin != null) {
				for (let t = s.tomeDebut; t <= s.tomeFin; t++) {
					const c = parTome.get(t);
					if (c) {
						tomes.push(t);
						planchesVues += c;
					}
				}
			}
			const episodes: number[] = [];
			let synopsisVus = 0;
			if (s.epSerie && s.epDebut != null && s.epFin != null) {
				for (let n = s.epDebut; n <= s.epFin; n++) {
					const c = parEpisode.get(`${s.epSerie}#${n}`);
					if (c) {
						episodes.push(n);
						synopsisVus += c;
					}
				}
			}
			const assezManga = planchesVues >= SEUIL_PLANCHES;
			const assezAnime = synopsisVus >= SEUIL_SYNOPSIS;
			if (!assezManga && !assezAnime) continue;
			// Titres : aucun seuil, un seul suffit — un personnage cité dans le
			// titre d'un épisode n'y est jamais par hasard.
			const titresVus =
				s.epSerie && s.epDebut != null && s.epFin != null
					? corpusTitres
							.filter(
								(t) => t.serie === s.epSerie && t.num >= s.epDebut! && t.num <= s.epFin! && vu(t)
							)
							.map((t) => ({ id: t.id, num: t.num, title: t.titre }))
							.toSorted((a, b) => a.num - b.num)
					: [];
			preuves.push({
				saga: s,
				tomes: assezManga ? tomes : [],
				planches: assezManga ? planchesVues : 0,
				episodes: assezAnime ? episodes : [],
				synopsis: assezAnime ? synopsisVus : 0,
				titres: titresVus,
			});
		}
		if (!preuves.length) continue;
		personnagesTouches++;

		if (apercu.length < 25) {
			apercu.push(
				`${p.name.padEnd(22)} ${preuves
					.map((v) => {
						const marques = [
							v.planches ? `${v.planches}p` : null,
							v.synopsis ? `${v.synopsis}é` : null,
						]
							.filter(Boolean)
							.join("/");
						return `${v.saga.name.replace(/^Saga /, "")}(${marques})`;
					})
					.join(" · ")}`
			);
		}

		for (const v of preuves) {
			if (v.planches && v.synopsis) parLesDeux++;
			else if (v.planches) parManga++;
			else parEpisodes++;
		}

		if (!APPLIQUER) {
			ecrites += preuves.length;
			continue;
		}

		for (const v of preuves) {
			const slugSaga = v.saga.slug.replace(/_/g, "-");
			const slug = `${normalise(p.name).replace(/ /g, "-")}-${slugSaga}`;
			const methode = [v.planches ? "ocr-manga" : null, v.synopsis ? "synopsis-episodes" : null]
				.filter(Boolean)
				.join("+");
			const evidence = {
				methode,
				tomes: v.tomes,
				planches: v.planches,
				episodes: v.episodes,
				synopsis: v.synopsis,
				graphies: formes,
				mesureAt,
			};
			// `where origin is distinct from 'editorial'` : une variante reprise à
			// la main n'est JAMAIS écrasée par une nouvelle mesure. C'est la seule
			// garantie qui rend ce script rejouable sans détruire du travail.
			await sql`
				insert into bot.db_character_variants
					(character_id, saga_id, slug, label, display_name,
					 first_volume, last_volume, first_episode, last_episode,
					 key_episodes, origin, evidence, sort_order)
				values (${p.id}, ${v.saga.id}, ${slug}, ${v.saga.name},
					${`${p.name} — ${v.saga.name}`},
					${v.tomes[0] ?? null}, ${v.tomes.at(-1) ?? null},
					${v.episodes[0] ?? null}, ${v.episodes.at(-1) ?? null},
					${v.titres.length ? sql.json(v.titres) : null},
					${methode}, ${sql.json(evidence)}, ${v.saga.orderIdx ?? 0})
				on conflict (character_id, saga_id) do update set
					first_volume  = excluded.first_volume,
					last_volume   = excluded.last_volume,
					first_episode = excluded.first_episode,
					last_episode  = excluded.last_episode,
					origin        = excluded.origin,
					evidence      = excluded.evidence,
					sort_order    = excluded.sort_order
				where bot.db_character_variants.origin is distinct from 'editorial'`;
			ecrites++;
		}
	}

	console.log(`\n${apercu.join("\n")}`);
	console.log(
		`\n${personnagesTouches} personnage(s) présent(s) dans au moins une saga, ${ecrites} variante(s) ${APPLIQUER ? "écrites" : "à écrire"}.`
	);
	console.log(
		`Preuve : ${parManga} par le manga seul, ${parEpisodes} par les synopsis seuls, ${parLesDeux} par les deux.`
	);
	if (!APPLIQUER) console.log("Simulation — relancer avec --appliquer pour écrire.");
} finally {
	await sql.end({ timeout: 5 });
}
