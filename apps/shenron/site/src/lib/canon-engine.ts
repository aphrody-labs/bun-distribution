/**
 * @file canon-engine.ts
 * Moteur de canonicité Dragon Ball — **déterministe et entièrement paramétrable
 * depuis `/admin/ia?tab=canon`**.
 *
 * Le reproche fondateur de cette version : « il se base sur des trucs
 * d'internet ». Il ne le fait plus, et il ne peut plus le faire. Un verdict ne
 * sort que d'une table curée à la main — rangs, définitions, mots-clés,
 * citations, sources — dont le contenu par défaut est ci-dessous et dont la
 * version qui fait foi vit dans `public."CanonConfig"` (cf. `canon-config.ts`).
 * Aucun modèle de langage, aucun wiki de fans, aucune requête sortante
 * n'intervient dans la décision.
 *
 * Trois niveaux de décision, dans cet ordre :
 *
 *  1. `entries` — les sujets tranchés (Broly, GT, SSJ5…). Un verdict rédigé,
 *     ses sources, la citation d'auteur quand elle existe.
 *  2. `heuristics` — les familles de formulations (« filler », « manga
 *     original »…) : un rang probable quand le sujet précis n'est pas répertorié.
 *  3. `fallback` — l'aveu d'ignorance. Il vaut mieux qu'une valeur plausible.
 *
 * Le vocabulaire des rangs (`CanonTier`) reste fixe : la page publique, les
 * couleurs et la doctrine s'y adossent. Tout le reste — libellé, couleur, score,
 * définition, œuvres incluses — s'édite en base.
 */

export type CanonTier =
	| "CANON_ABSOLU" // Manga original 42 tomes, Jaco, Minus, interviews autographes
	| "CANON_SUPERVISE" // DBS manga, films BoG/Broly/Super Hero, Daima (script/design Toriyama)
	| "EXTENSION_OFFICIELLE" // Daizenshuu, SEG, Chōzenshū supervisés/préfacés par l'auteur
	| "NON_CANON_DERIVE" // Fillers anime DB/DBZ, films vintage Toei 1986-1995, DBGT, SDBH
	| "APOCRYPHE_FANON"; // Rumeurs, mythes, fausses interviews, AF/Multiverse

/** Les cinq rangs, dans l'ordre décroissant d'autorité. Vocabulaire figé. */
export const CANON_TIERS: readonly CanonTier[] = [
	"CANON_ABSOLU",
	"CANON_SUPERVISE",
	"EXTENSION_OFFICIELLE",
	"NON_CANON_DERIVE",
	"APOCRYPHE_FANON",
] as const;

function isCanonTier(v: unknown): v is CanonTier {
	return typeof v === "string" && (CANON_TIERS as readonly string[]).includes(v);
}

interface CanonQuote {
	text: string;
	source: string;
	year?: number;
}

/** La définition d'un rang : ce qu'il signifie, et ce qu'on y range. */
interface CanonTierConfig {
	id: CanonTier;
	/** Libellé long affiché en tête de verdict. */
	label: string;
	/** Libellé court, pour les puces et les listes. */
	court: string;
	/** Couleur hexadécimale du rang. */
	couleur: string;
	/** Score par défaut (0-100) quand une règle n'en impose pas d'autre. */
	score: number;
	/** La définition sur laquelle le moteur se base. C'est elle qui fait foi. */
	definition: string;
	/** Les œuvres et supports rangés ici, un par ligne. */
	inclut: string[];
}

export interface CanonTopicEntry {
	id: string;
	title: string;
	category: "character" | "form" | "lore" | "work" | "myth";
	tier: CanonTier;
	score: number;
	keywords: string[];
	verdict: string;
	explanation: string;
	toriyamaQuote?: CanonQuote;
	sources: string[];
}

/**
 * Une famille de formulations, pas un sujet : « filler », « manga original ».
 * Consultée seulement quand aucune entrée précise ne répond.
 */
export interface CanonHeuristic {
	id: string;
	label: string;
	tier: CanonTier;
	score: number;
	keywords: string[];
	verdict: string;
	explanation: string;
	sources: string[];
}

/**
 * Une déclaration d'auteur citée telle quelle, chargée depuis le corpus local
 * (`.aphrody`) par `scripts/canon-ingest.ts`.
 *
 * Une référence n'est **pas** un verdict : elle ne dit pas si un fait est
 * canonique, elle donne la phrase imprimée sur laquelle on peut trancher. C'est
 * la différence entre « le site affirme » et « voici ce qu'Akira Toriyama a
 * écrit, dans quel guide, en quelle année ».
 */
export interface CanonReference {
	id: string;
	/** Le sujet ou la question dont la déclaration traite. */
	subject: string;
	keywords: string[];
	text: string;
	/**
	 * Traduction française, quand la citation est en version originale.
	 *
	 * L'original n'est jamais remplacé : une traduction sans sa source n'est pas
	 * une preuve — même règle que les planches de databooks.
	 */
	textFr?: string;
	source: string;
	year?: number;
	/** Le document du corpus local d'où elle sort. */
	document: string;
	lang: "fr" | "en" | "ja";
	/**
	 * `aphrody` = corpus local de guides ; `databooks` = planche transcrite et
	 * traduite par le site, avec son scan ; `manuel` = saisie dans l'éditeur ;
	 * `manga` = tomes et chapitres du manga original et de DBS.
	 */
	provenance: "aphrody" | "databooks" | "manuel" | "manga";
	/** Lien vers la pièce elle-même (planche de databook, scan manga) quand elle existe. */
	href?: string;
}

export interface CanonAnalysisResult {
	tier: CanonTier;
	tierLabel: string;
	score: number; // 0 à 100%
	color: string;
	verdict: string;
	explanation: string;
	toriyamaQuote?: CanonQuote;
	sources: string[];
	matchedKeywords: string[];
	doctrineRules?: string[];
	/** La définition du rang retenu, telle qu'elle est écrite en configuration. */
	tierDefinition?: string;
	/** `entry:<id>`, `heuristic:<id>`, `fallback`, `troll` ou `empty` — d'où vient le verdict. */
	origine: string;
	/**
	 * What kind of answer this is. `verdict`: the doctrine ruled. `question`: a
	 * real question the doctrine has no entry for, answered with the corpus only.
	 * `troll`: the input is not about Dragon Ball or asks for something no source
	 * contains. `empty`: nothing was asked.
	 */
	nature: "verdict" | "question" | "troll" | "empty";
	/** Titles of ruled topics close to the input, to offer as next questions. */
	suggestions: string[];
	/** Les déclarations d'auteur du corpus qui parlent du sujet posé. */
	references?: CanonReference[];
}

export interface PowerScalingMultiplier {
	form: string;
	multiplier: number;
	baseForm: string;
	source: string;
	canonTier: CanonTier;
	notes?: string;
}

interface OfficialBattlePower {
	character: string;
	characterId?: number;
	saga: string;
	state: string;
	bp: number;
	scouter: boolean;
	source: string;
	canonTier: CanonTier;
}

interface PowerScalingTier {
	tierNumber: number;
	name: string;
	description: string;
	examples: string[];
}

export interface PowerScalingConfig {
	enabled: boolean;
	kiriToBpRate: number;
	planetDestructionKiriFloor: number;
	multipliers: PowerScalingMultiplier[];
	officialBps: OfficialBattlePower[];
	tiers: PowerScalingTier[];
}

/** Le document éditable en entier. Un seul objet, un seul enregistrement. */
export interface CanonConfig {
	version: 1;
	/** Consigne générale affichée en tête de `/wiki/canon`. */
	intro: string;
	/** Exemple de question dans la barre de recherche. */
	placeholder: string;
	/** Les règles de doctrine jointes à chaque verdict. */
	doctrine: string[];
	/** Sources sur lesquelles le moteur a le droit de s'appuyer. */
	sourcesAdmises: string[];
	/** Sources explicitement refusées (wikis de fans, rumeurs, agrégateurs). */
	sourcesInterdites: string[];
	tiers: CanonTierConfig[];
	entries: CanonTopicEntry[];
	heuristics: CanonHeuristic[];
	/** Le corpus de déclarations d'auteur, chargé depuis `.aphrody`. */
	references: CanonReference[];
	/** Configuration du Power Scaling officiel canonique */
	powerScaling: PowerScalingConfig;
	/** Le verdict rendu quand rien ne répond : on ne tranche pas. */
	fallback: {
		tier: CanonTier;
		score: number;
		verdict: string;
		explanation: string;
		sources: string[];
	};
	/** Le texte affiché avant toute question. */
	vide: { verdict: string; explanation: string };
}

/**
 * Les définitions par défaut des cinq rangs.
 *
 * Elles reprennent la doctrine du dépôt : le manga des 42 tomes fait foi, ce que
 * Toriyama a écrit ou supervisé vient ensuite, les databooks documentent sans
 * créer, l'animation Toei et les jeux sont des dimensions parallèles, le reste
 * est une rumeur. Tout est réécrivable depuis `/admin/ia?tab=canon`.
 */
const DEFAULT_CANON_TIERS: CanonTierConfig[] = [
	{
		id: "CANON_ABSOLU",
		label: "Canon Absolu (Tier 1 — Manga & Toriyama pur)",
		court: "Canon absolu",
		couleur: "#22c55e",
		score: 100,
		definition:
			"Écrit, dessiné ou explicitement révélé par Akira Toriyama lui-même. Le manga original des 42 tomes prime sur tout le reste : quand une autre source le contredit, c'est l'autre source qui a tort.",
		inclut: [
			"Manga Dragon Ball, tomes 1 à 42 (chapitres 1 à 519)",
			"Jaco the Galactic Patrolman et Dragon Ball Minus",
			"Chapitres et histoires courtes signés Toriyama (Neko Majin, bonus Jump)",
			"Réponses de Toriyama en interview ou Q&A signée (SEG, V-Jump, Saikyō Jump)",
		],
	},
	{
		id: "CANON_SUPERVISE",
		label: "Canon Supervisé (Tier 2 — DBS, Films récents & Daima)",
		court: "Canon supervisé",
		couleur: "#3b82f6",
		score: 88,
		definition:
			"Œuvres de la continuité officielle dont Toriyama a fourni la trame, le scénario ou les designs, mais qu'il n'a pas dessinées lui-même. Elles font autorité tant qu'elles ne contredisent pas le manga original.",
		inclut: [
			"Manga Dragon Ball Super (Toyotaro, storyboards annotés par Toriyama)",
			"Films Battle of Gods, La Résurrection de F, Broly, Super Hero",
			"Dragon Ball Daima (concept, histoire et designs de Toriyama)",
			"OAV et histoires originales écrites par Toriyama (Jump Super Anime Tour 2008)",
		],
	},
	{
		id: "EXTENSION_OFFICIELLE",
		label: "Extension Officielle (Tier 3 — Daizenshuu & SEG)",
		court: "Extension officielle",
		couleur: "#eab308",
		score: 70,
		definition:
			"Documentation éditée par Shueisha et supervisée par Bird Studio. Elle décrit l'œuvre et complète ses marges (chiffres, chronologies, fiches), mais elle ne crée pas d'histoire et cède devant le manga.",
		inclut: [
			"Daizenshuu 1 à 7 et guides Chōzenshū",
			"Super Exciting Guide (2009)",
			"Guides officiels de série, artbooks et Landmark/Forever",
			"Fiches de personnages et chronologies éditoriales",
		],
	},
	{
		id: "NON_CANON_DERIVE",
		label: "Non-Canon Dérivé (Tier 4 — Fillers, Films Toei & GT)",
		court: "Non-canon dérivé",
		couleur: "#f97316",
		score: 20,
		definition:
			"Produit officiellement sous licence, mais écrit hors de la plume de Toriyama : l'animation Toei et ses films se contredisent avec le manga et se déroulent, selon l'auteur lui-même, dans une dimension parallèle.",
		inclut: [
			"Épisodes hors-trame (fillers) de Dragon Ball, DBZ, Kai et DBS",
			"Films Toei de 1986 à 1995 et téléfilms spéciaux",
			"Dragon Ball GT (« grand side-story » selon Toriyama)",
			"Jeux vidéo, Super Dragon Ball Heroes, Xenoverse et leurs personnages",
		],
	},
	{
		id: "APOCRYPHE_FANON",
		label: "Apocryphe / Fanon (Tier 5 — Rumeurs & Inventions)",
		court: "Apocryphe",
		couleur: "#ef4444",
		score: 0,
		definition:
			"Aucune existence officielle : invention de fans, fausse interview, image détournée, doujinshi. À citer uniquement pour dire d'où vient la rumeur et pourquoi elle est fausse.",
		inclut: [
			"Dragon Ball AF, Super Saiyan 5, Xicor",
			"Fausses interviews et citations attribuées à Toriyama",
			"Doujinshi et suites amateurs",
			"Niveaux de puissance inventés et « scans » retouchés",
		],
	},
];

/**
 * Les sujets tranchés, livrés avec le dépôt. C'est le contenu par défaut de
 * `entries` : la base réécrit ce tableau dès qu'un enregistrement existe.
 */
