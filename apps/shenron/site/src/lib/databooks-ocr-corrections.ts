/**
 * Transcriptions de databooks — correction déterministe des défauts d'OCR/mise en forme.
 *
 * Complète `databooks-format.ts` (nettoyage conservateur d'espaces) sans le
 * modifier : ce module va plus loin, mais garde la même discipline — chaque
 * règle est **prouvée** sur le corpus réel avant d'être appliquée, et rien
 * n'est jamais deviné. Mesuré le 2026-08-23 sur les 9 384 planches transcrites.
 *
 * Deux mesures du diagnostic initial se sont révélées être des ARTEFACTS DE
 * MESURE, pas de vrais défauts — vérifié à l'échantillon avant d'écrire quoi
 * que ce soit :
 *
 *   - « puces/titres markdown » : la regex `/^[-*#]/m` comptait aussi les
 *     29 666 titres/puces DÉJÀ en début de ligne, donc déjà corrects et
 *     correctement rendus par le lecteur. Le vrai défaut — un marqueur coincé
 *     en milieu de ligne, jamais rendu en titre — touche 612 planches (6,5 %),
 *     pas 3 106 (33 %). Cf. `corrigerTitresInline`.
 *   - « ponctuation !!!/??? », « espace autour de ponctuation JA », « espace
 *     parasite kana/kanji », « guillemets droits », « tiret-cadratin isolé »,
 *     « pipes tableau » : à l'échantillon, ce sont pour l'écrasante majorité
 *     des éléments de mise en page **légitimes** du document source — titres
 *     à espace franc (« ドラゴンボール ストーリー »), doubles ponctuations
 *     d'emphase (« 完成!!! ») communes au shônen, tirets de suspense
 *     (« そして\n—\nブロリー »), tableaux markdown corrects, formulaires
 *     imprimés avec espaces de remplissage. Aucune règle de correction n'est
 *     fournie pour ces catégories : les « corriger » romprait des mises en
 *     page authentiques. Elles restent dans le rapport de mesure, pas dans
 *     les règles.
 *
 * Ce qui EST un vrai défaut, mesuré et corrigé ici :
 *
 *   1. `corrigerTitresInline` — un marqueur `#`/`##`/… coincé en milieu de
 *      ligne n'est jamais rendu en titre par le lecteur (react-markdown).
 *   2. `normaliserLatinPleineChasse` — latin/chiffres pleine chasse
 *      (Ａ-Ｚ０-９) → forme normale, pure normalisation Unicode réversible
 *      qui améliore la recherche sans toucher au sens.
 *   3. `supprimerRepetitionsConsecutives` — une même ligne non triviale
 *      rendue 3 fois ou plus D'AFFILÉE est un symptôme de boucle du modèle de
 *      vision, jamais une mise en page volontaire (à la différence d'un
 *      élément de colophon répété 2 fois, vu dans le corpus et volontairement
 *      épargné par le seuil ≥3).
 *   4. `corrigerFautesDeLecture` — table de remplacements validés à la main,
 *      PAS les suggestions brutes de `ja-analyser.ts` (~15 % de faux
 *      positifs mesurés). Chaque entrée a été vérifiée par lecture du
 *      contexte réel dans le corpus. Cf. le commentaire de la table.
 *
 * Ce qui reste DÉTECTÉ mais jamais corrigé, faute de preuve suffisante :
 * caractère de remplacement (`�`), texte très court, romaji-only (souvent du
 * contenu réellement non japonais — crédits, ouvrages anglais), mojibake (1
 * seule occurrence dans tout le corpus, non reconstructible proprement),
 * furigana orphelins (16 226 lignes candidates, mais aucune règle fiable pour
 * distinguer une vraie lecture furigana d'un fragment de bruit — cf.
 * `candidatFuriganaOrphelin`).
 */
import { KATAKANA } from "./ja/normalisation";
import { nettoyerOcr } from "./databooks-format";

/** Échappe une chaîne pour un usage littéral dans un `RegExp`. */
function echapperRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// 1. Titres markdown coincés en milieu de ligne
// ---------------------------------------------------------------------------

