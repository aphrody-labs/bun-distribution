/**
 * Japonais — cohérence des graphies à travers le corpus des databooks. Règles pures.
 *
 * `databooks-ocr-corrections.ts` ferme la table des confusions sourde/sonore
 * (dakuten/handakuten, ex. `プロリー`→`ブロリー`) : deux caractères qui
 * s'échangent SANS changer la longueur de la chaîne. Ce module traite l'axe
 * complémentaire, qui n'y est pas couvert : la présence, l'absence ou le
 * déplacement du prolongateur vocalique `ー` (chōonpu) — une insertion ou une
 * suppression d'UN signe, jamais une substitution. Les deux familles ne se
 * recouvrent donc jamais par construction : un remplacement dakuten préserve
 * la longueur, un remplacement d'allongement la change toujours de ±1.
 *
 * Méthode, mesurée le 2026-08-23 sur les 9 384 planches transcrites (318
 * ouvrages) :
 *
 *   1. Partir des 470 termes du lexique du domaine intégralement en katakana
 *      (sur 780 au total — les termes mêlant kanji, comme `サイヤ人`, sortent
 *      du champ : le chōonpu ne s'y pose que sur leur fragment katakana, et
 *      cette confusion-là est déjà couverte par la table dakuten de
 *      `databooks-ocr-corrections.ts`, ex. `サイヤン`→`サイヤ人`).
 *   2. Pour chacun, générer TOUTES les variantes à une insertion ou une
 *      suppression de `ー` près (1 898 candidats) — pas une liste devinée,
 *      l'exhaustivité systématique du lexique entier.
 *   3. Ne garder que les candidats réellement attestés dans le corpus (96),
 *      absents de JMdict (65 — un candidat qui EST un mot japonais réel,
 *      comme `ベジタブル` généré depuis `ベジタ`, n'est jamais une faute).
 *   4. Exiger que la forme correcte domine nettement (ratio ≥ 5, ≥ 20
 *      occurrences) ET que la variante suspecte soit elle-même attestée au
 *      moins 3 fois (13 candidats).
 *   5. Vérifier chacun par lecture du contexte réel — pas seulement la
 *      fréquence. Deux ont été ÉCARTÉS malgré un ratio favorable :
 *
 *        - `タブル→ターブル` (5×/3 ouvrages, ratio 9×) : à l'échantillon,
 *          ce ne sont PAS des occurrences du personnage Table. La quasi
 *          totalité provient de vrais mots japonais qui contiennent la
 *          sous-chaîne mais que la garde de frontière laisse passer parce
 *          qu'ils ne sont PAS immédiatement collés à un autre katakana dans
 *          ce cas précis (`CAA「タブル」効果`, un terme de jeu de cartes
 *          distinct de「ダブル」« double »), le reste étant `ベジタブル`,
 *          `コレクタブル`, `ポータブル` (des composés protégés par la garde
 *          quand ils SONT collés, mais qui prouvent que la sous-chaîne
 *          `タブル` n'est pas un indicateur fiable).
 *        - `ケル→ケール` (4×/4 ouvrages) : le contexte de chaque occurrence
 *          est un texte manifestement corrompu par l'OCR (« 大তケル種 » —
 *          `ত` est une lettre bengalie, preuve d'une lecture ratée, pas
 *          d'une faute de dakuten) ou un fragment sans rapport (`ケル状`,
 *          `連携ケルの気力`) — aucune occurrence ne désigne le personnage
 *          Kale avec certitude.
 *
 * Les 13 candidats retenus sont documentés avec leur décompte ET le nombre
 * d'ouvrages distincts où ils apparaissent — jamais une seule source isolée,
 * sauf `クリーリン`/`ジャッキー・チューン`/`レージック`/`ザーーボン` où
 * l'écart de fréquence avec la forme correcte (12× à 321×) et un contexte
 * sans ambiguïté (personnage nommé explicitement) l'emportent sur la
 * dispersion en une seule source — même standard que la table dakuten, qui
 * accepte `イヒルデガーン→ヒルデガーン` (12×, 1 ouvrage).
 */
import { KATAKANA } from "./normalisation";

/** Échappe une chaîne pour un usage littéral dans un `RegExp`. */
function echapperRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface VarianteGraphie {
	/** Graphie fautive telle qu'elle apparaît dans le corpus. */
	lu: string;
	/** Graphie correcte, attestée majoritaire dans le corpus. */
	correct: string;
	/** Preuve : personnage, décompte corpus, nombre d'ouvrages. */
	note: string;
}

/**
 * Variantes d'allongement vocalique (`ー` en trop ou manquant) — table fermée,
 * chaque entrée vérifiée par lecture du contexte réel dans le corpus.
 */