const CANON_DATABASE: CanonTopicEntry[] = [
	// ── Personnages ────────────────────────────────────────────────────────
	{
		id: "broly",
		title: "Broly (Dragon Ball Super, 2018)",
		category: "character",
		tier: "CANON_SUPERVISE",
		score: 85,
		keywords: [
			"broly",
			"broli",
			"broly dbs",
			"broly 2018",
			"broly super",
			"dbs broly",
			"ブロリー",
			"paragus",
			"super saiyan legendaire",
			"berserk",
		],
		verdict: "Canonique dans sa réinvention DBS (2018), Non-canonique dans les films Z (1993-1994).",
		explanation:
			"La version originale de 1993 (scénarisée par Takao Koyama) est hors de la trame canonique bien que Toriyama en ait signé le design initial. En 2018, Akira Toriyama a personnellement réécrit et intégré Broly dans la continuité officielle avec le film Dragon Ball Super: Broly.",
		toriyamaQuote: {
			text: "Broly est un personnage incroyablement populaire. Tout en préservant son image de base pour ne pas décevoir les fans, j'ai apporté une nouvelle facette à son histoire pour en faire une aventure encore plus fascinante.",
			source: "Commentaire officiel de production de Dragon Ball Super: Broly",
			year: 2018,
		},
		sources: ["Film Dragon Ball Super: Broly (2018)", "Daizenshuu 6 (Films Z)", "Manga DBS"],
	},
	{
		id: "broly-dbz-1993",
		title: "Broly (Version DBZ 1993 / Films Z de Takao Koyama)",
		category: "character",
		tier: "NON_CANON_DERIVE",
		score: 20,
		keywords: [
			"broly 1993",
			"broly dbz 1993",
			"broly dbz",
			"broly z",
			"broly film 1993",
			"broly le super saiyan legendaire 1993",
			"dbz 1993",
			"bio-broly",
			"bio broly",
			"broly second coming",
			"broly kakarotto pleure",
		],
		verdict:
			"Non-canonique. Antagoniste exclusif des films Toei Z (1993-1994) scénarisés par Takao Koyama.",
		explanation:
			"L'incarnation originale de Broly dans les films 8, 10 et 11 de Dragon Ball Z est hors de la continuité canonique du manga, bien que son design graphique initial ait été dessiné par Akira Toriyama. Son traumatisme lié aux pleurs de Goku et sa folie destructrice appartiennent à la chronologie parallèle de Toei Animation. Seul le Broly redéfini et réécrit par Akira Toriyama dans Dragon Ball Super: Broly (2018) est canonique.",
		toriyamaQuote: {
			text: "J'avais complètement oublié l'histoire des anciens films de Broly. En 2018, j'ai repris le personnage à zéro en conservant son apparence essentielle mais en réécrivant son histoire pour l'intégrer à la série officielle.",
			source: "Commentaire de production Dragon Ball Super: Broly",
			year: 2018,
		},
		sources: ["Daizenshuu 6 : Movies & TV Specials", "Films DBZ 8, 10, 11 (Toei Animation)", "Film DBS Broly (2018)"],
	},
	{
		id: "gogeta",
		title: "Gogeta",
		category: "character",
		tier: "CANON_SUPERVISE",
		score: 85,
		keywords: ["gogeta", "fusion metamol", "stardust breaker", "soul punisher", "janemba"],
		verdict: "Canonisé dans Dragon Ball Super: Broly (2018). Ses apparitions dans Fusions (1995) et DBGT sont non-canoniques.",
		explanation:
			"La fusion Métamol entre Goku et Vegeta a été inventée par Toriyama dans le manga, mais Gogeta n'apparaissait originellement que dans le film Toei de 1995 et dans GT. Toriyama l'a officiellement réintroduit et validé dans la trame principale lors du combat contre Broly en 2018.",
		sources: ["Film Dragon Ball Super: Broly (2018)", "Manga DB Tome 41 (principe de la danse)"],
	},
	{
		id: "vegetto",
		title: "Vegetto (Vegito)",
		category: "character",
		tier: "CANON_ABSOLU",
		score: 100,
		keywords: ["vegetto", "vegito", "potara", "potaras", "potalas", "potala", "fusion potara", "fusion potala"],
		verdict: "100% Canon absolu. Créé, nommé et dessiné par Akira Toriyama dans le manga original.",
		explanation:
			"Né des boucles d'oreilles Potaras données par le Vieux Kaïoshin. Toriyama a imaginé la fusion Potara pour surprendre ses lecteurs après que le staff de l'anime lui a révélé préparer la fusion Métamol pour le film de Gogeta.",
		sources: ["Manga Dragon Ball Tome 42 (Chapitres 503-506)", "Daizenshuu 2"],
	},
	{
		id: "bardock",
		title: "Bardock",
		category: "character",
		tier: "CANON_ABSOLU",
		score: 95,
		keywords: ["bardock", "barduk", "dragon ball minus", "pere de goku", "tatta hitori no saishū kessen"],
		verdict: "Canon absolu. Validé dans le manga par Toriyama, développé dans Dragon Ball Minus et DBS Broly.",
		explanation:
			"Bien qu'initialement conçu par Toei Animation pour le téléfilm de 1990, Toriyama a tellement adoré le personnage qu'il l'a canonisé en dessinant son visage dans deux cases du manga original (Chapitre 307). Il a ensuite réécrit son départ dans Dragon Ball Minus (2014) aux côtés de sa compagne Gine.",
		toriyamaQuote: {
			text: "Ce téléfilm m'a tellement ému que j'ai voulu intégrer Bardock dans mon manga. C'est l'un des rares cas où l'anime m'a directement inspiré.",
			source: "Daizenshuu 6 : Movies & TV Specials",
			year: 1995,
		},
		sources: ["Manga DB Tome 26 (Chapitre 307)", "Jaco the Galactic Patrolman (DB Minus)", "DBS Broly"],
	},
	{
		id: "bardock-tv-special-1990",
		title: "Téléfilm Bardock (Le Père de Son Goku, 1990) vs Dragon Ball Minus",
		category: "work",
		tier: "NON_CANON_DERIVE",
		score: 30,
		keywords: [
			"bardock tv special",
			"bardock telefilm",
			"bardock 1990",
			"tatta hitori no saishu kessen",
			"bardock vs minus",
			"bardock tv special vs minus",
			"premonition de bardock",
			"don de prescience bardock",
			"bandana ensanglante bardock",
		],
		verdict:
			"Non-canonique dans son déroulement narratif. Remplacé dans la trame officielle par Dragon Ball Minus et DBS Broly.",
		explanation:
			"Le téléfilm de 1990 'Le Père de Son Goku' (scénarisé par Katsuyuki Sumisawa chez Toei) a tellement plu à Toriyama qu'il a intégré le visage de Bardock dans deux cases du manga (Chapitre 307). Cependant, les événements du téléfilm (le don de voir l'avenir transmis par un Kanassan, l'escouade de Toma massacrée sur Meat, le bandana ensanglanté, et Goku bébé nu envoyé sur Terre) ont été officiellement remplacés par Akira Toriyama dans Dragon Ball Minus (2014) et le film DBS Broly : Bardock y a une intuition lucide, sa compagne Gine existe, et Goku part plus âgé vêtu d'une armure saiyanne.",
		sources: ["Manga Dragon Ball Tome 26 (Chapitre 307)", "Dragon Ball Minus (2014)", "Film DBS Broly (2018)", "Daizenshuu 6"],
	},
	{
		id: "goku-saiyan-kakarotto",
		title: "Son Goku : Origine Saiyan (Kakarotto)",
		category: "character",
		tier: "CANON_ABSOLU",
		score: 100,
		keywords: [
			"goku est-il un saiyan",
			"goku saiyan",
			"goku est un saiyan",
			"kakarotto",
			"kakarot",
			"origine saiyan goku",
			"nature saiyanne de goku",
			"vrai nom de goku",
			"nom saiyan de goku",
			"goku extraterrestre",
			"カカロット",
		],
		verdict: "100% Canon absolu. Révélé par Raditz dans le manga original (Chapitre 195).",
		explanation:
			"Son Goku est un Saiyan de basse classe né sur la planète Vegeta sous le nom de Kakarotto (Kakarot). Envoyé sur Terre dans une capsule spatiale pour survivre aux soupçons pesant sur Freezer (Dragon Ball Minus / Jaco / DBS Broly), il a été recueilli par Grand-Père Son Gohan. Sa véritable nature extraterrestre et son nom de naissance saiyan sont révélés dès l'arrivée de son frère Raditz au chapitre 195 du manga.",
		toriyamaQuote: {
			text: "Goku est un Saiyan envoyé depuis la planète Vegeta. J'ai pensé que révéler ses origines extraterrestres donnerait un nouvel élan spectaculaire à l'histoire.",
			source: "Daizenshuu 2 : Story Guide",
			year: 1995,
		},
		sources: ["Manga Dragon Ball Tome 17 (Chapitre 195)", "Dragon Ball Minus", "Film DBS Broly (2018)"],
	},
	{
		id: "destruction-planete-vegeta",
		title: "Destruction de la planète Vegeta par Freezer",
		category: "lore",
		tier: "CANON_ABSOLU",
		score: 100,
		keywords: [
			"destruction planete vegeta",
			"freezer a detruit la planete vegeta",
			"freezer detruit vegeta",
			"destruction de vegeta",
			"planete vegeta freezer",
			"pourquoi freezer a detruit la planete vegeta",
			"genocide saiyan freezer",
		],
		verdict:
			"100% Canon absolu. Établi dans le manga original (Chapitre 257) et illustré dans Dragon Ball Minus et DBS Broly.",
		explanation:
			"Freezer a anéanti la planète Vegeta et la quasi-totalité du peuple Saiyan avec une gigantesque Supernova par crainte de la légende du Super Saiyan et du Super Saiyan God. Bien que Freezer ait prétendu aux survivants (Vegeta, Nappa, Raditz) qu'un météore géant avait détruit leur monde, la vérité est révélée par Dodoria à Vegeta au chapitre 257 du manga. Dragon Ball Super a précisé que Beerus avait préalablement donné son accord ou suggéré cette destruction.",
		sources: ["Manga Dragon Ball Tome 22 (Chapitre 257)", "Dragon Ball Minus", "Film DBS Broly (2018)", "Manga DBS Chapitre 69"],
	},
	{
		id: "jaco-minus",
		title: "Dragon Ball Minus & Jaco the Galactic Patrolman",
		category: "work",
		tier: "CANON_ABSOLU",
		score: 100,
		keywords: ["jaco", "dragon ball minus", "jaco le patrouilleur galactique", "depart goku minus", "origine goku capsule", "tights", "omori"],
		verdict: "100% Canon absolu. Écrit et dessiné intégralement par Akira Toriyama en 2013-2014.",
		explanation:
			"Préambule officiel à Dragon Ball, publié par Toriyama dans le Weekly Shonen Jump. Il établit la rencontre entre Jaco, Bulma enfant et sa sœur aînée Tights, ainsi que les circonstances exactes du départ de Son Goku enfant de la planète Vegeta, envoyé par Bardock et Gine pour le protéger des soupçons pesant sur Freezer.",
		sources: ["Jaco the Galactic Patrolman (manga d'Akira Toriyama, 2013-2014)", "Dragon Ball Minus (Jump Comics)", "Film DBS Broly (2018)"],
	},
	{
		id: "gine",
		title: "Gine (Mère de Son Goku)",
		category: "character",
		tier: "CANON_ABSOLU",
		score: 100,
		keywords: ["gine", "mere de goku", "femme de bardock", "compagne de bardock", "mere kakarotto"],
		verdict: "100% Canon absolu. Créée et dessinée par Akira Toriyama dans Dragon Ball Minus (2014).",
		explanation:
			"Toriyama a révélé pour la première fois l'existence de la mère de Son Goku dans le Saikyō Jump de mars 2014 avant de la mettre en scène dans Dragon Ball Minus. Contrairement aux guerriers saiyans belliqueux, Gine avait un tempérament doux et travaillait au centre de distribution de viande sur la planète Vegeta.",
		toriyamaQuote: {
			text: "Son nom est Gine. Elle a autrefois combattu dans l'escouade de Bardock, mais sa nature douce la rendait inadaptée au combat. Ils ont développé un lien affectif rare chez les Saiyans, où les unions ne servent d'ordinaire qu'à la reproduction.",
			source: "Saikyō Jump Mars 2014 (Entretien Akira Toriyama)",
			year: 2014,
		},
		sources: ["Saikyō Jump Mars 2014", "Dragon Ball Minus (2014)", "Film Dragon Ball Super: Broly (2018)"],
	},
	{
		id: "c16-fils-gero",
		title: "C-16 et Gebō (Le fils du Dr Gero)",
		category: "lore",
		tier: "CANON_ABSOLU",
		score: 95,
		keywords: ["c16", "c-16", "fils de gero", "fils du docteur gero", "gebo", "gevo", "pourquoi c16 est gentil"],
		verdict: "Canon absolu. Histoire intime de C-16 dévoilée par Akira Toriyama en 2014.",
		explanation:
			"Dans l'émission Mandō Kobayashi (2014), Akira Toriyama a révélé que le Dr Gero avait conçu le robot C-16 à l'image exacte de son fils défunt, un soldat de haut rang de l'Armée du Ruban Rouge tombé sous une balle ennemie. Pris d'une affection paternelle protectrice, Gero l'a doté d'une puissance colossale mais d'une programmation pacifique pour éviter qu'il ne soit à nouveau détruit au combat.",
		toriyamaQuote: {
			text: "Le modèle de C-16 était le propre fils du Dr Gero, mort jeune comme soldat du Ruban Rouge. C'est pourquoi Gero lui a donné une personnalité douce et refusait de le voir combativement engagé.",
			source: "Mandō Kobayashi (Fuji TV ONE) — Entretien Akira Toriyama",
			year: 2014,
		},
		sources: ["Mandō Kobayashi Mars 2014", "Super Exciting Guide", "Dragon Ball Super: Super Hero (arbre généalogique Red Ribbon)"],
	},
	{
		id: "c17-lapis-c18-lazuli",
		title: "Noms civils de C-17 (Lapis) et C-18 (Lazuli)",
		category: "lore",
		tier: "CANON_ABSOLU",
		score: 100,
		keywords: ["lapis", "lazuli", "vrai nom c17", "vrai nom c18", "humains artificiels"],
		verdict: "Canon absolu. Révélé directement par Akira Toriyama.",
		explanation:
			"Dans une session de questions/réponses du Super Exciting Guide puis du V-Jump (2014), Toriyama a dévoilé que C-17 et C-18 étaient des jumeaux humains nommés Lapis et Lazuli avant d'être kidnappés et modifiés par le Dr Gero.",
		sources: ["Super Exciting Guide", "V-Jump Mai 2014 (Toriyama Q&A)"],
	},
	{
		id: "mr-satan-mark",
		title: "Véritable nom de Mr. Satan (Mark)",
		category: "lore",
		tier: "CANON_ABSOLU",
		score: 100,
		keywords: ["mark", "vrai nom satan", "mr satan", "nom de famille hercule"],
		verdict: "Canon absolu. Révélé par Akira Toriyama dans le Super Exciting Guide (2009).",
		explanation:
			"Mr. Satan est son pseudonyme de ring de combat. Son véritable prénom est Mark (anagramme de Akuma, diable en japonais). Dans son secteur culturel, il n'existe pas de noms de famille.",
		sources: ["Super Exciting Guide : Character Volume (2009)", "docs/toriyama-databook-seg.md"],
	},
	{
		id: "db-gt",
		title: "Dragon Ball GT (SSJ4, Baby, Dragons)",
		category: "work",
		tier: "NON_CANON_DERIVE",
		score: 15,
		keywords: ["gt", "dragon ball gt", "baby", "omega shenron", "li shenron"],
		verdict: "Non-canonique à la continuité Toriyama. Qualifié de 'Grand Side-Story' par l'auteur.",
		explanation:
			"Produit par Toei Animation sans implication narrative d'Akira Toriyama. L'auteur a uniquement fourni le titre 'GT' (Grand Touring), le logo, le design initial du trio Goku/Trunks/Pan et quelques planches préliminaires.",
		toriyamaQuote: {
			text: "Pour GT, la seule chose que j'ai faite a été de trouver le titre, de dessiner le design initial des personnages principaux et de quelques machines. Étant libéré des contraintes d'une sérialisation, j'ai pu apprécier Dragon Ball GT en simple spectateur, comme une merveilleuse histoire parallèle (grand side-story).",
			source: "Dragon Ball GT DVD Box 'Dragon Box GT' (Introduction de Toriyama)",
			year: 2005,
		},
		sources: ["Dragon Box GT", "Kanzenshuu Archives"],
	},
	{
		id: "super-saiyan-4",
		title: "Super Saiyan 4 (SSJ4)",
		category: "form",
		tier: "NON_CANON_DERIVE",
		score: 15,
		keywords: ["super saiyan 4", "ssj4", "transformation ssj4", "oozaru dore", "katsuyoshi nakatsuru ssj4", "goku ssj4", "vegeta ssj4", "gogeta ssj4"],
		verdict: "Non-canonique. Conçu par Katsuyoshi Nakatsuru pour Dragon Ball GT.",
		explanation:
			"Le design emblématique du Super Saiyan 4 (fourrure rouge, queue de singe et cheveux noirs) a été créé par l'animateur en chef Katsuyoshi Nakatsuru chez Toei Animation pour Dragon Ball GT. Akira Toriyama a grandement apprécié ce design et en a dessiné sa propre version hommage pour la Dragon Box GT en 2005, mais a confirmé qu'il s'agissait d'une création de l'anime appartenant à une histoire parallèle (grand side-story).",
		toriyamaQuote: {
			text: "Le design du Super Saiyan 4 a été créé par Nakatsuru-kun de Toei Animation. J'ai été très impressionné par son idée de combiner l'Oozaru et le Super Saiyan, et je me suis amusé à le redessiner moi-même pour ce coffret.",
			source: "Dragon Book (Dragon Box GT)",
			year: 2005,
		},
		sources: ["Dragon Box GT (2005)", "Dragon Ball GT Perfect Files", "Entretiens Akira Toriyama & Katsuyoshi Nakatsuru"],
	},
	{
		id: "ssj4-vs-ssjg",
		title: "Super Saiyan 4 vs Super Saiyan God / Blue (Canonicité & Débat)",
		category: "form",
		tier: "NON_CANON_DERIVE",
		score: 25,
		keywords: [
			"ssj4 vs ssjg",
			"ssj4 vs ssg",
			"ssj4 vs ssgss",
			"ssj4 vs ssj blue",
			"super saiyan 4 vs super saiyan god",
			"ssj4 vs god",
			"ssj4 ou god",
			"ssj god vs ssj4",
		],
		verdict:
			"Le Super Saiyan God est Canon Supervisé (Toriyama, 2013) ; le Super Saiyan 4 est Non-Canon Dérivé (GT / Nakatsuru, 1996).",
		explanation:
			"Sur le plan de la canonicité, il n'y a pas d'ambiguïté : le Super Saiyan God et le Super Saiyan Blue sont nés de la plume d'Akira Toriyama pour Battle of Gods et La Résurrection de F, intégrés dans la continuité officielle de Dragon Ball Super. Le Super Saiyan 4 a été conçu par Katsuyoshi Nakatsuru pour Dragon Ball GT, une série que Toriyama qualifie de 'grand side-story' hors continuité. Toute comparaison de puissance entre les deux relève du crossover de jeux vidéo (SDBH/Heroes) et non de la chronologie canonique.",
		sources: ["Film Battle of Gods (2013)", "Dragon Box GT (2005)", "Manga DBS", "Super Dragon Ball Heroes"],
	},
	{
		id: "cooler",
		title: "Cooler & Metal Cooler",
		category: "character",
		tier: "NON_CANON_DERIVE",
		score: 20,
		keywords: ["cooler", "kula", "metal cooler", "forme finale cooler", "sauzer", "neiz", "dore", "escadron cooler", "film cooler"],
		verdict: "Non-canonique. Conçu pour les films 5 et 6 par Toei Animation et Takao Koyama.",
		explanation:
			"Bien qu'Akira Toriyama ait dessiné l'apparence de Cooler et sa transformation finale à la demande de Toei Animation, le frère aîné de Freezer n'apparaît dans aucun chapitre du manga original ni dans Dragon Ball Super. Les films 'La Revanche de Cooler' et 'Cent Mille Guerriers de Métal' se déroulent dans une chronologie incompatible avec les événements de Namek et de la Terre.",
		toriyamaQuote: {
			text: "J'envisage les films de cinéma comme des histoires situées dans une dimension parallèle à celle de mon manga original.",
			source: "Daizenshuu 6 : Movies & TV Specials",
			year: 1995,
		},
		sources: ["Daizenshuu 6 : Movies & TV Specials", "Manga Dragon Ball (Tomes 27-28)", "Jump Comics Film Animation Comics"],
	},
	{
		id: "janemba",
		title: "Janemba",
		category: "character",
		tier: "NON_CANON_DERIVE",
		score: 20,
		keywords: ["janemba", "super janemba", "saike demon", "monde des morts janemba", "epee janemba", "film fusions"],
		verdict: "Non-canonique. Antagoniste exclusif du film 12 Fusions (1995).",
		explanation:
			"Né de l'explosion de la machine purificatrice d'âmes aux Enfers, Janemba a été imaginé par le scénariste Takao Koyama pour servir d'adversaire à la première apparition de la fusion Métamol Gogeta au cinéma. Akira Toriyama en a réalisé le design sur demande du studio, mais Janemba n'appartient à aucune continuité canonique.",
		sources: ["Daizenshuu 6 : Movies & TV Specials", "Film Dragon Ball Z : Fusions (1995)"],
	},
	{
		id: "tapion-epee-trunks",
		title: "Tapion, Hildegarn et l'Épée de Trunks",
		category: "character",
		tier: "NON_CANON_DERIVE",
		score: 20,
		keywords: ["tapion", "hildegarn", "epee de trunks", "minotia", "ocarina tapion", "attaque du dragon", "konatsien"],
		verdict: "Non-canonique. L'origine cinématographique de l'épée de Trunks contredit le manga canonique.",
		explanation:
			"Le film 13 'L'Attaque du Dragon' (1995) met en scène Tapion offrant son épée au jeune Trunks du présent. Cependant, dans le manga original et le chapitre spécial 'Trunks the Story', Trunks du futur combat les cyborgs dans une trame apocalyptique où Tapion et Hildegarn n'ont jamais existé. L'épée de Trunks dans le canon est une arme forgée durant la résistance contre C-17 et C-18.",
		sources: ["Manga Dragon Ball Tome 33 (Trunks the Story)", "Daizenshuu 6", "Film L'Attaque du Dragon (1995)"],
	},
	{
		id: "bojack-zangya",
		title: "Bojack et les Mercenaires de l'Espace",
		category: "character",
		tier: "NON_CANON_DERIVE",
		score: 20,
		keywords: ["bojack", "boujack", "zangya", "bido", "bujin", "goku ssj2 bojack", "les mercenaires de l'espace"],
		verdict: "Non-canonique. Conçu par Toei Animation pour le film 9 (1993).",
		explanation:
			"Scénarisé par Takao Koyama pour s'insérer juste après la mort de Son Goku lors des Cell Games. Toriyama a réalisé les dessins préparatoires de Bojack et de ses acolytes à la demande du studio, mais les événements du tournoi d'arts martiaux de la famille Dollar ne font pas partie de la trame du manga original.",
		sources: ["Daizenshuu 6 : Movies & TV Specials", "Film Dragon Ball Z : Les Mercenaires de l'Espace (1993)"],
	},
	{
		id: "thales-arbre-sacre",
		title: "Thalès (Turles) & l'Arbre Sacré",
		category: "character",
		tier: "NON_CANON_DERIVE",
		score: 20,
		keywords: ["thales", "turles", "arbre sacre", "shinseiju", "fruit arbre sacre", "sosie de goku", "film thales"],
		verdict: "Non-canonique. Film Toei Animation de 1990 explorant un Son Goku maléfique alternatif.",
		explanation:
			"Imaginé par Takao Koyama et Toei Animation pour explorer ce que serait devenu Son Goku s'il n'avait pas perdu la mémoire en tombant sur la tête. Toriyama a dessiné le charadesign de Thalès, mais le film est chronologiquement incompatible avec la saga Namek (Son Goku vivant sur Terre avec Kaio-ken alors que Yamcha, Chaozu et Tenshinhan sont encore en vie).",
		sources: ["Daizenshuu 6 : Movies & TV Specials", "Film Dragon Ball Z : Le Combat Fratricide (1990)"],
	},
	{
		id: "films-toei-vintage",
		title: "Films DBZ vintage (Cycles Toei 1986-1995)",
		category: "work",
		tier: "NON_CANON_DERIVE",
		score: 20,
		keywords: ["films toei", "films dbz", "films vintage", "oav dbz", "slug", "c-13", "film z", "dimensions paralleles"],
		verdict: "Non-canoniques. Univers parallèles conçus par Toei Animation et Takao Koyama.",
		explanation:
			"Ces films ne peuvent pas s'insérer logiquement dans la chronologie du manga original (personnages morts encore vivants, Son Goku présent sur Terre pendant Namek, etc.). Toriyama a seulement réalisé certains charadesigns à la demande du studio.",
		toriyamaQuote: {
			text: "J'envisage les films de cinéma comme des histoires situées dans une dimension parallèle à celle de mon manga original.",
			source: "Daizenshuu 6 : Movies & TV Specials",
			year: 1995,
		},
		sources: ["Daizenshuu 6", "docs/toriyama-interviews.md"],
	},
	{
		id: "tarble",
		title: "Tarble (Frère de Vegeta)",
		category: "character",
		tier: "CANON_SUPERVISE",
		score: 90,
		keywords: [
			"tarble",
			"table",
			"frere de vegeta",
			"tarble frere de vegeta",
			"tarble est-il canon",
			"femme de tarble",
			"gure",
			"salada",
			"abo cado",
			"kado",
		],
		verdict: "Canonique. Conçu par Toriyama pour l'OAV de 2008 et mentionné dans Battle of Gods.",
		explanation:
			"L'histoire originale de l'OAV 2008 'Salut ! Son Goku et ses amis sont de retour !!' a été écrite par Akira Toriyama lui-même. Tarble est ensuite expressément mentionné par Bulma dans le film Battle of Gods (2013) et dans le manga Dragon Ball Super.",
		sources: ["OAV Jump Super Anime Tour 2008", "Film Battle of Gods (2013)", "DBS Manga Tome 1"],
	},
	{
		id: "piccolo-favori",
		title: "Piccolo : Personnage préféré de Toriyama",
		category: "lore",
		tier: "CANON_ABSOLU",
		score: 100,
		keywords: [
			"piccolo favori",
			"personnage prefere toriyama",
			"personnage favori toriyama",
			"personnage prefere d'akira toriyama",
			"personnage favori d'akira toriyama",
			"auteur aime piccolo",
			"piccolo toriyama",
			"prefere de toriyama",
			"favori de toriyama",
		],
		verdict: "Canon absolu. Affirmation constante et confirmée de 1995 à 2022.",
		explanation:
			"Toriyama a toujours affirmé que Piccolo était son personnage favori, bien avant Goku et Vegeta. C'est pour cette raison qu'il a placé Piccolo et Gohan au centre absolu du film Dragon Ball Super: Super Hero en 2022.",
		toriyamaQuote: {
			text: "Je suppose que j'aime Piccolo le plus après tout... Avec Piccolo, son passé de méchant le rend plus intéressant à développer que Goku, qui est d'une pureté absolue.",
			source: "Daizenshuu 2 : Story Guide (1995) & Interview Super Hero (2022)",
			year: 1995,
		},
		sources: ["Daizenshuu 2", "Interview DBS Super Hero (2022)", "docs/toriyama-interviews.md"],
	},
	{
		id: "super-saiyan-5-af",
		title: "Super Saiyan 5 & Dragon Ball AF",
		category: "myth",
		tier: "APOCRYPHE_FANON",
		score: 0,
		keywords: ["super saiyan 5", "ssj5", "dragon ball af", "zaiko", "xicor", "toyble"],
		verdict: "100% Apocryphe & Fanon. Canular né sur Internet en 1999.",
		explanation:
			"Créé à l'origine par David Montiel Franco (Tablos) comme fan-art dans un magazine espagnol, puis propagé mondialement comme fausse rumeur de suite officielle. N'a aucun lien avec Akira Toriyama, bien que Toyotaro (alors Toyble) s'en soit inspiré pour son doujinshi amateur avant d'être engagé par Shueisha.",
		sources: ["Hobby Consolas (1999)", "Historique Dragon Ball AF"],
	},
	{
		id: "daima",
		title: "Dragon Ball Daima",
		category: "work",
		tier: "CANON_SUPERVISE",
		score: 98,
		keywords: [
			"daima",
			"dragon ball daima",
			"glorio",
			"panzy",
			"gomah",
			"royaume des demons",
			"daima realm",
			"demon realm",
			"royaume demoniaque",
			"royaume des demons daima",
			"makai",
			"tamagami",
		],
		verdict: "Canonique. Dernière œuvre majeure directement scénarisée et dessinée par Akira Toriyama.",
		explanation:
			"Akira Toriyama s'est impliqué à un niveau record dans Dragon Ball Daima : il a créé le concept original, l'histoire complète, la structure du Royaume des Démons (Makai), les vaisseaux, ainsi que l'intégralité des nouveaux personnages et monstres.",
		toriyamaQuote: {
			text: "Je me suis retrouvé très impliqué dans cette série, bien plus que d'habitude. J'ai créé l'histoire, les décors et de nombreux designs. C'est une grande aventure palpitante !",
			source: "Message officiel d'annonce de Dragon Ball Daima (New York Comic Con)",
			year: 2023,
		},
		sources: ["Dragon Ball Daima (2024)", "Annonce officielle New York Comic Con 2023"],
	},
	{
		id: "dieu-noyau-monde",
		title: "Origine des Dieux Kaïo et Kaïoshin (Planète du Noyau)",
		category: "lore",
		tier: "CANON_ABSOLU",
		score: 100,
		keywords: ["kaishin-sei", "shin-jin", "arbre du monde", "fruits dores", "makaio", "origine kaioshin", "kaiju"],
		verdict: "Canon absolu. Révélé par Akira Toriyama dans le Super Exciting Guide (2009).",
		explanation:
			"Les Kaïo et Kaïoshin naissent de fruits sur l'Arbre du Monde de la Planète Kaishin-sei. Ils sont asexués, vivent 75 000 ans et seuls les fruits dorés rarissimes donnent naissance aux Kaïoshin.",
		sources: ["Super Exciting Guide : Character Volume (2009)", "docs/toriyama-databook-seg.md"],
	},
	{
		id: "s-cells",
		title: "Cellules S (S-Cells) et déclencheur Super Saiyan",
		category: "lore",
		tier: "CANON_ABSOLU",
		score: 95,
		keywords: ["s-cells", "cellules s", "declencheur super saiyan", "coeur pur", "goten trunks super saiyan"],
		verdict: "Canon absolu. Concept biologique formulé par Akira Toriyama.",
		explanation:
			"Dans le Saikyō Jump de janvier 2018, Toriyama explique que pour devenir Super Saiyan, un corps saiyan doit posséder un seuil suffisant de 'Cellules S', favorisées par un esprit doux et un entraînement rigoureux. Goten et Trunks en ont hérité en grande quantité.",
		sources: ["Saikyō Jump Janvier 2018 (Toriyama Q&A)"],
	},
	{
		id: "dragon-ball-super-manga",
		title: "Dragon Ball Super (Manga de Toyotaro)",
		category: "work",
		tier: "CANON_SUPERVISE",
		score: 90,
		keywords: ["dbs manga", "toyotaro", "moro", "granolah", "ultra instinct", "ultra ego"],
		verdict: "Canon supervisé. Scénarios validés et storyboards annotés par Toriyama.",
		explanation:
			"Toyotaro dessine le manga sous la supervision directe de Toriyama. Toriyama fournissait le plan de trame général, corrigeait les storyboards case par case et écrivait les dialogues clés.",
		sources: ["Dragon Ball Super (Jump Comics)", "Entretiens croisés Toriyama x Toyotaro"],
	},
	// ── Power Scaling & Niveaux de Puissance ──────────────────────────────────
	{
		id: "multiplicateurs-super-saiyan",
		title: "Multiplicateurs officiels du Super Saiyan (x50, x2, x4)",
		category: "lore",
		tier: "EXTENSION_OFFICIELLE",
		score: 75,
		keywords: [
			"multiplicateur",
			"multiplicateurs",
			"multiplicateur super saiyan",
			"multiplicateur ssj",
			"ssj x50",
			"ssj2 x100",
			"ssj3 x400",
			"multiplicateur ssj2",
			"multiplicateur ssj3",
			"seg multiplicateur",
			"puissance super saiyan",
			"facteur multiplicateur",
		],
		verdict:
			"Officiel selon le Daizenshuu 7 et le Super Exciting Guide (2009). SSJ1 = x50, SSJ2 = x2 de SSJ1 (x100), SSJ3 = x4 de SSJ2 (x400).",
		explanation:
			"Akira Toriyama a précisé qu'en dessinant l'éveil du Super Saiyan, il pensait à une multiplication par 10 car 50 lui semblait démesuré, mais que pour rester cohérent face au Kaio-ken x20 de Goku, les guides officiels de Shueisha ont gravé le multiplicateur par 50. Le Super Exciting Guide (2009) a ensuite complété la hiérarchie : SSJ2 = 2x SSJ1 (x100 de la base) et SSJ3 = 4x SSJ2 (x400 de la base).",
		sources: [
			"Daizenshuu 7 : Dictionnaire de Dragon Ball (p. 83)",
			"Super Exciting Guide : Story Volume (2009)",
			"Entretien Akira Toriyama (Daizenshuu 6)",
		],
	},
	{
		id: "unite-kiri-babidi",
		title: "L'unité Kiri (Babidi) et conversion en Sentōryoku",
		category: "lore",
		tier: "CANON_ABSOLU",
		score: 100,
		keywords: [
			"kiri",
			"unite kiri",
			"kiri babidi",
			"yakon kiri",
			"kiri sentoryoku",
			"conversion kiri",
			"mesure babidi",
		],
		verdict:
			"100% Canon absolu dans le manga (Tome 38). Yakon = 800 Kiri, Goku SSJ2 = 3 000 Kiri. Seuil de destruction planétaire = 200 à 300 Kiri.",
		explanation:
			"Introduit par Akira Toriyama dans l'arc Majin Boo afin de contourner l'inflation astronomique des scouters. Babidi utilise un appareil magique mesurant le ki en Kiri : Yakon absorbe la lumière et atteint 800 Kiri, tandis que Goku passant en SSJ2 sature le compteur à 3 000 Kiri. D'après les calculs éditoriaux du V-Jump (1994), 1 Kiri équivaut à environ 50 000 unités scouter.",
		sources: ["Manga Dragon Ball Tome 38 (Chapitres 450-452)", "V-Jump Décembre 1994"],
	},
	{
		id: "fusion-potara-vs-metamol-puissance",
		title: "Puissance Vegetto (Potara) vs Gogeta (Métamol)",
		category: "lore",
		tier: "EXTENSION_OFFICIELLE",
		score: 75,
		keywords: [
			"potara vs metamol",
			"fusion potara vs metamol",
			"fusion potara vs fusion metamol",
			"fusion potara est superieure",
			"fusion potara superieure",
			"potara superieure",
			"potara est superieure",
			"potara superieure metamol",
			"potara superieure a la fusion metamol",
			"vegetto vs gogeta",
			"vegetto plus fort que gogeta",
			"vegetto est-il plus fort que gogeta",
			"vegetto contre gogeta",
			"gogeta vs vegito",
			"gogeta vs vegetto",
			"gogeta ou vegetto",
			"gogeta ou vegito",
			"gogeta contre vegito",
			"gogeta contre vegetto",
			"comparaison potara metamol",
			"comparaison vegetto gogeta",
			"puissance vegetto vs gogeta",
			"puissance gogeta vs vegetto",
			"puissance gogeta vs vegito",
			"multiplication potara",
			"addition metamol",
			"fusion comparaison puissance",
			"potara ou metamol",
			"potala ou metamol",
			"potala vs metamol",
			"formule potara seg",
		],
		verdict:
			"Le manga établit la supériorité naturelle des Potaras (rivalité + pas d'égalisation imposée). Le Super Exciting Guide formalise une formule de multiplication (A x B).",
		explanation:
			"Dans le manga, le Vieux Kaïoshin affirme que la fusion Potara est supérieure à la danse Métamol : les utilisateurs n'ont pas besoin d'aligner leur puissance sur le plus faible, la fusion dure sans limite de temps pour les mortels à l'époque de Z, et le lien de rivaux de Goku et Vegeta amplifie le résultat. Le Super Exciting Guide (2009) ajoute que l'effet Potara est comparable à une multiplication des forces de combat.",
		sources: [
			"Manga Dragon Ball Tome 42 (Chapitre 504)",
			"Super Exciting Guide : Story Volume (2009)",
			"Daizenshuu 7",
		],
	},
	{
		id: "puissance-goku-ssj1-namek",
		title: "Puissance de Goku SSJ1 sur Namek (150 000 000 BP)",
		category: "lore",
		tier: "EXTENSION_OFFICIELLE",
		score: 75,
		keywords: [
			"150 millions",
			"150 000 000",
			"150m",
			"goku 150 000 000",
			"puissance goku namek",
			"puissance de goku",
			"puissance goku",
			"puissance namek",
			"goku namek",
			"goku ssj namek",
			"freezer 100%",
			"freezer 100%",
			"goku contre freeza",
			"goku super saiyan namek",
			"freeza 120 000 000",
			"sentoryoku goku freeza",
			"battle power namek",
		],
		verdict:
			"Chiffre officiel établi par le Daizenshuu 7 (p. 82-83). Goku SSJ1 = 150 000 000, Freezer 100% = 120 000 000.",
		explanation:
			"Le combat titanesque sur Namek marque le point culminant des mesures chiffrées de la série. Le Daizenshuu 7 a documenté Goku normal sortant du caisson de régénération à 3 000 000 d'unités, son Kaio-ken x20 à 60 000 000, et son Super Saiyan (x50) à 150 000 000, dominant Freezer à son maximum (120 000 000). Au-delà de cet affrontement, Toriyama n'a plus jamais utilisé de chiffres scouter.",
		sources: ["Daizenshuu 7 : Dictionnaire de Dragon Ball (p. 82-83)", "Manga DB Tomes 26-27"],
	},
	{
		id: "arret-scouter-namek-toriyama",
		title: "Abandon des niveaux de puissance chiffrés (Scouters) après Namek",
		category: "lore",
		tier: "CANON_ABSOLU",
		score: 100,
		keywords: [
			"chiffres scouter",
			"arret scouter",
			"abandon scouter",
			"pourquoi plus de chiffres",
			"scouter apres namek",
			"fin des scouters",
			"scouters apres namek",
		],
		verdict:
			"Décision délibérée d'Akira Toriyama : l'inflation des chiffres nuisait à la tension dramatique.",
		explanation:
			"Akira Toriyama a expliqué que le scouter servait d'artifice narratif pour que les guerriers de Freezer sous-estiment les Terriens capables de varier leur ki. Une fois l'éveil du Super Saiyan atteint à 150 000 000, des nombres encore plus colossaux auraient rendu les combats abstraits et prévisibles. L'auteur a donc stoppé les chiffres scouter après Namek pour préserver l'impact émotionnel et visuel.",
		toriyamaQuote: {
			text: "Si la puissance des ennemis continuait à grimper simplement avec des nombres de plus en plus gigantesques, les lecteurs finiraient par perdre tout repère concret.",
			source: "Daizenshuu 6 & entretiens Akira Toriyama",
			year: 1995,
		},
		sources: ["Entretien Akira Toriyama (Daizenshuu 6)", "Daizenshuu 7 (p. 82-83)"],
	},
	{
		id: "beerus-whis",
		title: "Beerus, Whis et la hiérarchie divine",
		category: "character",
		tier: "CANON_SUPERVISE",
		score: 98,
		keywords: [
			"beerus",
			"whis",
			"dieu de la destruction",
			"ange whis",
			"bills",
			"zeno",
			"grand pretre",
			"daishinkan",
			"beerus dort",
			"beerus dort 39 ans",
			"sommeil de beerus",
			"39 ans de sommeil",
			"poisson oracle",
			"reveil de beerus",
			"39 ans",
		],
		verdict: "Canonique. Entièrement imaginés, nommés et dessinés par Akira Toriyama pour Battle of Gods (2013).",
		explanation:
			"Initialement ébauché comme un monstre reptilien infectieux par le premier scénariste de Battle of Gods, Toriyama a intégralement repris le projet en s'inspirant de son propre chat de race Cornish Rex pour Beerus, et a inventé son maître martial Whis. Prédit par la prophétie du Poisson Oracle, le réveil de Beerus après 39 ans de sommeil marque le point de départ de la trame moderne de Dragon Ball à la recherche du Super Saiyan God.",
		toriyamaQuote: {
			text: "Beerus est inspiré de mon chat de quatorze ans, un Cornish Rex. Whis, lui, a été créé pour être son acolyte encore plus fort et mystérieux. Leurs noms viennent de boissons alcoolisées (Beer et Whisky).",
			source: "Entretien Akira Toriyama (Chōzenshū 1, 2013)",
			year: 2013,
		},
		sources: ["Film Battle of Gods (2013)", "Chōzenshū 1", "Manga Dragon Ball Super"],
	},
	{
		id: "super-saiyan-god-blue",
		title: "Super Saiyan God & Super Saiyan Blue (SSGSS)",
		category: "form",
		tier: "CANON_SUPERVISE",
		score: 95,
		keywords: [
			"super saiyan god",
			"super saiyan blue",
			"ssgss",
			"ssjg",
			"ssj god",
			"ssj blue",
			"god saiyan",
			"cheveux rouges goku",
			"cheveux bleus goku",
			"rituel saiyan god",
			"forme divine",
		],
		verdict: "Canon supervisé. Concepts et charadesigns créés par Akira Toriyama.",
		explanation:
			"Toriyama a rejeté le design initial musclé et capé proposé par la Toei pour le Super Saiyan God, choisissant une silhouette affinée aux cheveux magenta. Il a ensuite créé le Super Saiyan Blue (Super Saiyan God Super Saiyan) pour le film La Résurrection de 'F' (2015) en expliquant qu'il s'agit de la puissance d'un dieu insufflée dans un Super Saiyan avec un esprit calme et maîtrisé.",
		sources: ["Film Battle of Gods (2013)", "Film La Résurrection de 'F' (2015)", "Manga DBS"],
	},
	{
		id: "beast-gohan-orange-piccolo",
		title: "Son Gohan Beast & Orange Piccolo",
		category: "form",
		tier: "CANON_SUPERVISE",
		score: 98,
		keywords: ["beast gohan", "gohan beast", "orange piccolo", "piccolo orange", "nouvelle forme gohan", "super hero formes"],
		verdict: "Canonique. Formes créées, nommées et dessinées personnellement par Akira Toriyama pour Super Hero (2022).",
		explanation:
			"Akira Toriyama a écrit le film Dragon Ball Super: Super Hero en plaçant Piccolo et Gohan au premier plan. Il a dessiné Orange Piccolo en hommage à son personnage favori pour lui redonner un niveau équivalent à celui de Son Goku et Vegeta, et a créé Gohan Beast en s'inspirant de l'éveil du jeune Gohan contre Cell.",
		toriyamaQuote: {
			text: "Je suis tellement heureux que Piccolo ait enfin obtenu une puissance équivalente à celle de Goku et des autres. Quant à Gohan Beast, son nom vient du fait que la bête sauvage en lui s'est enfin réveillée.",
			source: "Interview d'Akira Toriyama — Sortie de Dragon Ball Super: Super Hero",
			year: 2022,
		},
		sources: ["Film Dragon Ball Super: Super Hero (2022)", "Manga Dragon Ball Super (Arc Super Hero, Chapitres 96-103)"],
	},
	{
		id: "zalama-super-dragon-balls",
		title: "Zalama & les Super Dragon Balls",
		category: "lore",
		tier: "CANON_SUPERVISE",
		score: 92,
		keywords: ["zalama", "zarama", "dieu dragon zalama", "super dragon balls", "super shenron", "boules de cristal geantes"],
		verdict: "Canon supervisé. Introduit dans Dragon Ball Super par Akira Toriyama.",
		explanation:
			"Zunama et Lord Zuno expliquent en l'An 41 du Calendrier Divin que le Dieu Dragon Zalama a forgé les Super Dragon Balls, des sphères dorées de la taille d'une planète capables d'exaucer absolument n'importe quel vœu sans aucune restriction. Toriyama a personnellement écrit le rituel en langage des dieux (Chant des Dieux) pour invoquer Super Shenron.",
		sources: ["Manga Dragon Ball Super Tome 1 (Chapitres 6-7)", "Série DBS Arc Univers 6"],
	},
	{
		id: "uub-oob",
		title: "Uub (Oob) & le Ki Divin du Grand Kaïoshin",
		category: "character",
		tier: "CANON_ABSOLU",
		score: 100,
		keywords: ["uub", "oob", "reincarnation de buu", "reincarnation de boo", "ki divin uub", "uub moro", "chapitre 519 uub"],
		verdict: "100% Canon absolu. Créé par Toriyama pour la fin du manga original et enrichi dans DBS.",
		explanation:
			"Uub est la réincarnation humaine du Majin Boo originel (Kid Boo), née du souhait pur exprimé par Son Goku avant de l'achever avec le Genkidama (Chapitre 516). Toriyama a consacré la conclusion de son manga (Chapitres 518-519) à la rencontre et au départ de Son Goku pour entraîner Uub. Dans Dragon Ball Super (Chapitre 66), Toyotaro et Toriyama confirment qu'en héritant du corps de Boo, Uub a également hérité du prodigieux Ki Divin du Grand Kaïoshin absorbé cinq millions d'années plus tôt.",
		sources: ["Manga Dragon Ball Tome 42 (Chapitres 516-519)", "Manga Dragon Ball Super Tome 15 (Chapitre 66)"],
	},
	{
		id: "c21-vomi",
		title: "C-21 & Vomi (Épouse du Dr Gero)",
		category: "lore",
		tier: "CANON_SUPERVISE",
		score: 85,
		keywords: ["c21", "c-21", "vomi", "femme du docteur gero", "dr gero femme", "fighterz c21"],
		verdict: "Le personnage de Vomi est canonique (Super Hero) ; le scénario de FighterZ est non-canonique.",
		explanation:
			"C-21 a été créée par Akira Toriyama pour le jeu vidéo Dragon Ball FighterZ (2018). Toriyama a révélé qu'elle était modelée sur l'épouse humaine du Dr Gero, nommée Vomi. Dans le film Dragon Ball Super: Super Hero (2022), Toriyama a officiellement canonisé l'existence de Vomi en l'intégrant dans l'arbre généalogique officiel de la famille du Dr Gero et du Dr Hedo.",
		sources: ["Dragon Ball FighterZ (2018)", "Film Dragon Ball Super: Super Hero (2022)", "V-Jump Janvier 2018"],
	},
	{
		id: "sdbh-heroes",
		title: "Super Dragon Ball Heroes (SDBH) & Xenoverse",
		category: "work",
		tier: "NON_CANON_DERIVE",
		score: 10,
		keywords: ["sdbh", "super dragon ball heroes", "heroes", "xenoverse", "patrouille du temps", "time patrol", "trunks xeno", "goku xeno", "fu", "hearts", "cumber"],
		verdict: "Non-canonique. Jeux d'arcade et anime promotionnel dérivés.",
		explanation:
			"Conçus par Dimps et Bandai Namco avec Toei Animation pour promouvoir le jeu de cartes d'arcade au Japon. Bien que Toriyama ait validé certains charadesigns originaux (comme le Trunks en manteau de la Patrouille du Temps dans Dragon Ball Online), les fusions impossibles (Vegetto SSJ4, Bardock SSJ4, etc.) et les arcs temporels de Heroes sont hors de la continuité canonique.",
		sources: ["Super Dragon Ball Heroes Official Website", "V-Jump Archives", "Dragon Ball Online Lore Notes"],
	},
	{
		id: "dbm-multiverse",
		title: "Dragon Ball Multiverse (DBM)",
		category: "myth",
		tier: "APOCRYPHE_FANON",
		score: 0,
		keywords: ["dbm", "dragon ball multiverse", "salagir", "gogeta jr", "univers 16", "univers 18", "bra ssj2 multiverse", "gast carcolh"],
		verdict: "100% Apocryphe & Fanon. Webcomic amateur créé par Salagir et des fans français.",
		explanation:
			"Créé par Salagir et illustré à l'origine par Gogeta Jr à partir de 2008. Il s'agit de la bande dessinée de fans la plus célèbre au monde, mais elle n'a aucun lien contractuel, éditorial ou légal avec Akira Toriyama, Shueisha ou Bird Studio.",
		sources: ["Site officiel Dragon Ball Multiverse (Fanon)", "Documentation des œuvres de fans"],
	},
	{
		id: "fillers-anime-garlic-paikuhan",
		title: "Fillers de l'anime (Garlic Jr, Paikuhan, Gregory, Maron)",
		category: "work",
		tier: "NON_CANON_DERIVE",
		score: 20,
		keywords: ["garlic jr", "paikuhan", "pikkon", "gregory", "maron", "fausse namek", "permis de conduire goku", "tournoi de l'autre monde", "tournoi des enfers", "filler anime"],
		verdict: "Non-canonique. Épisodes produits par Toei Animation pour ne pas rattraper le manga.",
		explanation:
			"Des arcs entiers (Garlic Jr), des tournois (l'Autre Monde avec Paikuhan) et des personnages secondaires (le grillon Gregory chez Kaio, l'ex-petite amie de Krilin Maron) ont été inventés par les scénaristes de Toei Animation pour meubler le temps d'antenne hebdomadaire. Ils n'apparaissent jamais dans le manga original de Toriyama.",
		sources: ["Manga Dragon Ball (Tomes 1 à 42)", "Daizenshuu 6 (Anime)", "Guide des épisodes Toei"],
	},
	{
		id: "gregory-kaio",
		title: "Gregory (Le grillon de Kaïo)",
		category: "character",
		tier: "NON_CANON_DERIVE",
		score: 20,
		keywords: [
			"gregory",
			"grillon gregory",
			"gregory kaio",
			"gregory est-il dans le manga",
			"gregory manga",
			"gregory canon",
		],
		verdict: "Non-canonique au manga original. Personnage filler conçu pour l'anime Toei.",
		explanation:
			"Le grillon Gregory n'apparaît dans aucune case des 42 tomes du manga original d'Akira Toriyama : sur la planète de Kaïo, seul le singe Bubbles accompagne le maître des lieux. C'est le staff de l'anime Toei qui a demandé un second compagnon pour allonger et combler l'entraînement humoristique de Goku. Akira Toriyama a dessiné son design pour faire plaisir au studio, mais ne l'a jamais inclus dans son manga.",
		sources: ["Manga Dragon Ball (Tomes 18-19)", "Daizenshuu 5 & 6 (Anime)", "Guide des fillers DBZ"],
	},
];