/**
 * Un marqueur de titre ATX (`#` à `######`) suivi d'une espace puis d'un
 * caractère non-espace, alors qu'il n'est PAS en début de ligne.
 *
 * Lookbehind `(?<=[^#\n])` : le caractère qui précède existe, n'est ni `#` ni
 * `\n` — donc le marqueur est bien au milieu d'un flux de texte, pas au début
 * du texte ni la suite d'un run de `#` déjà traité.
 *
 * Lookahead `(?=[^\s#])` : après l'espace, le caractère suivant n'est NI une
 * espace NI un `#`. Le second garde-fou exclut le piège vu dans le corpus —
 * `## STORY SEQUENCE # #14 「…」` — où un `#` isolé est suivi d'un second `#`
 * collé à un numéro (`#14`, sans espace, donc jamais lui-même un marqueur) :
 * ce n'est pas un titre imbriqué, c'est une numérotation stylisée à
 * l'intérieur d'un titre déjà bien formé. Le couper créerait un faux titre.
 */
const TITRE_INLINE = /(?<=[^#\n])(#{1,6})[ \t]+(?=[^\s#])/g;

/**
 * Renvoie le marqueur à la ligne : `…texte ## Titre…` devient
 * `…texte\n## Titre…`. Ne réordonne rien, ne devine pas où s'arrête le titre
 * — le texte qui suit reste attaché à la même ligne de titre jusqu'au
 * prochain saut de ligne ou marqueur, exactement comme la syntaxe ATX le
 * définit. Idempotent : une fois le marqueur en tête de ligne, le lookbehind
 * ne matche plus (le caractère précédent est `\n`).
 */
export function corrigerTitresInline(texte: string): { texte: string; corrections: number } {
	let n = 0;
	const sortie = texte.replace(TITRE_INLINE, (_correspondance, hashes: string) => {
		n++;
		return `\n${hashes} `;
	});
	return { texte: sortie, corrections: n };
}

// ---------------------------------------------------------------------------
// 2. Latin/chiffres pleine chasse
// ---------------------------------------------------------------------------

/**
 * Ａ-Ｚ, ａ-ｚ pleine chasse → forme normale (ASCII).
 *
 * Décalage de U+FEE0 (bloc Halfwidth and Fullwidth Forms). Pure normalisation
 * d'encodage sur les LETTRES : ne touche ni au sens ni à la casse, et améliore
 * la recherche (« CONTENTS » ne matchait pas « ＣＯＮＴＥＮＴＳ »).
 *
 * Les **chiffres pleine chasse `０-９` en sont volontairement exclus** (ils y
 * figuraient jusqu'au 2026-08-24). Dans un texte japonais ils sont la graphie
 * normale, et les convertir peut changer le sens : sur les 17 planches
 * concernées du corpus, `１100円(税込)` — où le `１` est un marqueur d'item —
 * devenait « 1100円 ». Même piège que `１９号` côté noms japonais : la pleine
 * chasse n'est pas du bruit d'encodage, c'est de la typographie.
 */
export function normaliserLatinPleineChasse(texte: string): { texte: string; corrections: number } {
	let n = 0;
	const sortie = texte.replace(/[Ａ-Ｚａ-ｚ]/g, (c) => {
		n++;
		return String.fromCharCode(c.charCodeAt(0) - 0xfee0);
	});
	return { texte: sortie, corrections: n };
}

// ---------------------------------------------------------------------------
// 3. Répétitions consécutives (boucle du modèle)
// ---------------------------------------------------------------------------

/** En deçà, une ligne courte qui se répète est presque toujours voulue (onomatopée, SFX). */
const LONGUEUR_MIN_REPETITION = 12;
/**
 * Seuil mesuré sur le corpus : les répétitions VOLONTAIRES observées (page de
 * titre, ISBN, colophon) plafonnent à 2 occurrences consécutives
 * (« DRAGON BALL GT » ×2, « ISBN4-08-874089-0 » ×2). À partir de 3, c'est
 * systématiquement une boucle du modèle de vision (« 着衣に着いた衣を被衣に
 * 着いた衣を » ×4).
 */
const SEUIL_REPETITIONS = 3;

/**
 * Réduit à une seule occurrence toute ligne non triviale (≥12 signes après
 * `trim`) répétée ≥3 fois D'AFFILÉE.
 *
 * Volontairement plus étroit que le signal `repetition` de
 * `diagnostiquerPlanche` (qui compte les répétitions n'importe où dans le
 * texte, utile pour alerter mais pas pour corriger — une même ligne dans un
 * tableau à deux endroits différents n'est pas une boucle). Ici, seule
 * l'ADJACENCE stricte est corrigée : c'est la seule forme qui ne peut pas être
 * une mise en page volontaire.
 */
export function supprimerRepetitionsConsecutives(texte: string): {
	texte: string;
	corrections: number;
} {
	const lignes = texte.split("\n");
	const sortie: string[] = [];
	let n = 0;
	let i = 0;
	while (i < lignes.length) {
		const trim = lignes[i].trim();
		let j = i + 1;
		if (trim.length >= LONGUEUR_MIN_REPETITION) {
			while (j < lignes.length && lignes[j].trim() === trim) j++;
		}
		const repetitions = j - i;
		if (repetitions >= SEUIL_REPETITIONS) {
			sortie.push(lignes[i]);
			n += repetitions - 1;
		} else {
			for (let k = i; k < j; k++) sortie.push(lignes[k]);
		}
		i = j;
	}
	return { texte: sortie.join("\n"), corrections: n };
}

// ---------------------------------------------------------------------------
// 4. Fautes de lecture validées à la main
// ---------------------------------------------------------------------------

export interface FauteValidee {
	/** Graphie fautive telle qu'elle apparaît dans le corpus. */
	lu: string;
	/** Graphie correcte, celle qui doit apparaître en base. */
	correct: string;
	/** Pourquoi c'est sûr : personnage, type de confusion, preuve de fréquence/contexte. */
	note: string;
}

/**
 * Table validée à la main — PAS une application aveugle des suggestions de
 * `ja-analyser.ts` (~15 % de faux positifs mesurés par `dbfr-ocr`). Chaque
 * entrée a été vérifiée individuellement par lecture du contexte réel dans le
 * corpus (pas seulement la fréquence), le 2026-08-23.
 *
 * Piège classique retrouvé plusieurs fois pendant la vérification : le
 * suggesteur ne connaît que le lexique du domaine (noms de personnages/lieux
 * du wiki) et ignore tout le reste du japonais — il propose donc de
 * « corriger » un mot parfaitement correct vers le nom de personnage le plus
 * proche par distance d'édition, sans aucune vérification sémantique. Rejetés
 * pour cette raison, avec la preuve trouvée en contexte :
 *
 *   - ウィス→ディス : Whis est un personnage réel et majeur (DBS), pas une faute.
 *   - メカフリーザ→フリーザ : Méca-Freezer est une forme distincte et réelle.
 *   - ミスター・ブウ→ミスター・ポポ : deux personnages différents, aucun rapport.
 *   - ポリューム→リクーム : c'est le mot japonais réel « ボリューム » (volume,
 *     avec une confusion ボ/ポ), pas une faute vers Recoome.
 *   - ピラフロボ→ピラフ : le robot de Pilaf est une entité distincte et réelle.
 *   - キライ→チライ : c'est le mot réel « 嫌い/キライ » (« déteste »), confirmé
 *     par 5/5 occurrences en contexte (« 戦いはキライなので… »), aucun rapport
 *     avec Cheelai.
 *   - カブキ→カブラ : « 風雲カブキ伝 », un jeu/anime sans rapport, cité tel quel
 *     dans de vieux numéros de V-Jump.
 *   - コナッツ→ナッツ : nom de planète correct et récurrent (Movie 13), confirmé
 *     par plusieurs titres indépendants (« ## ヒルデガーン コナッツ星の… »).
 *   - シュラ→シュウ, タゴマ→タマ, カドレ→カド : personnages réels et distincts,
 *     confirmés en contexte (タゴマ a même son romaji « TAGOMA » en sous-titre
 *     dans le corpus).
 *   - ソウラ→クウラ (97×, 50 ouvrages !) : « ソウラ » est un personnage du manga
 *     Dragon Quest « 蒼天のソウラ », publié dans les mêmes numéros de V-Jump —
 *     aucun rapport avec Cooler. La plus grosse fausse piste du lot, à
 *     l'origine des 97 occurrences.
 *   - カウラ/コウラ→クウラ : famille contaminée par le cas ソウラ ci-dessus ;
 *     signal réel mais mélangé à du bruit et à d'autres lectures possibles
 *     dans les échantillons disponibles ; laissés à la relecture humaine par
 *     prudence plutôt que risquer une correction à moitié fausse.
 *   - ボタラ→ボラ : cible fausse (Bora est un personnage différent). Le terme
 *     correct est vraisemblablement « ポタラ » (les boucles d'oreille Potara),
 *     mais ce nom n'existe dans AUCUNE source autorisée du dépôt (le lexique
 *     du domaine n'a aucune technique avec `name_ja`, cf. `lexique.ts`) — donc
 *     pas de correction possible sans sortir du principe « n'ajoute rien qui
 *     ne soit pas ancré dans le lexique ou `dbfr-ocr.md` ».
 *   - カンバニー→カンバー : « ○○カンバニー » est un nom de studio/société réel
 *     dans les crédits (« アズリードカンバニー »), aucun rapport avec Cumber.
 *
 * Les entrées retenues ci-dessous ont, elles, été confirmées par le contexte
 * (le personnage/lieu cité correspond bien au sens de la phrase) ET suivent
 * un schéma de confusion connu et répété du corpus : sourde/sonore
 * (ハ/バ/パ, ヒ/ビ/ピ, フ/ブ/プ…), semi-voyelle longue omise/ajoutée (ー), ou
 * petit tsu de gémination omis/dupliqué (っ/ッ).
 */
export const FAUTES_VALIDEES: FauteValidee[] = [
	// Table de référence dbfr-ocr.md (agent de transcription), déjà documentée.
	{ lu: "プロリー", correct: "ブロリー", note: "Broly — プ/ブ, 224× dans le corpus, 36 ouvrages" },
	{ lu: "ビッコロ", correct: "ピッコロ", note: "Piccolo — ビ/ピ, 199×, 35 ouvrages" },
	{ lu: "ヒッコロ", correct: "ピッコロ", note: "Piccolo — ヒ/ピ, 12×, 6 ouvrages" },
	{ lu: "ピココロ", correct: "ピッコロ", note: "Piccolo — ッ omis (コ dupliqué), 14×, 7 ouvrages" },
	{ lu: "フルマ", correct: "ブルマ", note: "Bulma — フ/ブ, 101×, 28 ouvrages" },
	{ lu: "プルマ", correct: "ブルマ", note: "Bulma — プ/ブ, 34×, 11 ouvrages" },
	{
		lu: "ドラコンボール",
		correct: "ドラゴンボール",
		note: "Dragon Ball — コ/ゴ, 95× (dbfr-ocr.md)",
	},

	// Famille Vegeta — la plus attestée du corpus, convergence de 8 graphies
	// distinctes vers la même cible, chacune vérifiée en contexte.
	{ lu: "ベジタ", correct: "ベジータ", note: "Vegeta — voyelle longue omise, 64×, 18 ouvrages" },
	{ lu: "ペジータ", correct: "ベジータ", note: "Vegeta — ペ/ベ, 55×, 22 ouvrages (dbfr-ocr.md)" },
	{
		lu: "ベージータ",
		correct: "ベジータ",
		note: "Vegeta — voyelle longue ajoutée, 44×, 17 ouvrages (dbfr-ocr.md)",
	},
	{
		lu: "ベジーター",
		correct: "ベジータ",
		note: "Vegeta — voyelle longue ajoutée en fin, 25×, 9 ouvrages",
	},
	{ lu: "コジータ", correct: "ベジータ", note: "Vegeta — コ/ベ, 31×, 23 ouvrages" },
	{ lu: "ヘジータ", correct: "ベジータ", note: "Vegeta — ヘ/ベ, 12×, 8 ouvrages" },
	{ lu: "ベシータ", correct: "ベジータ", note: "Vegeta — シ/ジ, 11×, 7 ouvrages" },
	{ lu: "ベジレータ", correct: "ベジータ", note: "Vegeta — レ parasite, 12×, 5 ouvrages" },

	// Autres personnages confirmés en contexte, schéma de confusion connu.
	{
		lu: "サイヤン",
		correct: "サイヤ人",
		note: "Saiyan — 人 lu ン, 160×, 45 ouvrages ; confirmé en contexte (『超サイヤン4』, 『サイヤンチーム』…)",
	},
	{ lu: "ビラフ", correct: "ピラフ", note: "Pilaf — ビ/ピ, 70×, 19 ouvrages" },
	{ lu: "ヒラフ", correct: "ピラフ", note: "Pilaf — ヒ/ピ, 15×, 5 ouvrages" },
	{ lu: "ピラフー", correct: "ピラフ", note: "Pilaf — voyelle longue parasite, 15×, 10 ouvrages" },
	{
		lu: "ラディツ",
		correct: "ラディッツ",
		note: "Raditz — ッ (gémination) omis, 55×, 14 ouvrages",
	},
	{
		lu: "ラディツツ",
		correct: "ラディッツ",
		note: "Raditz — ツ dupliqué au lieu de ッ, 22×, 7 ouvrages",
	},
	{ lu: "パビディ", correct: "バビディ", note: "Babidi — パ/バ, 39×, 12 ouvrages" },
	{ lu: "バビデイ", correct: "バビディ", note: "Babidi — イ au lieu de petit ィ, 15×, 2 ouvrages" },
	{
		lu: "バビディー",
		correct: "バビディ",
		note: "Babidi — voyelle longue parasite, 11×, 5 ouvrages",
	},
	{ lu: "タンパリン", correct: "タンバリン", note: "Tambourine — パ/バ, 30×, 7 ouvrages" },
	{ lu: "フリザ", correct: "フリーザ", note: "Freezer — voyelle longue omise, 28×, 8 ouvrages" },
	{ lu: "カリリン", correct: "クリリン", note: "Krillin — カ/ク, 21×, 5 ouvrages" },
	{ lu: "コテンクス", correct: "ゴテンクス", note: "Gotenks — コ/ゴ, 26×, 8 ouvrages" },
	{ lu: "ウープ", correct: "ウーブ", note: "Uub — プ/ブ, 25×, 8 ouvrages" },
	{ lu: "ビデル", correct: "ビーデル", note: "Videl — voyelle longue omise, 24×, 8 ouvrages" },
	{ lu: "ビーテル", correct: "ビーデル", note: "Videl — テ/デ, 31×, 12 ouvrages" },
	{ lu: "ピーデル", correct: "ビーデル", note: "Videl — ピ/ビ, 10×, 8 ouvrages" },
	{ lu: "ヤジロペー", correct: "ヤジロベー", note: "Yajirobé — ペ/ベ, 21×, 11 ouvrages" },
	{ lu: "スポボビッチ", correct: "スポポビッチ", note: "Spopovitch — ボ/ポ, 20×, 8 ouvrages" },
	{
		lu: "スポボピッチ",
		correct: "スポポビッチ",
		note: "Spopovitch — ボ/ポ + ッ/ピ, 12×, 6 ouvrages",
	},
	{
		lu: "トクター・ゲロ",
		correct: "ドクター・ゲロ",
		note: "Dr. Gero (C-20) — ト/ド, 18×, 2 ouvrages",
	},
	{ lu: "パーダック", correct: "バーダック", note: "Bardock — パ/バ, 14×, 12 ouvrages" },
	{ lu: "ヒルテガーン", correct: "ヒルデガーン", note: "Hildegarn — テ/デ, 24×, 6 ouvrages" },
	{
		lu: "イヒルデガーン",
		correct: "ヒルデガーン",
		note: "Hildegarn — イ parasite en tête, 12×, 1 ouvrage",
	},
	{ lu: "ミスター・ボボ", correct: "ミスター・ポポ", note: "Mr. Popo — ボ/ポ ×2, 14×, 8 ouvrages" },
	{ lu: "デンテ", correct: "デンデ", note: "Dende — テ/デ, 11×, 9 ouvrages" },
];

const KATAKANA_SRC = KATAKANA.source;

/**
 * Applique `FAUTES_VALIDEES`, chaque remplacement gardé par une frontière de
 * mot katakana : le match ne doit être précédé NI suivi d'un autre caractère
 * katakana (le bloc katakana d'Unicode utilisé couvre aussi les points
 * médians et le prolongateur `ー`).
 *
 * Sans cette garde, remplacer « クリン » (Krillin, forme contractée) aurait
 * aussi mangé « ブルックリン » (Brooklyn) — vu tel quel dans le corpus
 * (« ブルックリン橋 »). La frontière protège tout composé plus long qui
 * contiendrait une graphie fautive comme sous-chaîne, ce qui explique
 * l'absence de クリン→クリリン dans la table : le risque de collision avec
 * des mots katakana étrangers (compagnies, lieux) était trop élevé pour une
 * entrée aussi courte, malgré des occurrences légitimes observées.
 */
export function corrigerFautesDeLecture(texte: string): {
	texte: string;
	corrections: number;
	details: { lu: string; correct: string; n: number }[];
} {
	let sortie = texte;
	const details: { lu: string; correct: string; n: number }[] = [];
	let total = 0;
	for (const { lu, correct } of FAUTES_VALIDEES) {
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
// Pipeline complet
// ---------------------------------------------------------------------------

export interface RapportRegle {
	code: "latin-pleine-chasse" | "titres-inline" | "repetitions-consecutives" | "fautes-de-lecture";
	corrections: number;
}

export interface RapportCorrection {
	texte: string;
	/** `true` si au moins une règle a changé le texte. */
	modifie: boolean;
	regles: RapportRegle[];
	fautesDeLecture: { lu: string; correct: string; n: number }[];
}

/**
 * Pipeline complet, dans un ordre délibéré :
 *
 *   1. `nettoyerOcr` — base (espaces, fins de ligne), déjà testée ailleurs.
 *   2. `normaliserLatinPleineChasse` — normalisation d'encodage, sans effet
 *      sur la structure du texte.
 *   3. `corrigerTitresInline` — insère de vrais sauts de ligne : doit
 *      s'exécuter avant `supprimerRepetitionsConsecutives`, qui raisonne
 *      ligne par ligne.
 *   4. `nettoyerOcr` de nouveau — l'insertion de sauts de ligne peut laisser
 *      une espace de tête ou une ligne vide superflue.
 *   5. `supprimerRepetitionsConsecutives` — opère sur les lignes désormais
 *      stabilisées.
 *   6. `corrigerFautesDeLecture` — remplacement de graphies, indépendant de
 *      la mise en forme.
 *   7. `nettoyerOcr` final — trim de sécurité.
 *
 * Idempotent par construction : chaque règle individuelle l'est (prouvé dans
 * `databooks-ocr-corrections.test.ts`), et aucune ne réintroduit le motif
 * qu'une autre corrige.
 */
export function corrigerTexte(brut: string): RapportCorrection {
	const original = brut;
	let texte = nettoyerOcr(brut);

	const latin = normaliserLatinPleineChasse(texte);
	texte = latin.texte;

	const titres = corrigerTitresInline(texte);
	texte = nettoyerOcr(titres.texte);

	const repetitions = supprimerRepetitionsConsecutives(texte);
	texte = repetitions.texte;

	const fautes = corrigerFautesDeLecture(texte);
	texte = nettoyerOcr(fautes.texte);

	return {
		texte,
		modifie: texte !== original,
		regles: [
			{ code: "latin-pleine-chasse", corrections: latin.corrections },
			{ code: "titres-inline", corrections: titres.corrections },
			{ code: "repetitions-consecutives", corrections: repetitions.corrections },
			{ code: "fautes-de-lecture", corrections: fautes.corrections },
		],
		fautesDeLecture: fautes.details,
	};
}

// ---------------------------------------------------------------------------
// Détection seule — jamais de correction, faute de règle prouvée sûre.
// ---------------------------------------------------------------------------

/** Aucun signe japonais (hiragana/katakana/kanji) : romaji, latin ou vide. */
export function estRomajiUniquement(texte: string): boolean {
	const t = texte.trim();
	if (!t) return false;
	return !/[぀-ヿ一-鿿]/.test(t);
}

/**
 * Mojibake classique : UTF-8 réinterprété en Latin-1/CP1252 (« Ã© », « â€ »).
 * Un seul cas dans tout le corpus (2026-08-23), et pas de forme reconstruite
 * proprement (`ÃO` ne correspond à aucun octet UTF-8 valide réinterprété) —
 * détection seule, aucune correction automatique tentée.
 */
export function contientMojibakeSuspect(texte: string): boolean {
	return /Ã.|â€|Â[ ]/.test(texte);
}

/**
 * Ligne courte, entièrement en hiragana, isolée — candidate à un furigana
 * orphelin (lecture d'un kanji sortie comme ligne autonome).
 *
 * PAS une correction : mesuré sur le corpus, 16 226 lignes correspondent à ce
 * seul critère, et l'écrasante majorité sont du bruit sans rapport avec un
 * kanji voisin (« そーそー », « がんぐるん »), pas des lectures furigana
 * reconnaissables. Prouver qu'une ligne donnée EST la lecture d'un kanji
 * adjacent demanderait un alignement phonétique fiable (kanji → lecture
 * attendue via l'analyseur morphologique → comparaison) qui n'a pas été
 * construit ; sans cette preuve, aucune suppression n'est faite. Le compte
 * sert uniquement au rapport de mesure.
 */
export function candidatFuriganaOrphelin(ligne: string): boolean {
	const l = ligne.trim();
	return l.length >= 2 && l.length <= 10 && /^[ぁ-ゟー・]+$/.test(l);
}