export const VARIANTES_ALLONGEMENT: VarianteGraphie[] = [
	{ lu: "ガリック", correct: "ガーリック", note: "Garlic Jr. — ー manquant, 25×, 7 ouvrages" },
	{
		lu: "ミスター・サターン",
		correct: "ミスター・サタン",
		note: "Mr. Satan — ー en trop (lu « Saturne »), 13×, 4 ouvrages",
	},
	{
		lu: "ジャッキー・チューン",
		correct: "ジャッキー・チュン",
		note: "Jackie Chun — ー en trop, 8×, 1 ouvrage",
	},
	{ lu: "タレス", correct: "ターレス", note: "Tullece — ー manquant, 7×, 5 ouvrages" },
	{ lu: "カリーン", correct: "カリン", note: "Karin — ー en trop, 7×, 4 ouvrages" },
	{
		lu: "ターレース",
		correct: "ターレス",
		note: "Tullece — ー en trop en fin de mot, 5×, 2 ouvrages",
	},
	{
		lu: "クリーリン",
		correct: "クリリン",
		note: "Krillin — ー en trop, 5×, 1 ouvrage (ratio 218×)",
	},
	{ lu: "ブロリ", correct: "ブロリー", note: "Broly — ー manquant, 3×, 2 ouvrages (ratio 321×)" },
	{
		lu: "レージック",
		correct: "レジック",
		note: "Ledgic — ー en trop, 3×, 1 ouvrage (ratio 12×, liste d'ennemis nommés)",
	},
	{ lu: "ザーーボン", correct: "ザーボン", note: "Zarbon — ー doublé, 3×, 1 ouvrage" },
	{
		lu: "クリリーン",
		correct: "クリリン",
		note: "Krillin — ー en trop, 3×, 3 ouvrages (ratio 363×)",
	},
];

/**
 * Variantes ÉCARTÉES malgré un ratio favorable — gardées ici comme preuve
 * documentée, jamais appliquées. Cf. docstring du module pour le détail de
 * chaque vérification.
 */
export const ALLONGEMENTS_ECARTES: { lu: string; cible: string; raison: string }[] = [
	{
		lu: "タブル",
		cible: "ターブル",
		raison:
			"5×/3 ouvrages, ratio 9× — mais le contexte réel est soit un terme de jeu de cartes distinct (« CAAタブル »), soit une sous-chaîne de vrais mots japonais (ベジタブル, コレクタブル, ポータブル) : aucune occurrence ne désigne fiablement le personnage Table.",
	},
	{
		lu: "ケル",
		cible: "ケール",
		raison:
			"4×/4 ouvrages — chaque occurrence est soit un texte corrompu par l'OCR (lettre bengalie « ত » dans le même passage), soit un fragment sans rapport (« ケル状 », « 連携ケルの気力 ») : aucune ne désigne fiablement le personnage Kale.",
	},
];

const KATAKANA_SRC = KATAKANA.source;

/**
 * Applique `VARIANTES_ALLONGEMENT`, gardé par une frontière de mot katakana —
 * même garde que `corrigerFautesDeLecture` de `databooks-ocr-corrections.ts`
 * et pour la même raison : ne pas mordre sur un composé plus long qui
 * contiendrait la graphie fautive comme sous-chaîne.
 *
 * Idempotent par construction : chaque remplacement change la longueur de la
 * chaîne de ±1 signe exactement, et aucune des formes correctes de la table
 * ne contient sa propre forme fautive comme sous-chaîne (vérifié pour les 11
 * entrées, prouvé par `bun test`).
 */
export function corrigerAllongements(texte: string): {
	texte: string;
	corrections: number;
	details: { lu: string; correct: string; n: number }[];
} {
	let sortie = texte;
	const details: { lu: string; correct: string; n: number }[] = [];
	let total = 0;
	for (const { lu, correct } of VARIANTES_ALLONGEMENT) {
		const re = new RegExp(`(?<!${KATAKANA_SRC})${echapperRegExp(lu)}(?!${KATAKANA_SRC})`, "g");
		let n = 0;
		sortie = sortie.replace(re, () => {
			n++;
			return correct;
		});
		if (n > 0) {
			total += n;
			details.push({ lu, correct, n });
		}
	}
	return { texte: sortie, corrections: total, details };
}

// ---------------------------------------------------------------------------
// Résidu dans les composés katakana — extension ciblée, PAS une table ouverte.
// ---------------------------------------------------------------------------