/**
 * Configuration par défaut du Power Scaling officiel canonique.
 */
export const DEFAULT_POWER_SCALING_CONFIG: PowerScalingConfig = {
	enabled: true,
	kiriToBpRate: 50000,
	planetDestructionKiriFloor: 200,
	multipliers: [
		{
			form: "Oozaru (Grand Singe)",
			multiplier: 10,
			baseForm: "Base",
			source: "Manga DB Chapitre 233 & Daizenshuu 7",
			canonTier: "CANON_ABSOLU",
			notes: "Multiplication brute de la puissance du Saiyan possédant sa queue sous les rayons Blutz.",
		},
		{
			form: "Kaio-ken (x2 à x20)",
			multiplier: 2,
			baseForm: "Base",
			source: "Manga DB Chapitres 229 & 315",
			canonTier: "CANON_ABSOLU",
			notes: "Technique de Maître Kaio multipliant force, vitesse et ki d'un facteur exact (jusqu'à x20).",
		},
		{
			form: "Super Saiyan (SSJ1)",
			multiplier: 50,
			baseForm: "Base",
			source: "Daizenshuu 7 (p. 83) & Super Exciting Guide",
			canonTier: "CANON_ABSOLU",
			notes: "Éveil légendaire. Propulse Goku de 3 000 000 à 150 000 000 BP contre Freezer (120 000 000).",
		},
		{
			form: "Super Saiyan 2 (SSJ2)",
			multiplier: 100,
			baseForm: "Base (x2 de SSJ1)",
			source: "Super Exciting Guide : Story Volume (2009)",
			canonTier: "EXTENSION_OFFICIELLE",
			notes: "Dépassement du Super Saiyan initié par Gohan. Double la puissance du SSJ1 (x100 de la base).",
		},
		{
			form: "Super Saiyan 3 (SSJ3)",
			multiplier: 400,
			baseForm: "Base (x4 de SSJ2)",
			source: "Super Exciting Guide : Story Volume (2009)",
			canonTier: "EXTENSION_OFFICIELLE",
			notes: "Extirpation du potentiel caché. Quadruple la puissance du SSJ2 (x400 de la base).",
		},
		{
			form: "Fusion Métamol (Gogeta / Gotenks)",
			multiplier: 0,
			baseForm: "Guerrier A + Guerrier B",
			source: "Daizenshuu 7 & Super Exciting Guide",
			canonTier: "CANON_ABSOLU",
			notes: "Addition des forces après égalisation rigoureuse sur le guerrier le plus faible, puis amplification majeure.",
		},
		{
			form: "Fusion Potara (Vegetto)",
			multiplier: 0,
			baseForm: "Guerrier A x Guerrier B",
			source: "Super Exciting Guide & Daizenshuu 7",
			canonTier: "EXTENSION_OFFICIELLE",
			notes: "Fusion divine sans besoin d'égalisation. Le SEG mentionne une multiplication synergique des forces.",
		},
	],
	officialBps: [
		{ character: "Fermier au fusil", saga: "Saga Saiyans", state: "Normal", bp: 5, scouter: true, source: "Manga Ch. 195", canonTier: "CANON_ABSOLU" },
		{ character: "Son Goku", characterId: 1, saga: "Saga Saiyans", state: "Vêtements lourds", bp: 334, scouter: true, source: "Manga Ch. 199", canonTier: "CANON_ABSOLU" },
		{ character: "Piccolo", saga: "Saga Saiyans", state: "Vêtements lourds", bp: 322, scouter: true, source: "Manga Ch. 199", canonTier: "CANON_ABSOLU" },
		{ character: "Piccolo", saga: "Saga Saiyans", state: "Makankosappo (max)", bp: 1440, scouter: true, source: "Manga Ch. 201", canonTier: "CANON_ABSOLU" },
		{ character: "Son Goku", characterId: 1, saga: "Saga Saiyans", state: "Kamehameha (max)", bp: 924, scouter: true, source: "Manga Ch. 201", canonTier: "CANON_ABSOLU" },
		{ character: "Son Gohan", saga: "Saga Saiyans", state: "Colère contre Raditz", bp: 1307, scouter: true, source: "Manga Ch. 203", canonTier: "CANON_ABSOLU" },
		{ character: "Raditz", saga: "Saga Saiyans", state: "Normal", bp: 1500, scouter: true, source: "Daizenshuu 7 (1200 Manga)", canonTier: "EXTENSION_OFFICIELLE" },
		{ character: "Saibaiman", saga: "Saga Saiyans", state: "Normal", bp: 1200, scouter: true, source: "Manga Ch. 214", canonTier: "CANON_ABSOLU" },
		{ character: "Krilin", saga: "Saga Saiyans", state: "Contre Nappa/Saibaimen", bp: 1770, scouter: true, source: "Daizenshuu 7", canonTier: "EXTENSION_OFFICIELLE" },
		{ character: "Yamcha", saga: "Saga Saiyans", state: "Contre Saibaiman", bp: 1480, scouter: true, source: "Daizenshuu 7", canonTier: "EXTENSION_OFFICIELLE" },
		{ character: "Tenshinhan", saga: "Saga Saiyans", state: "Contre Nappa", bp: 1830, scouter: true, source: "Daizenshuu 7", canonTier: "EXTENSION_OFFICIELLE" },
		{ character: "Chaozu", saga: "Saga Saiyans", state: "Contre Nappa", bp: 610, scouter: true, source: "Daizenshuu 7", canonTier: "EXTENSION_OFFICIELLE" },
		{ character: "Piccolo", saga: "Saga Saiyans", state: "Contre Nappa", bp: 3500, scouter: true, source: "Daizenshuu 7", canonTier: "EXTENSION_OFFICIELLE" },
		{ character: "Nappa", saga: "Saga Saiyans", state: "Normal", bp: 4000, scouter: true, source: "Daizenshuu 7", canonTier: "EXTENSION_OFFICIELLE" },
		{ character: "Son Goku", characterId: 1, saga: "Saga Saiyans", state: "Retour Kaio (calme)", bp: 5000, scouter: true, source: "Manga Ch. 222", canonTier: "CANON_ABSOLU" },
		{ character: "Son Goku", characterId: 1, saga: "Saga Saiyans", state: "Plein pouvoir (over 8000)", bp: 8000, scouter: true, source: "Manga Ch. 224", canonTier: "CANON_ABSOLU" },
		{ character: "Son Goku", characterId: 1, saga: "Saga Saiyans", state: "Kaio-ken x3", bp: 24000, scouter: true, source: "Manga Ch. 229 / Daizenshuu 7", canonTier: "CANON_ABSOLU" },
		{ character: "Son Goku", characterId: 1, saga: "Saga Saiyans", state: "Kaio-ken x4 (Kamehameha)", bp: 32000, scouter: true, source: "Manga Ch. 231 / Daizenshuu 7", canonTier: "CANON_ABSOLU" },
		{ character: "Vegeta", saga: "Saga Saiyans", state: "Normal (sur Terre)", bp: 18000, scouter: true, source: "Manga Ch. 228 / Daizenshuu 7", canonTier: "CANON_ABSOLU" },
		{ character: "Vegeta", saga: "Saga Saiyans", state: "Oozaru (x10)", bp: 180000, scouter: false, source: "Manga Ch. 233 / Daizenshuu 7", canonTier: "EXTENSION_OFFICIELLE" },
		{ character: "Vegeta", saga: "Saga Namek", state: "Zenkai contre Kiwi", bp: 24000, scouter: true, source: "Manga Ch. 249", canonTier: "CANON_ABSOLU" },
		{ character: "Kiwi", saga: "Saga Namek", state: "Normal", bp: 18000, scouter: true, source: "Manga Ch. 249", canonTier: "CANON_ABSOLU" },
		{ character: "Dodoria", saga: "Saga Namek", state: "Normal", bp: 22000, scouter: true, source: "Daizenshuu 7", canonTier: "EXTENSION_OFFICIELLE" },
		{ character: "Zarbon", saga: "Saga Namek", state: "Forme 1", bp: 23000, scouter: true, source: "Daizenshuu 7", canonTier: "EXTENSION_OFFICIELLE" },
		{ character: "Vegeta", saga: "Saga Namek", state: "Zenkai contre Zarbon monstre", bp: 30000, scouter: true, source: "Manga Ch. 265", canonTier: "CANON_ABSOLU" },
		{ character: "Guerriers Nameks", saga: "Saga Namek", state: "Protection du village", bp: 3000, scouter: true, source: "Manga Ch. 253", canonTier: "CANON_ABSOLU" },
		{ character: "Nail", saga: "Saga Namek", state: "Normal", bp: 42000, scouter: true, source: "Manga Ch. 286", canonTier: "CANON_ABSOLU" },
		{ character: "Son Goku", characterId: 1, saga: "Saga Namek", state: "Arrivée Namek (en action)", bp: 90000, scouter: true, source: "Manga Ch. 279 / Daizenshuu 7", canonTier: "CANON_ABSOLU" },
		{ character: "Son Goku", characterId: 1, saga: "Saga Namek", state: "Kaio-ken contre Ginyu", bp: 180000, scouter: true, source: "Manga Ch. 284", canonTier: "CANON_ABSOLU" },
		{ character: "Capitaine Ginyu", saga: "Saga Namek", state: "Plein pouvoir", bp: 120000, scouter: true, source: "Manga Ch. 284", canonTier: "CANON_ABSOLU" },
		{ character: "Freezer", saga: "Saga Namek", state: "Première forme", bp: 530000, scouter: true, source: "Manga Ch. 286", canonTier: "CANON_ABSOLU" },
		{ character: "Freezer", saga: "Saga Namek", state: "Deuxième forme", bp: 1000000, scouter: true, source: "Manga Ch. 296 (plus d'un million)", canonTier: "CANON_ABSOLU" },
		{ character: "Piccolo", saga: "Saga Namek", state: "Fusion avec Nail", bp: 1200000, scouter: false, source: "Daizenshuu 7", canonTier: "EXTENSION_OFFICIELLE" },
		{ character: "Vegeta", saga: "Saga Namek", state: "Zenkai Krilin / Contre Freezer Forme Finale", bp: 2500000, scouter: false, source: "Daizenshuu 7", canonTier: "EXTENSION_OFFICIELLE" },
		{ character: "Son Goku", characterId: 1, saga: "Saga Namek", state: "Zenkai caisson régénération", bp: 3000000, scouter: false, source: "Daizenshuu 7", canonTier: "EXTENSION_OFFICIELLE" },
		{ character: "Son Goku", characterId: 1, saga: "Saga Namek", state: "Kaio-ken x10", bp: 30000000, scouter: false, source: "Daizenshuu 7", canonTier: "EXTENSION_OFFICIELLE" },
		{ character: "Son Goku", characterId: 1, saga: "Saga Namek", state: "Kaio-ken x20 (Kamehameha)", bp: 60000000, scouter: false, source: "Daizenshuu 7", canonTier: "EXTENSION_OFFICIELLE" },
		{ character: "Freezer", saga: "Saga Namek", state: "Forme Finale (50%)", bp: 60000000, scouter: false, source: "Daizenshuu 7", canonTier: "EXTENSION_OFFICIELLE" },
		{ character: "Freezer", saga: "Saga Namek", state: "Forme Finale (100%)", bp: 120000000, scouter: false, source: "Daizenshuu 7", canonTier: "EXTENSION_OFFICIELLE" },
		{ character: "Son Goku", characterId: 1, saga: "Saga Namek", state: "Super Saiyan (SSJ1)", bp: 150000000, scouter: false, source: "Daizenshuu 7 (p. 83)", canonTier: "EXTENSION_OFFICIELLE" },
	],
	tiers: [
		{
			tierNumber: 1,
			name: "Humain d'Élite & Art Martial",
			description: "Guerriers de niveau terrien, maîtres d'arts martiaux et soldats réguliers de l'armée de Freezer.",
			examples: ["Fermier au fusil (5)", "Tortue Géniale au repos (139)", "Son Goku au 21e Tenkaichi Budokai"],
		},
		{
			tierNumber: 2,
			name: "Surhumain / Destructeur de Lune",
			description: "Puissance capable d'oblitérer un satellite naturel (Lune détruite par Roshi et Piccolo à ~140-300 BP).",
			examples: ["Piccolo Makankosappo (1 440)", "Raditz (1 500)", "Saibaimen (1 200)"],
		},
		{
			tierNumber: 3,
			name: "Planétaire / Menace Extraterrestre",
			description: "Capacité prouvée de détruire une planète tellurique de taille standard comme la Terre (Galick Ho de Vegeta à 18 000 BP).",
			examples: ["Vegeta Saga Saiyans (18 000)", "Goku Kaio-ken x3/x4 (24 000 - 32 000)", "Kiwi (18 000)", "Nail (42 000)"],
		},
		{
			tierNumber: 4,
			name: "Stellaire & Empereur Galactique",
			description: "Destruction sans effort de planètes massives (Planète Vegeta, Namek) et résistance dans le vide spatial.",
			examples: ["Freezer Forme 1 (530 000)", "Capitaine Ginyu (120 000)", "Freezer 100% (120 000 000)", "Goku SSJ1 (150 000 000)"],
		},
		{
			tierNumber: 5,
			name: "Cosmique / Majin, Dieux & Au-delà",
			description: "Dépassement du barème scouter chiffré. Échelle en Kiri (Yakon 800, Goku SSJ2 3000), menace sur le Macrocosme entier.",
			examples: ["Gohan SSJ2", "Goku SSJ3", "Super Buu / Kid Buu", "Vegetto", "Beerus", "Whis"],
		},
	],
};