/**
 * Graphies fautives (de la table dakuten `databooks-ocr-corrections.ts` OU de
 * `VARIANTES_ALLONGEMENT`) certifiées sûres à corriger MÊME collées à un
 * autre katakana — c'est-à-dire SANS la garde de frontière.
 *
 * La garde de frontière protège les composés (`ブルックリン` contre un
 * remplacement naïf de `クリン`), mais laisse par construction passer les
 * graphies fautives elles-mêmes quand elles apparaissent SOUDÉES à d'autres
 * mots katakana dans les titres de produits/cartes du corpus — mesuré le
 * 2026-08-23 : `プロリー` apparaît ainsi 54 fois, collée à un point médian de
 * liste (`・プロリー`) ou à un autre nom (`パラガスプロリー`,
 * `バーダックプロリーザマス`).
 *
 * Chaque entrée retenue ici a été vérifiée par lecture des 54 (プロリー) ou N
 * occurrences collées : AUCUNE ne désigne autre chose que Broly, et aucun
 * composé n'est lui-même un mot JMdict réel (la seule collision trouvée,
 * `ベジタブル` pour `ベジタ`, est un cas DIFFÉRENT — `ベジタ` n'est pas dans
 * cette table, justement à cause de cette collision).
 *
 * `デンテ→デンデ` (table dakuten) a été TESTÉE et REJETÉE pour cette
 * extension : sur 78 occurrences collées, 76 proviennent d'un même passage
 * corrompu par une boucle de l'OCR (« コールデンテスポール », en alternance
 * avec « コールデンフリーザ » = Golden Freezer) — aucun rapport avec Dendé.
 * `フルマ→ブルマ` a été mesurée (19 occurrences collées) mais ÉCARTÉE : environ
 * un sixième (`フルマット`, `フルマガ`, `ビフルマ`) est ambigu, sans preuve de
 * contexte suffisante pour trancher. Les 35 autres entrées de la table
 * dakuten n'ont pas été vérifiées individuellement à ce niveau — seule
 * `プロリー` a passé la vérification complète, prouvant que le mécanisme
 * fonctionne, mais sans généralisation aveugle aux 40 autres.
 */
export const VARIANTES_COMPOSEES: VarianteGraphie[] = [
	{
		lu: "プロリー",
		correct: "ブロリー",
		note:
			"Broly — 54 occurrences collées à du katakana (titres de cartes/figurines : " +
			"プロリーフルパワー, パラガスプロリー, プロリーデッキ…), toutes vérifiées en contexte, aucune collision.",
	},
];

/**
 * Applique `VARIANTES_COMPOSEES`, SANS garde de frontière — chaque entrée y
 * a été admise précisément parce que l'absence de garde a été prouvée sans
 * risque (cf. docstring). Ne pas y ajouter une entrée sans la même
 * vérification individuelle.
 */
export function corrigerDansComposes(texte: string): {
	texte: string;
	corrections: number;
	details: { lu: string; correct: string; n: number }[];
} {
	let sortie = texte;
	const details: { lu: string; correct: string; n: number }[] = [];
	let total = 0;
	for (const { lu, correct } of VARIANTES_COMPOSEES) {
		if (!sortie.includes(lu)) continue;
		// Remplacement littéral (pas de RegExp) : ces entrées sont admises
		// précisément SANS garde de frontière, cf. docstring de la table.
		const morceaux = sortie.split(lu);
		const n = morceaux.length - 1;
		sortie = morceaux.join(correct);
		total += n;
		details.push({ lu, correct, n });
	}
	return { texte: sortie, corrections: total, details };
}

// ---------------------------------------------------------------------------
// Pipeline combiné
// ---------------------------------------------------------------------------

export interface RapportCoherence {
	texte: string;
	modifie: boolean;
	corrections: number;
	allongements: { lu: string; correct: string; n: number }[];
	composes: { lu: string; correct: string; n: number }[];
}

/**
 * Applique `corrigerAllongements` puis `corrigerDansComposes`, dans cet
 * ordre : les deux tables sont disjointes par construction (aucune entrée en
 * commun, familles orthogonales), l'ordre n'a donc pas d'effet d'entraînement
 * de l'une sur l'autre. Idempotent (prouvé par `bun test`).
 */
export function corrigerCoherence(brut: string): RapportCoherence {
	const a = corrigerAllongements(brut);
	const c = corrigerDansComposes(a.texte);
	return {
		texte: c.texte,
		modifie: c.texte !== brut,
		corrections: a.corrections + c.corrections,
		allongements: a.details,
		composes: c.details,
	};
}

// ---------------------------------------------------------------------------
// Divergences corpus ↔ wiki — INFORMATIONNEL SEUL, jamais appliqué.
// ---------------------------------------------------------------------------