/**
 * Les familles de formulations, consultées quand aucun sujet précis ne répond.
 * Elles donnent un rang probable — jamais un verdict définitif.
 */
const DEFAULT_CANON_HEURISTICS: CanonHeuristic[] = [
	{
		id: "manga-original",
		label: "Renvoi au manga original",
		tier: "CANON_ABSOLU",
		score: 100,
		keywords: [
			"manga original",
			"chapitre",
			"tome 1",
			"tome 42",
			"42 tomes",
			"akira toriyama a dessine",
		],
		verdict: "Fortement présumé 100% Canon absolu.",
		explanation:
			"Les éléments issus directement des 42 volumes du manga original ou des écrits autographes de Toriyama constituent le cœur intouchable du canon Dragon Ball.",
		sources: ["Manga Dragon Ball (Tomes 1 à 42)", "Bird Studio / Shueisha"],
	},
	{
		id: "production-toei",
		label: "Renvoi à la production animée",
		tier: "NON_CANON_DERIVE",
		score: 20,
		keywords: ["filler", "hors-serie", "hors serie", "oav", "episode inedit", "toei"],
		verdict: "Élément dérivé produit pour l'animation sans écriture de Toriyama.",
		explanation:
			"Ces segments appartiennent à la continuité animée Toei Animation et ne sont pas inclus dans l'univers canonique rédigé par Akira Toriyama.",
		sources: ["Archives Toei Animation", "Daizenshuu 6"],
	},
	{
		id: "jeux-video",
		label: "Renvoi aux jeux vidéo",
		tier: "NON_CANON_DERIVE",
		score: 15,
		keywords: ["jeu video", "xenoverse", "kakarot", "budokai", "fighterz", "sdbh", "heroes"],
		verdict: "Contenu de jeu vidéo : hors de la continuité écrite par Toriyama.",
		explanation:
			"Les jeux inventent librement personnages, transformations et scénarios alternatifs. Ils sont officiels commercialement, jamais canoniques narrativement, sauf reprise explicite dans le manga.",
		sources: ["Catalogues éditeurs", "Daizenshuu 7 (Jeux)"],
	},
	{
		id: "supervision-officielle",
		label: "Renvoi aux guides et interviews officielles",
		tier: "EXTENSION_OFFICIELLE",
		score: 85,
		keywords: [
			"daizenshuu",
			"chozenshu",
			"super exciting guide",
			"seg",
			"interview toriyama",
			"entretien toriyama",
			"v-jump",
			"saikyo jump",
			"guide officiel",
		],
		verdict: "Information issue des guides officiels ou déclarations de l'auteur.",
		explanation:
			"Les guides publiés par Shueisha (Daizenshuu, SEG, Chōzenshū) et les entretiens avec Akira Toriyama apportent des précisions et des éclairages canoniques de premier ordre validés par l'auteur.",
		sources: ["Daizenshuu 1-7", "Super Exciting Guide", "Chōzenshū 1-4", "Archives V-Jump & Saikyō Jump"],
	},
	{
		id: "fanon-general",
		label: "Création de fans ou œuvre non officielle",
		tier: "APOCRYPHE_FANON",
		score: 0,
		keywords: [
			"fan manga",
			"fan-manga",
			"fan animation",
			"fan-animation",
			"fan art",
			"dessin de fan",
			"doujin",
			"doujinshi",
			"non officiel",
			"oeuvre de fan",
		],
		verdict: "Création issue de la communauté de fans, sans aucun lien officiel.",
		explanation:
			"Bien que le talent créatif des fans soit immense, ces récits et designs ne font l'objet d'aucune licence ni validation de Bird Studio ou Shueisha. Ils sont classés comme créations de fans (fanon).",
		sources: ["Doctrine de canonicité Shenron"],
	},
	{
		id: "rumeur",
		label: "Rumeur ou fausse citation",
		tier: "APOCRYPHE_FANON",
		score: 0,
		keywords: ["rumeur", "fausse interview", "leak", "fan fiction", "fanfiction", "doujinshi"],
		verdict: "Aucune existence officielle : rumeur ou création de fans.",
		explanation:
			"Une affirmation sans support imprimé, sans interview datée et sans source éditeur ne vaut rien face au manga. Elle n'est citable que pour expliquer d'où vient la rumeur.",
		sources: ["Manga Dragon Ball", "Daizenshuu 1-7"],
	},
];

/** Les règles générales jointes à chaque verdict rendu. */
const DEFAULT_CANON_DOCTRINE: string[] = [
	"Source de vérité suprême : le manga original en 42 tomes d'Akira Toriyama.",
	"Validité secondaire : révélations SEG / Daizenshuu et scripts originaux (Broly, Super Hero, Daima).",
	"Règle de séparation : les fillers et les films Toei des années 90 sont des dimensions alternatives.",
	"En cas de contradiction entre deux sources, la plus proche de la main de Toriyama l'emporte.",
	"Une affirmation sans source imprimée n'est pas fausse : elle est non établie. On le dit plutôt que de trancher.",
];

export const DEFAULT_CANON_CONFIG: CanonConfig = {
	version: 1,
	intro:
		"Pose une question de canonicité : le verdict vient d'une table curée à la main, adossée au manga, aux databooks et aux déclarations d'Akira Toriyama. Aucun wiki de fans, aucune génération automatique.",
	placeholder: "Broly est-il canonique ?",
	doctrine: DEFAULT_CANON_DOCTRINE,
	sourcesAdmises: [
		"Manga Dragon Ball, tomes 1 à 42 (édition japonaise et traduction officielle)",
		"Dragon Ball Super (manga) et Dragon Ball Minus / Jaco",
		"Daizenshuu 1 à 7, Chōzenshū, Super Exciting Guide et guides Shueisha",
		"Interviews et Q&A signés d'Akira Toriyama (V-Jump, Saikyō Jump, Dragon Box)",
		"Catalogues des éditeurs, AniList et Jikan pour les métadonnées de sortie",
	],
	sourcesInterdites: [
		"Wikis de fans (Fandom, miroirs et copies)",
		"Forums, réseaux sociaux et « leaks » non sourcés",
		"Fausses interviews et citations non datées",
		"Réponses générées par un modèle de langage sans source imprimée",
	],
	tiers: DEFAULT_CANON_TIERS,
	entries: CANON_DATABASE,
	heuristics: DEFAULT_CANON_HEURISTICS,
	// Vide par défaut : le corpus se charge depuis `.aphrody` (voir
	// `scripts/canon-ingest.ts`), il n'est pas recopié dans le dépôt.
	references: [],
	powerScaling: DEFAULT_POWER_SCALING_CONFIG,
	fallback: {
		tier: "EXTENSION_OFFICIELLE",
		score: 50,
		verdict: "Affirmation nécessitant une vérification croisée dans les archives.",
		explanation:
			"Le sujet saisi ne correspond à aucun point de divergence répertorié. Dans la doctrine Shenron, une affirmation sans source manga, databook vérifié ou déclaration signée de Toriyama est considérée comme non établie.",
		sources: ["Manga Dragon Ball", "Daizenshuu 1-7", "Super Exciting Guide"],
	},
	vide: {
		verdict: "Saisis un texte, un personnage, un film ou une affirmation.",
		explanation:
			"Le moteur analysera sa canonicité selon les règles du manga, des databooks et des déclarations de l'auteur — telles qu'elles sont écrites dans les paramètres du site.",
	},
};