/**
 * Le wiki (`name_ja`) et le corpus des databooks divergent parfois — et ce
 * n'est pas toujours le corpus qui a tort : les databooks sont la source
 * primaire. Cette table documente les divergences mesurées le 2026-08-23,
 * dans les DEUX sens. Elle n'est JAMAIS appliquée par ce module : corriger le
 * wiki est un acte éditorial (via `/admin` ou `dbfr-wiki`), pas une
 * transformation de texte.
 *
 * `wiki-bug-espacement` (9 entrées) : la colonne `name_ja` d'un petit nombre
 * de fiches contient un espace entre CHAQUE caractère (ex. `フ ラ ッ ペ 博士`)
 * — un artefact de scraping, pas une graphie japonaise réelle. Aucune de ces
 * formes espacées n'a de trace dans le corpus (0 occurrence), alors que la
 * forme concaténée y est bien attestée (3 à 591 occurrences). Un cas plus
 * large, l'espace unique de `未来 トランクス` (0×) contre `未来トランクス`
 * (18×, 12 ouvrages), relève du même bug de scraping (résidu d'une
 * romanisation entre parenthèses mal découpée), pas d'une variante de
 * séparation légitime.
 *
 * `wiki-choonpu-superflu` (1 entrée) : `マゲッター` (avec un allongement) n'a
 * aucune occurrence dans le corpus ; `マゲッタ` (Otta Magetta, sans
 * allongement — conforme à la translittération officielle) y est attesté
 * 3 fois dans des sources indépendantes (guide SDBH, deux V-Jump).
 *
 * `ambigu` (1 entrée) : `マロン` (37×) et `マーロン` (38×) sont quasi à
 * égalité dans le corpus — les DEUX désignent sans ambiguïté la fille de
 * Krillin et C-18, vérifiées dans des sources indépendantes. Aucun verdict
 * n'est possible sur la seule fréquence ; signalé, non tranché.
 */
export interface DivergenceWiki {
	/** Graphie stockée dans `name_ja` (le wiki). */
	formeWiki: string;
	/** Graphie attestée dans le corpus des databooks. */
	formeCorpus: string;
	occWiki: number;
	occCorpus: number;
	fr: string;
	nature: "wiki-bug-espacement" | "wiki-choonpu-superflu" | "ambigu";
}

export const DIVERGENCES_CORPUS_WIKI: DivergenceWiki[] = [
	{
		formeWiki: "フ ラ ッ ペ 博士",
		formeCorpus: "フラッペ博士",
		occWiki: 0,
		occCorpus: 3,
		fr: "Dr. Frappé",
		nature: "wiki-bug-espacement",
	},
	{
		formeWiki: "コ リ ー 博士",
		formeCorpus: "コリー博士",
		occWiki: 0,
		occCorpus: 8,
		fr: "Dr Cory",
		nature: "wiki-bug-espacement",
	},
	{
		formeWiki: "イ コ ー セ",
		formeCorpus: "イコーセ",
		occWiki: 0,
		occCorpus: 16,
		fr: "Ikôse",
		nature: "wiki-bug-espacement",
	},
	{
		formeWiki: "ジ ン グ ル 村 の 村長",
		formeCorpus: "ジングル村の村長",
		occWiki: 0,
		occCorpus: 11,
		fr: "Maire du village Jingle",
		nature: "wiki-bug-espacement",
	},
	{
		formeWiki: "蛇 姫",
		formeCorpus: "蛇姫",
		occWiki: 0,
		occCorpus: 18,
		fr: "Princesse Serpent",
		nature: "wiki-bug-espacement",
	},
	{
		formeWiki: "ウ サ ギ 団",
		formeCorpus: "ウサギ団",
		occWiki: 0,
		occCorpus: 33,
		fr: "Sbires de To le carotteur",
		nature: "wiki-bug-espacement",
	},
	{
		formeWiki: "ス ノ",
		formeCorpus: "スノ",
		occWiki: 0,
		occCorpus: 37,
		fr: "Snow",
		nature: "wiki-bug-espacement",
	},
	{
		formeWiki: "未来 トランクス",
		formeCorpus: "未来トランクス",
		occWiki: 0,
		occCorpus: 18,
		fr: "Trunks (futur)",
		nature: "wiki-bug-espacement",
	},
	{
		formeWiki: "孫 悟飯",
		formeCorpus: "孫悟飯",
		occWiki: 0,
		occCorpus: 591,
		fr: "Son Gohan",
		nature: "wiki-bug-espacement",
	},
	{
		formeWiki: "マゲッター",
		formeCorpus: "マゲッタ",
		occWiki: 0,
		occCorpus: 3,
		fr: "Otta Magetta",
		nature: "wiki-choonpu-superflu",
	},
	{
		formeWiki: "マロン",
		formeCorpus: "マーロン",
		occWiki: 37,
		occCorpus: 38,
		fr: "Maron",
		nature: "ambigu",
	},
];