// ── Normalisation et appariement ────────────────────────────────────────────

/**
 * Minuscules sans accents.
 *
 * Normalise en NFKC (compatibilité pleine chasse / zenkaku, ponctuation
 * japonaise et chiffres pleine chasse ramenés à leur forme standard), retire les
 * diacritiques combinants latins/grecs (U+0300–U+036F) tout en préservant intact
 * le dakuten japonais (recombiné en NFC), sans quoi `が` deviendrait `か`.
 */
function normaliser(texte: string): string {
	if (!/[^\p{ASCII}]/u.test(texte)) {
		return texte.toLowerCase();
	}
	return texte
		.normalize("NFKC")
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.normalize("NFC");
}

const CARACTERE_DE_MOT = /[\p{L}\p{N}]/u;
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

/**
 * Cherche un mot-clé **entier** dans un texte déjà normalisé.
 *
 * L'appariement par simple `includes` faisait répondre « GT » à « magtruc » et
 * « OAV » à n'importe quel mot qui contient ces trois lettres. On exige donc que
 * les bords du mot-clé ne soient pas collés à une lettre ou un chiffre.
 *
 * Pour les écritures CJK (japonais sans espaces) ou les frontières script
 * latin / CJK, la frontière est naturellement assurée par le changement de script.
 */
function contientMotCle(texte: string, motCle: string): boolean {
	const cle = normaliser(motCle).trim();
	if (!cle) return false;
	const isCjk = CJK.test(cle);
	for (let i = texte.indexOf(cle); i !== -1; i = texte.indexOf(cle, i + 1)) {
		if (isCjk) return true;
		const avant = texte[i - 1];
		if (avant !== undefined && CARACTERE_DE_MOT.test(avant) && !CJK.test(avant)) continue;
		// Le pluriel ne change pas le sujet : « planete » répond à « planetes ».
		// Un seul `s` toléré, et seulement en fin de mot — au-delà, c'est un autre
		// mot qui commence par le mot-clé.
		let fin = i + cle.length;
		if (texte[fin] === "s") fin++;
		const apres = texte[fin];
		if (apres !== undefined && CARACTERE_DE_MOT.test(apres) && !CJK.test(apres)) continue;
		return true;
	}
	return false;
}

/**
 * Combien de citations partagent chaque mot-clé. « goku » apparaît dans la
 * moitié du corpus et ne distingue rien ; « kamehameha » désigne une réponse
 * précise. Sans cette pondération, une question pointue remontait les trois
 * citations les plus bavardes sur le personnage cité.
 *
 * Le calcul balaie tout le corpus (plusieurs milliers de citations chargées
 * depuis `.aphrody`) : il est mémoïsé sur le tableau lui-même, qui est figé pour
 * la durée d'une doctrine résolue. Sans cela, chaque question posée le refaisait
 * — jusqu'à trois fois pour un même verdict.
 */
const FREQUENCES = new WeakMap<readonly CanonReference[], Map<string, number>>();

function frequenceMotsCles(references: readonly CanonReference[]): Map<string, number> {
	const connue = FREQUENCES.get(references);
	if (connue) return connue;
	const frequence = new Map<string, number>();
	for (const r of references) {
		for (const kw of new Set(r.keywords.map((k) => normaliser(k)))) {
			frequence.set(kw, (frequence.get(kw) ?? 0) + 1);
		}
	}
	FREQUENCES.set(references, frequence);
	return frequence;
}

/**
 * Les déclarations d'auteur qui parlent du sujet posé, les plus précises d'abord.
 *
 * Le classement se fait sur la **longueur cumulée** des mots-clés reconnus et
 * non sur leur nombre : « broly » pèse plus que trois mots passe-partout comme
 * « manga », « histoire » et « dessin », qui apparaissent dans la moitié du
 * corpus. Une référence dont aucun mot-clé ne dépasse trois lettres est écartée
 * — elle ne s'apparie que par hasard.
 */
export function referencesPour(
	texteNormalise: string,
	config: CanonConfig,
	motsDuSujet: string[] = [],
	maximum = 3
): CanonReference[] {
	if (config.references.length === 0) return [];
	const sujet = new Set(motsDuSujet.map((m) => normaliser(m)));

	const frequence = frequenceMotsCles(config.references);

	const notes: { reference: CanonReference; poids: number }[] = [];

	for (const reference of config.references) {
		let poids = 0;
		let motSolide = false;
		for (const kw of reference.keywords) {
			if (!contientMotCle(texteNormalise, kw)) continue;
			const rarete = 1 / Math.log2(2 + (frequence.get(normaliser(kw)) ?? 1));
			poids += kw.length * rarete;
			if (kw.length > 3) motSolide = true;
			// Un mot-clé que le verdict a lui-même reconnu désigne le sujet, pas le
			// vocabulaire commun : il compte double.
			if (sujet.has(normaliser(kw))) poids += kw.length;
		}
		if (poids > 0 && motSolide) notes.push({ reference, poids });
	}

	// Un même sujet est souvent porté deux fois par le corpus : la citation de
	// l'auteur et la synthèse de la section qui l'entoure. Deux fois le même
	// titre sous un verdict donne l'impression d'un bégaiement, pas d'une preuve
	// de plus — on garde la mieux notée.
	const sujetsVus = new Set<string>();
	const retenues: CanonReference[] = [];
	for (const { reference } of notes.toSorted(
		(a, b) => b.poids - a.poids || a.reference.text.length - b.reference.text.length
	)) {
		const cle = normaliser(reference.subject);
		if (cle && sujetsVus.has(cle)) continue;
		sujetsVus.add(cle);
		retenues.push(reference);
		if (retenues.length >= maximum) break;
	}
	return retenues;
}

function rangConfig(config: CanonConfig, tier: CanonTier): CanonTierConfig {
	return (
		config.tiers.find((t) => t.id === tier) ??
		DEFAULT_CANON_TIERS.find((t) => t.id === tier) ??
		DEFAULT_CANON_TIERS[0]!
	);
}

// ── Trolls, vraies questions, suggestions ───────────────────────────────────

/**
 * Franchises that have no crossover with Dragon Ball in any official source.
 * « Goku vs Superman » is a playground debate, not a canonicity question.
 */
const HORS_UNIVERS =
	/\b(superman|batman|thanos|hulk|marvel|dc comics|saitama|one punch|naruto|sasuke|luffy|one piece|ichigo|bleach|jotaro|jojo|sonic|mario|pikachu|pokemon|kirby|shrek|chuck norris|jesus|kratos|sung jin[- ]?woo|solo leveling|madara|aizen|gojo|sukuna|saiki|anos|rimuru|zeno[- ]?sama vs)\b/;

/** Forms and numbers no source prints. Super Saiyan 5 is a ruled topic (apocryphal); 6 and beyond is noise. */
const FORMES_INVENTEES =
	/\b(super saiya(?:n|jin)?|ssj|ssgss|ss)\s*(?:niveau\s*)?(?:[6-9]|[1-9]\d+|infini|infinity|omega|rainbow|arc[- ]?en[- ]?ciel|noir|black rose|god of god)\b|\bunivers\s*(?:1[3-9]|[2-9]\d)\b|\bultra ego instinct\b|\bgoku (?:solo|solos)\b|\bsolo (?:l'|le |la )?(?:univers|multivers|verse)\b/;

/** Insults, vulgarity, and the « you are a bot » genre. Kept coarse on purpose. */
const INSULTES =
	/\b(fdp|ntm|nique|niquer|enculer?|encule|pd|batard|connard|connasse|salope|pute|merde|chier|bite|couilles|caca|pipi|prout|zizi|t'?es nul|site de merde|ta gueule|tg|fuck|shit|bitch|dick|penis|sex|sexe|porn|porno|hentai|nude|nu[e]?s? de|baiser)\b/;

/** Off-topic real-world questions: politics, weather, homework. */
const HORS_SUJET =
	/\b(macron|trump|poutine|election|politique|meteo|météo|recette|bitcoin|crypto|capitale de|equation|équation|devoir de maths|chatgpt|openai|claude|gemini|ia generative)\b/;

/**
 * Is the input a troll, a joke, or plain off-topic? Returns the reason, so the
 * answer can say what it detected instead of a generic refusal.
 *
 * The test order matters: an insult wrapped around a real question is still
 * refused (the corpus is not a punching bag), but a real Dragon Ball question
 * that merely mentions a rival franchise is a crossover, not vulgarity.
 */
function detecterTroll(texteNormalise: string): string | null {
	const t = ` ${texteNormalise.replace(/[^\p{L}\p{N}' ]+/gu, " ").replace(/\s+/g, " ").trim()} `;
	if (INSULTES.test(t)) return "vulgarite";
	if (HORS_UNIVERS.test(t)) return "crossover";
	if (FORMES_INVENTEES.test(t)) return "invention";
	if (HORS_SUJET.test(t)) return "hors-sujet";
	// Keyboard mashing: no vowel in a long token, or one letter repeated.
	// Ne s'applique pas aux mots CJK qui n'utilisent pas de voyelles latines.
	const mots = t.trim().split(" ");
	const charabia = mots.filter(
		(m) => m.length >= 7 && !CJK.test(m) && !/[aeiouy]/.test(m) && !/\d/.test(m)
	);
	if (mots.length > 0 && charabia.length >= Math.max(1, Math.ceil(mots.length / 2))) return "charabia";
	if (/(.)\1{5,}/.test(t)) return "charabia";
	return null;
}

const MARQUEURS_QUESTION =
	/\b(qui est|qui a|qui sont|quel(?:le|s|les)? (?:est|sont|age|âge)|c'?est quoi|qu'?est[- ]ce|pourquoi|comment|combien|quand|ou est|où est|peut[- ]il|peut[- ]elle|peuvent|bat(?:trait)?|vs|contre|plus fort|plus puissant|le plus|la plus|gagne(?:rait)?|est[- ]il|est[- ]elle|sont[- ]ils|sont[- ]elles|a[- ]t[- ]il|a[- ]t[- ]elle)\b/;

/** Does the input read as a real question rather than an assertion to rule on? */
function ressembleAUneQuestion(texteNormalise: string): boolean {
	return /[?？]+[\s.!]*$/.test(texteNormalise.trim()) || MARQUEURS_QUESTION.test(` ${texteNormalise} `);
}

/**
 * Ruled topics that share a word with the input, best first. Offered as the
 * next question to ask: the doctrine cannot rule on what it has no entry for,
 * but it can point to what it has.
 */
function suggestionsPour(
	texteNormalise: string,
	config: CanonConfig,
	exclure: string | null = null,
	maximum = 4
): string[] {
	const mots = new Set(
		texteNormalise
			.split(/[^\p{L}\p{N}]+/u)
			.filter((m) => m.length > 2 && !MOTS_VIDES.has(m))
	);
	const notes: { titre: string; poids: number }[] = [];
	for (const entree of config.entries) {
		if (entree.id === exclure) continue;
		let poids = 0;
		for (const kw of entree.keywords) {
			const cle = normaliser(kw);
			if (contientMotCle(texteNormalise, kw)) poids += kw.length;
			else if (mots.has(cle)) poids += 2;
		}
		for (const m of mots) if (contientMotCle(normaliser(entree.title), m)) poids += m.length;
		if (poids > 0) notes.push({ titre: entree.title, poids });
	}
	if (notes.length === 0 && exclure) {
		// Nothing shares a word with a ruled topic: offer the topics of the same
		// family (a character next to a character, a form next to a form).
		const categorie = config.entries.find((e) => e.id === exclure)?.category;
		return config.entries
			.filter((e) => e.id !== exclure && e.category === categorie)
			.slice(0, maximum)
			.map((e) => e.title);
	}
	return notes
		.toSorted((a, b) => b.poids - a.poids)
		.slice(0, maximum)
		.map((n) => n.titre);
}

const MOTS_VIDES = new Set([
	"est",
	"les",
	"des",
	"une",
	"que",
	"qui",
	"dans",
	"pour",
	"pas",
	"sur",
	"avec",
	"son",
	"ses",
	"the",
	"and",
	"canon",
	"canonique",
	"vrai",
	"faux",
	"officiel",
	"dragon",
	"ball",
]);

const TROLL_EXPLICATIONS: Record<string, string> = {
	vulgarite:
		"La question contient des termes qui ne figurent dans aucun manga, databook ni déclaration d'auteur. L'arbitre ne tranche que ce que les sources contiennent.",
	crossover:
		"Aucune source officielle ne met Dragon Ball face à une autre franchise. Un combat entre deux œuvres n'a ni vainqueur ni rang de canonicité : il n'existe pas.",
	invention:
		"Cette forme, ce niveau ou cet univers n'apparaît dans aucun manga, film, databook ni déclaration d'Akira Toriyama. Ce qui n'est imprimé nulle part n'a pas de rang : c'est une invention.",
	"hors-sujet":
		"La question ne porte pas sur Dragon Ball. L'arbitre lit le manga, les databooks et les mots de l'auteur, rien d'autre.",
	charabia: "Le texte saisi ne forme pas une question lisible.",
};

// ── Analyse ─────────────────────────────────────────────────────────────────

/**
 * Analyse un texte ou une question et rend un verdict de canonicité.
 *
 * `config` vient de la base via `getCanonConfig()` ; l'appel sans configuration
 * retombe sur la doctrine livrée avec le dépôt.
 */
export function analyzeCanon(
	input: string,
	rawConfig: CanonConfig = DEFAULT_CANON_CONFIG
): CanonAnalysisResult {
	const config: CanonConfig = {
		...DEFAULT_CANON_CONFIG,
		...rawConfig,
		entries: Array.isArray(rawConfig?.entries) ? rawConfig.entries : DEFAULT_CANON_CONFIG.entries,
		doctrine: Array.isArray(rawConfig?.doctrine) ? rawConfig.doctrine : DEFAULT_CANON_CONFIG.doctrine,
		tiers: rawConfig?.tiers ?? DEFAULT_CANON_CONFIG.tiers,
		vide: rawConfig?.vide ?? DEFAULT_CANON_CONFIG.vide,
	};
	const texte = normaliser(input.trim());
	if (!texte) {
		return {
			tier: "CANON_ABSOLU",
			tierLabel: "En attente d'analyse",
			score: 0,
			color: "#9ca3af",
			verdict: config.vide.verdict,
			explanation: config.vide.explanation,
			sources: [],
			matchedKeywords: [],
			origine: "empty",
			nature: "empty",
			suggestions: [],
		};
	}

	// 0. Trolls, crossovers, inventions, hors-sujet : on le dit, avec la raison,
	//    et on propose les sujets voisins qui existent vraiment.
	const troll = detecterTroll(texte);
	if (troll) {
		const rang = rangConfig(config, "APOCRYPHE_FANON");
		return {
			tier: "APOCRYPHE_FANON",
			tierLabel: troll === "charabia" ? "Illisible" : "Hors des sources",
			score: 0,
			color: rang.couleur,
			verdict:
				troll === "charabia"
					? "Rien à trancher : la question n'est pas lisible."
					: "Aucune source ne contient cela. Pas de rang, pas de verdict.",
			explanation: TROLL_EXPLICATIONS[troll] ?? TROLL_EXPLICATIONS["hors-sujet"]!,
			sources: [],
			matchedKeywords: [],
			doctrineRules: config.doctrine,
			tierDefinition: rang.definition,
			origine: `troll:${troll}`,
			nature: "troll",
			suggestions: suggestionsPour(texte, config, null, 4),
			references: [],
		};
	}

	// 1. Les sujets tranchés. Le meilleur score l'emporte ; à égalité, le premier
	//    dans l'ordre de la table (l'admin range du plus spécifique au plus large).
	let meilleure: CanonTopicEntry | null = null;
	let meilleurScore = 0;
	let motsTrouves: string[] = [];

	for (const entree of config.entries) {
		let score = 0;
		const mots: string[] = [];
		for (const kw of entree.keywords) {
			if (contientMotCle(texte, kw)) {
				score += kw.length * 2;
				mots.push(kw);
			}
		}
		if (entree.title && contientMotCle(texte, entree.title)) {
			score += normaliser(entree.title) === texte ? 50 : Math.min(50, entree.title.length * 2);
		}
		if (score > meilleurScore) {
			meilleurScore = score;
			meilleure = entree;
			motsTrouves = mots;
		}
	}

	if (meilleure) {
		const rang = rangConfig(config, meilleure.tier);
		return {
			tier: meilleure.tier,
			tierLabel: rang.label,
			score: meilleure.score,
			color: rang.couleur,
			verdict: meilleure.verdict,
			explanation: meilleure.explanation,
			toriyamaQuote: meilleure.toriyamaQuote,
			sources: meilleure.sources,
			matchedKeywords: [...new Set(motsTrouves)],
			doctrineRules: config.doctrine,
			tierDefinition: rang.definition,
			origine: `entry:${meilleure.id}`,
			nature: "verdict",
			suggestions: suggestionsPour(texte, config, meilleure.id, 3),
			references: referencesPour(texte, config, meilleure.keywords),
		};
	}

	// 2. Les familles de formulations. Comme pour les entrées, c'est la
	//    formulation la mieux appariée qui l'emporte et non la première déclarée :
	//    « ce chapitre filler de Xenoverse » touchait « chapitre » (renvoi au
	//    manga original, rang 1) avant « filler » et « xenoverse », et rendait
	//    donc un verdict « canon absolu » sur du contenu dérivé. L'appariement le
	//    plus long — le plus spécifique — décide ; à égalité, l'ordre de la table.
	let meilleureRegle: CanonHeuristic | null = null;
	let meilleurScoreRegle = 0;
	let motsRegle: string[] = [];

	for (const regle of config.heuristics) {
		let score = 0;
		const mots: string[] = [];
		for (const kw of regle.keywords) {
			if (!contientMotCle(texte, kw)) continue;
			score += kw.length;
			mots.push(kw);
		}
		if (score > meilleurScoreRegle) {
			meilleurScoreRegle = score;
			meilleureRegle = regle;
			motsRegle = mots;
		}
	}

	if (meilleureRegle) {
		const rang = rangConfig(config, meilleureRegle.tier);
		return {
			tier: meilleureRegle.tier,
			tierLabel: rang.label,
			score: meilleureRegle.score,
			color: rang.couleur,
			verdict: meilleureRegle.verdict,
			explanation: meilleureRegle.explanation,
			sources: meilleureRegle.sources,
			matchedKeywords: [...new Set(motsRegle)],
			doctrineRules: config.doctrine,
			tierDefinition: rang.definition,
			origine: `heuristic:${meilleureRegle.id}`,
			nature: "verdict",
			suggestions: suggestionsPour(texte, config, null, 3),
			references: referencesPour(texte, config, motsRegle),
		};
	}

	// 3. On ne sait pas, et on le dit. Une vraie question (« qui est le plus
	//    fort ? », « pourquoi… ? ») n'est pas une affirmation à classer : on la
	//    reçoit comme telle et on répond avec le corpus, sans rang.
	const rang = rangConfig(config, config.fallback.tier);
	const question = ressembleAUneQuestion(texte);
	return {
		tier: config.fallback.tier,
		tierLabel: question ? "Question ouverte" : "À vérifier dans le corpus",
		score: config.fallback.score,
		color: rang.couleur,
		verdict: question
			? "La doctrine n'a pas tranché ce point. Voici ce que les sources en disent."
			: config.fallback.verdict,
		explanation: question
			? "Aucun sujet tranché ne couvre cette question. Les planches de databooks, les fiches du wiki et les déclarations d'auteur ci-dessous sont ce que le corpus contient sur ce sujet ; rien n'y est ajouté."
			: config.fallback.explanation,
		sources: config.fallback.sources,
		matchedKeywords: [],
		doctrineRules: config.doctrine,
		tierDefinition: rang.definition,
		origine: "fallback",
		nature: question ? "question" : "verdict",
		suggestions: suggestionsPour(texte, config, null, 4),
		// Même sans verdict, le corpus peut porter la phrase qui tranche : c'est
		// souvent tout ce que le lecteur cherchait.
		references: referencesPour(texte, config),
	};
}

function getTierLabel(tier: CanonTier, config: CanonConfig = DEFAULT_CANON_CONFIG): string {
	return rangConfig(config, tier).label;
}

function getTierColor(tier: CanonTier, config: CanonConfig = DEFAULT_CANON_CONFIG): string {
	return rangConfig(config, tier).couleur;
}

// ── Résolution défensive du document stocké ─────────────────────────────────

const CATEGORIES = new Set<CanonTopicEntry["category"]>(["character", "form", "lore", "work", "myth"]);
const COULEUR_HEX = /^#[0-9a-f]{3,8}$/i;

/**
 * Bornes de cardinalité du document.
 *
 * Chaque champ était déjà borné en longueur, mais rien ne limitait le **nombre**
 * d'éléments : un PUT admin malformé (ou un chargeur de corpus emballé) pouvait
 * écrire un jsonb sans fin, que `/wiki/canon` relit et balaie entièrement à
 * chaque question. Au-delà de ces bornes, le surplus est ignoré à l'écriture.
 */
const MAX_ENTREES = 2000;
const MAX_REGLES = 500;
const MAX_REFERENCES = 20000;

function texteCourt(v: unknown, max: number, defaut: string): string {
	return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : defaut;
}

function listeDeTextes(v: unknown, maxItems: number, maxLen: number): string[] | null {
	if (!Array.isArray(v)) return null;
	const out: string[] = [];
	for (const item of v) {
		if (typeof item !== "string") continue;
		const t = item.trim().slice(0, maxLen);
		if (t && !out.includes(t)) out.push(t);
		if (out.length >= maxItems) break;
	}
	return out;
}

function scoreValide(v: unknown, defaut: number): number {
	if (typeof v !== "number" || !Number.isFinite(v)) return defaut;
	return Math.min(100, Math.max(0, Math.round(v)));
}

function citation(v: unknown): CanonQuote | undefined {
	if (!v || typeof v !== "object") return undefined;
	const q = v as Record<string, unknown>;
	const text = typeof q.text === "string" ? q.text.trim().slice(0, 2000) : "";
	if (!text) return undefined;
	const source = typeof q.source === "string" ? q.source.trim().slice(0, 300) : "";
	const annee = typeof q.year === "number" && Number.isFinite(q.year) ? Math.round(q.year) : undefined;
	return { text, source, ...(annee ? { year: annee } : {}) };
}

/** `Broly ?` → `broly`. Un identifiant stable, lisible, sans accent. */
export function slugCanon(source: string, secours: string): string {
	const slug = normaliser(source)
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 60);
	return slug || secours;
}

/**
 * Fusionne un document venu de la base avec les défauts du dépôt.
 *
 * Aucune confiance n'est accordée au contenu stocké : chaque champ est retypé,
 * borné et, s'il manque, remplacé par le défaut. Un document vide rend donc la
 * doctrine livrée avec le code — jamais une page cassée.
 *
 * Un tableau explicitement vide, lui, est respecté : effacer toutes les entrées
 * est une décision d'administrateur, pas une erreur de lecture.
 */
export function resolveCanonConfig(patch: unknown): CanonConfig {
	const d = DEFAULT_CANON_CONFIG;
	if (!patch || typeof patch !== "object") return structuredClone(d);
	const p = patch as Record<string, unknown>;

	const tiers: CanonTierConfig[] = DEFAULT_CANON_TIERS.map((defaut) => {
		const brut = Array.isArray(p.tiers)
			? (p.tiers as unknown[]).find(
					(t) => t && typeof t === "object" && (t as Record<string, unknown>).id === defaut.id
				)
			: undefined;
		if (!brut) return structuredClone(defaut);
		const t = brut as Record<string, unknown>;
		const couleur = typeof t.couleur === "string" && COULEUR_HEX.test(t.couleur.trim())
			? t.couleur.trim()
			: defaut.couleur;
		return {
			id: defaut.id,
			label: texteCourt(t.label, 200, defaut.label),
			court: texteCourt(t.court, 60, defaut.court),
			couleur,
			score: scoreValide(t.score, defaut.score),
			definition: texteCourt(t.definition, 2000, defaut.definition),
			inclut: listeDeTextes(t.inclut, 24, 300) ?? structuredClone(defaut.inclut),
		};
	});

	const entries: CanonTopicEntry[] = [];
	if (Array.isArray(p.entries)) {
		const vus = new Set<string>();
		for (const brut of p.entries as unknown[]) {
			if (entries.length >= MAX_ENTREES) break;
			if (!brut || typeof brut !== "object") continue;
			const e = brut as Record<string, unknown>;
			const title = texteCourt(e.title, 200, "");
			const keywords = listeDeTextes(e.keywords, 40, 80) ?? [];
			// Sans titre ni mot-clé, l'entrée ne peut ni s'apparier ni s'afficher.
			if (!title || keywords.length === 0) continue;
			let id = slugCanon(texteCourt(e.id, 60, "") || title, `entree-${entries.length + 1}`);
			while (vus.has(id)) id = `${id}-2`;
			vus.add(id);
			const tier = isCanonTier(e.tier) ? e.tier : "EXTENSION_OFFICIELLE";
			const category = CATEGORIES.has(e.category as CanonTopicEntry["category"])
				? (e.category as CanonTopicEntry["category"])
				: "lore";
			const quote = citation(e.toriyamaQuote);
			entries.push({
				id,
				title,
				category,
				tier,
				score: scoreValide(e.score, tiers.find((t) => t.id === tier)?.score ?? 50),
				keywords,
				verdict: texteCourt(e.verdict, 600, ""),
				explanation: texteCourt(e.explanation, 4000, ""),
				...(quote ? { toriyamaQuote: quote } : {}),
				sources: listeDeTextes(e.sources, 20, 300) ?? [],
			});
		}
	}

	const heuristics: CanonHeuristic[] = [];
	if (Array.isArray(p.heuristics)) {
		const vus = new Set<string>();
		for (const brut of p.heuristics as unknown[]) {
			if (heuristics.length >= MAX_REGLES) break;
			if (!brut || typeof brut !== "object") continue;
			const h = brut as Record<string, unknown>;
			const keywords = listeDeTextes(h.keywords, 40, 80) ?? [];
			if (keywords.length === 0) continue;
			const label = texteCourt(h.label, 200, "Règle sans nom");
			let id = slugCanon(texteCourt(h.id, 60, "") || label, `regle-${heuristics.length + 1}`);
			while (vus.has(id)) id = `${id}-2`;
			vus.add(id);
			const tier = isCanonTier(h.tier) ? h.tier : "EXTENSION_OFFICIELLE";
			heuristics.push({
				id,
				label,
				tier,
				score: scoreValide(h.score, tiers.find((t) => t.id === tier)?.score ?? 50),
				keywords,
				verdict: texteCourt(h.verdict, 600, ""),
				explanation: texteCourt(h.explanation, 4000, ""),
				sources: listeDeTextes(h.sources, 20, 300) ?? [],
			});
		}
	}

	const references: CanonReference[] = [];
	if (Array.isArray(p.references)) {
		const vus = new Set<string>();
		for (const brut of p.references as unknown[]) {
			if (references.length >= MAX_REFERENCES) break;
			if (!brut || typeof brut !== "object") continue;
			const r = brut as Record<string, unknown>;
			const text = texteCourt(r.text, 4000, "");
			const keywords = listeDeTextes(r.keywords, 24, 80) ?? [];
			// Sans texte ni mot-clé, une référence ne prouve rien et ne sort jamais.
			if (!text || keywords.length === 0) continue;
			const subject = texteCourt(r.subject, 300, "");
			let id = slugCanon(texteCourt(r.id, 80, "") || subject, `reference-${references.length + 1}`);
			while (vus.has(id)) id = `${id}-2`;
			vus.add(id);
			const annee =
				typeof r.year === "number" && Number.isFinite(r.year) ? Math.round(r.year) : undefined;
			const textFr = texteCourt(r.textFr, 4000, "");
			references.push({
				id,
				subject,
				keywords,
				text,
				...(textFr ? { textFr } : {}),
				source: texteCourt(r.source, 300, ""),
				...(annee ? { year: annee } : {}),
				document: texteCourt(r.document, 300, ""),
				lang: r.lang === "en" || r.lang === "ja" ? r.lang : "fr",
				provenance:
					r.provenance === "manuel" || r.provenance === "databooks" || r.provenance === "manga"
						? r.provenance
						: "aphrody",
				// Une route interne, et rien d'autre : cette valeur devient un `href`.
				...(typeof r.href === "string" && /^\/[\w/#?=&.-]*$/.test(r.href)
					? { href: r.href.slice(0, 300) }
					: {}),
			});
		}
	}

	const fb = (p.fallback && typeof p.fallback === "object" ? p.fallback : {}) as Record<
		string,
		unknown
	>;
	const vide = (p.vide && typeof p.vide === "object" ? p.vide : {}) as Record<string, unknown>;

	const ps = (p.powerScaling && typeof p.powerScaling === "object"
		? p.powerScaling
		: {}) as Record<string, unknown>;
	const defPs = DEFAULT_POWER_SCALING_CONFIG;
	const powerScaling: PowerScalingConfig = {
		enabled: typeof ps.enabled === "boolean" ? ps.enabled : defPs.enabled,
		kiriToBpRate:
			typeof ps.kiriToBpRate === "number" && Number.isFinite(ps.kiriToBpRate) && ps.kiriToBpRate > 0
				? ps.kiriToBpRate
				: defPs.kiriToBpRate,
		planetDestructionKiriFloor:
			typeof ps.planetDestructionKiriFloor === "number" &&
			Number.isFinite(ps.planetDestructionKiriFloor) &&
			ps.planetDestructionKiriFloor > 0
				? ps.planetDestructionKiriFloor
				: defPs.planetDestructionKiriFloor,
		multipliers: Array.isArray(ps.multipliers) ? (ps.multipliers as PowerScalingMultiplier[]) : structuredClone(defPs.multipliers),
		officialBps: Array.isArray(ps.officialBps) ? (ps.officialBps as OfficialBattlePower[]) : structuredClone(defPs.officialBps),
		tiers: Array.isArray(ps.tiers) ? (ps.tiers as PowerScalingTier[]) : structuredClone(defPs.tiers),
	};

	return {
		version: 1,
		intro: texteCourt(p.intro, 1000, d.intro),
		placeholder: texteCourt(p.placeholder, 120, d.placeholder),
		doctrine: listeDeTextes(p.doctrine, 16, 400) ?? structuredClone(d.doctrine),
		sourcesAdmises: listeDeTextes(p.sourcesAdmises, 24, 300) ?? structuredClone(d.sourcesAdmises),
		sourcesInterdites:
			listeDeTextes(p.sourcesInterdites, 24, 300) ?? structuredClone(d.sourcesInterdites),
		tiers,
		entries: Array.isArray(p.entries) ? entries : structuredClone(d.entries),
		heuristics: Array.isArray(p.heuristics) ? heuristics : structuredClone(d.heuristics),
		references,
		powerScaling,
		fallback: {
			tier: isCanonTier(fb.tier) ? fb.tier : d.fallback.tier,
			score: scoreValide(fb.score, d.fallback.score),
			verdict: texteCourt(fb.verdict, 600, d.fallback.verdict),
			explanation: texteCourt(fb.explanation, 4000, d.fallback.explanation),
			sources: listeDeTextes(fb.sources, 20, 300) ?? structuredClone(d.fallback.sources),
		},
		vide: {
			verdict: texteCourt(vide.verdict, 600, d.vide.verdict),
			explanation: texteCourt(vide.explanation, 4000, d.vide.explanation),
		},
	};
}
