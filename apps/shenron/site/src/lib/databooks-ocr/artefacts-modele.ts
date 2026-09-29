/**
 * Transcriptions de databooks — retrait des **artefacts de sortie du modèle**.
 *
 * Module frère de `../databooks-ocr-corrections.ts`, volontairement séparé :
 * celui-là corrige des *mauvaises lectures* de la planche (une consonne pour
 * une autre, un titre mal placé), celui-ci retire du texte qui **n'est pas
 * une lecture de la planche du tout** — le modèle de vision a écrit à propos
 * de l'image au lieu d'écrire ce qu'elle contient, ou a laissé fuiter sa
 * propre sérialisation.
 *
 * Discipline identique au module frère : chaque règle est mesurée sur le
 * corpus réel AVANT d'être écrite, avec son compte de planches touchées et
 * ses contre-exemples. Mesuré le 2026-08-25 sur les 11 255 planches
 * transcrites de `bot.db_databooks`. Rien n'est deviné : aucune règle ici
 * n'invente un glyphe, ne complète une phrase coupée ni ne traduit.
 *
 * Ce qui a été mesuré puis **refusé**, faute de règle sûre :
 *
 *   - Remplacer un `U+FFFD` par le glyphe « évident d'après le contexte ». 40
 *     des 116 planches concernées ont leur caractère de remplacement **entre
 *     deux caractères japonais** (« 忍術が使える◆けではない » — la lecture わ
 *     saute aux yeux). Deviner ce kana reste deviner, et surtout : le
 *     *retirer* sans le remplacer souderait deux fragments en un mot faux et
 *     silencieux (« 使えるけではない »), strictement pire que le signal
 *     actuel. Seul le caractère **orphelin de fin de sortie** est retiré, cf.
 *     `retirerRemplacementTerminal`.
 *   - Retirer les points de suspension ASCII partout. Le corpus contient 265
 *     planches avec au moins un run de points, dont des **points de conduite**
 *     de sommaire imprimé (« アタック .................... P103 »,
 *     « レッドリボン軍編 .................. 名シーン3 »). Les convertir en
 *     ellipse détruirait une mise en page authentique — d'où la double garde
 *     « collé au japonais » ET « run de 3 à 6 points », cf.
 *     `normaliserEllipsesPoints`.
 *   - Retirer tous les liens markdown. « [VJ WEB](http://jump.shueisha.co.jp/) »
 *     est une URL réellement imprimée dans le V-Jump de la planche #202 p.20.
 *     Seuls les liens à cible vide et les images inventées sont traités.
 *   - Retirer les phrases anglaises « suspectes ». L'ouvrage #46 est un guide
 *     en anglais : « I cannot tell an evil being. » y est une traduction de
 *     dialogue et « Sorry, Robot-san » un titre d'épisode. D'où une liste
 *     **close** de phrases exactes, jamais un mot-clé, cf. `PHRASES_META`.
 */

/** Même forme que le `RapportRegle` du pipeline frère, codes propres à ce module. */
export interface RapportRegle {
	code: CodeArtefact;
	corrections: number;
}

export type CodeArtefact =
	| "json-brut"
	| "phrase-meta-modele"
	| "token-controle"
	| "latex-hallucine"
	| "lien-hallucine"
	| "entite-html"
	| "balise-html"
	| "echappement-litteral"
	| "echappement-repete"
	| "marqueur-page"
	| "ellipse-points"
	| "ellipse-midot"
	| "ellipse-nakaguro"
	| "remplacement-terminal";

const BS = String.fromCharCode(92);

/** Un caractère japonais : hiragana, katakana (pleine chasse) ou kanji. */
const JA = "[\u3041-\u30ff\u3400-\u4dbf\u4e00-\u9fff]";
/** Ponctuation japonaise qui termine légitimement une phrase avant une ellipse. */
const JA_FIN = "[\u3001\u3002\uff01\uff1f\u300d\u300f\uff09]";

// ---------------------------------------------------------------------------
// 1. Sérialisation brute du modèle de mise en page
// ---------------------------------------------------------------------------

/**
 * Le modèle de détection de blocs (catégories `Text` / `Section-header` /
 * `Page-footer` + boîtes englobantes) a parfois vu sa sortie JSON concaténée
 * derrière la transcription mise en forme, puis tronquée par la limite de
 * longueur — le JSON est donc **invalide**, impossible à parser.
 *
 * Mesuré : 4 planches (#12 p.97, #133 p.9, #4 p.91, #4 p.121), et aucune
 * autre forme de sérialisation dans tout le corpus (0 planche avec une
 * clôture de bloc de code, 0 avec une balise HTML, 0 avec un échappement
 * unicode).
 *
 * On ne « ré-extrait » PAS les champs de texte de la queue : vérifié sur les
 * 4 cas, la queue **répète** le contenu déjà présent en tête sous forme mise
 * en page (#4 p.91 rejoue « ク星最強の戦士。戦闘力は42 » qui ouvre déjà la
 * planche). La queue est donc un doublon dégradé, pas de la matière perdue :
 * on coupe.
 *
 * Le point de coupe est le début du premier bloc de boîte englobante OU d'un
 * quadruplet de coordonnées orphelin (« ピッ (19, 536, 174, 806], "… » — la
 * troncature a mangé l'ouverture sur 2 des 4 planches). Le fragment de mot
 * resté collé devant (« ピッ », « バピ ») est laissé tel quel : le compléter
 * serait deviner.
 */
export function couperSerialisationJson(texte: string): { texte: string; corrections: number } {
	const motifs = [
		/\{\s*"bbox"/,
		/\s*\(\d{1,4},\s*\d{1,4},\s*\d{1,4},\s*\d{1,4}\],\s*"/,
		/"\}\s*,\s*\{\s*"/,
	];
	let coupe = -1;
	for (const m of motifs) {
		const r = m.exec(texte);
		if (r && (coupe < 0 || r.index < coupe)) coupe = r.index;
	}
	if (coupe < 0) return { texte, corrections: 0 };
	// Le guillemet de fermeture du champ texte précédent reste parfois collé
	// au dernier caractère utile (« …まったく同じ物を作りてしまった。" »).
	const sortie = texte.slice(0, coupe).replace(/"\s*$/, "");
	return { texte: sortie.trimEnd(), corrections: 1 };
}

// ---------------------------------------------------------------------------
// 2. Phrases méta du modèle (refus de lire, description de l'image)
// ---------------------------------------------------------------------------

/**
 * Liste **close** de phrases exactes produites par le modèle à la place du
 * texte de la planche. Chacune a été relevée telle quelle dans le corpus,
 * avec son compte.
 *
 * Une liste close est indispensable ici : l'ouvrage #46 (« Dragon Ball » en
 * anglais) contient des phrases anglaises parfaitement légitimes que tout
 * mot-clé aurait emportées — « I cannot tell an evil being. » (#46 p.20) est
 * une réplique traduite, « Sorry, Robot-san -- The Desert of Vanishing
 * Tears » (#46 p.3) un titre d'épisode.
 */
export const PHRASES_META: { phrase: string; note: string }[] = [
	{
		phrase: "I did not find any text in the image.",
		note: "refus — 8 occ. sur 4 planches (#10 p.9 x4, #59 p.15, #129 p.15, #12 p.97 dans la queue JSON)",
	},
	{
		phrase: "There is no text in the image.",
		note: "refus — 19 occ. sur 3 planches (#96 p.4 x17, #4 p.204, #45 p.46)",
	},
	{ phrase: "There are no text characters in the image.", note: "refus — 1 occ. (#45 p.46)" },
	{
		phrase: "This image does not contain any recognizable text.",
		note: "refus — 1 occ. (#3 p.136), suivie de « It appears to be a drawing or a photo. »",
	},
	{
		phrase: "It appears to be a drawing or a photo.",
		note: "description d'image — 1 occ. (#3 p.136), toujours accolée au refus ci-dessus",
	},
	{
		phrase: "All the best, but I can't find the text in the image.",
		note: "refus bavard — 1 occ. (#38 p.111)",
	},
	{
		phrase: "I hope it's okay. Let's see.",
		note: "bavardage du modèle — 1 occ. (#38 p.111), paragraphe autonome juste après le refus",
	},
	{
		phrase: "The image contains a drawing of a cartoon character with a speech bubble.",
		note: "description d'image — 1 occ. (#129 p.15)",
	},
];

const SPECIAUX_REGEXP = new Set([
	".",
	"*",
	"+",
	"?",
	"^",
	"$",
	"{",
	"}",
	"(",
	")",
	"|",
	"[",
	"]",
	BS,
]);

function echapperRegExp(s: string): string {
	return [...s].map((c) => (SPECIAUX_REGEXP.has(c) ? BS + c : c)).join("");
}

const RE_PHRASES_META = new RegExp(
	PHRASES_META.map((p) => echapperRegExp(p.phrase)).join("|"),
	"g"
);

/**
 * Retire les phrases de `PHRASES_META`, puis le **paragraphe entier** si ce
 * qu'il en reste ne contient plus aucun signe japonais.
 *
 * Le traitement par paragraphe est ce qui distingue les deux situations
 * mesurées :
 *
 *   - la phrase est un paragraphe à elle seule, éventuellement suivie d'une
 *     description d'image en anglais (#10 p.9, #129 p.15, #3 p.136, #45 p.46,
 *     #38 p.111) : tout le paragraphe est du commentaire, il part ;
 *   - la phrase est **collée à du japonais** au milieu d'une phrase de la
 *     planche (#4 p.204 « …空中基地にThere is no text in the image. »,
 *     #96 p.4 « …の神様に祀りThere is no text in the image. ») : seule la
 *     phrase anglaise part, le japonais reste tronqué tel quel. On ne
 *     complète pas.
 */
export function retirerPhrasesMeta(texte: string): { texte: string; corrections: number } {
	RE_PHRASES_META.lastIndex = 0;
	if (!RE_PHRASES_META.test(texte)) {
		RE_PHRASES_META.lastIndex = 0;
		return { texte, corrections: 0 };
	}
	RE_PHRASES_META.lastIndex = 0;
	let n = 0;
	const reJa = new RegExp(JA);
	const gardes: string[] = [];
	for (const para of texte.split(/\n{2,}/)) {
		RE_PHRASES_META.lastIndex = 0;
		const trouve = para.match(RE_PHRASES_META);
		if (!trouve) {
			gardes.push(para);
			continue;
		}
		n += trouve.length;
		const reste = para.replace(RE_PHRASES_META, "").trim();
		// Paragraphe devenu vide, ou entièrement non japonais : c'était du
		// commentaire du modèle de bout en bout, il disparaît.
		if (reste.length === 0 || !reJa.test(reste)) continue;
		gardes.push(
			para
				.replace(RE_PHRASES_META, "")
				.replace(/[ \t]{2,}/g, " ")
				.trimEnd()
		);
	}
	return { texte: gardes.join("\n\n"), corrections: n };
}

// ---------------------------------------------------------------------------
// 3. Tokens de contrôle
// ---------------------------------------------------------------------------

/**
 * Tokens de fin de tour laissés par un gabarit de conversation.
 *
 * **Mesuré à 0 planche sur les 11 255** — aucune des formes connues
 * (endofassistant, im_end, im_start, end, eot_id, endoftext, balise de fin de
 * séquence, INST, end_of_turn, pad, unk) n'apparaît dans le corpus déposé. La
 * règle est donc **sans effet aujourd'hui** ; elle est conservée pour les lots
 * à venir, où un changement de modèle peut réintroduire le défaut, et parce
 * que son risque de faux positif est nul : aucun databook n'imprime une barre
 * verticale entre chevrons.
 */
const RE_TOKENS =
	/<\|[a-z0-9_]{1,32}\|>|<\/?s>|<\/?(?:end|start)_of_turn>|\[\/?INST\]|<(?:pad|unk|mask)>/gi;

export function retirerTokensControle(texte: string): { texte: string; corrections: number } {
	let n = 0;
	const sortie = texte.replace(RE_TOKENS, () => {
		n++;
		return "";
	});
	return { texte: sortie, corrections: n };
}

// ---------------------------------------------------------------------------
// 4. LaTeX halluciné
// ---------------------------------------------------------------------------

/**
 * Un databook papier ne contient pas de LaTeX : les 9 planches concernées
 * (#2 p.92, #6 p.56/59/63/65/68/69, #13 p.28, #167 p.41) sont un modèle qui a
 * choisi une notation mathématique pour rendre une flèche de schéma ou un
 * simple encadré de texte (« \text{ドラゴンボールファイターズ} » entre
 * délimiteurs mathématiques, #167 p.41).
 *
 * Traitement **strictement typographique**, aucune matière perdue :
 *   - `\text{X}` devient `X` (déballage) ;
 *   - `\xrightarrow{X}` devient une flèche suivie de `X` ;
 *   - `\rightarrow`, `\to`, `\leftarrow`, `\times` deviennent les signes
 *     correspondants ;
 *   - les délimiteurs mathématiques sont retirés.
 *
 * `\frac{1}{2}` n'a **pas** d'équivalent univoque en texte plat : il est
 * laissé tel quel (#2 p.92, dont c'est tout le contenu — la planche part en
 * relecture).
 *
 * Garde de contexte : les délimiteurs ne sont retirés que si le texte contient
 * par ailleurs une commande LaTeX. Sans cette garde, « $ta$ » (#24 p.46, bruit
 * de lecture au milieu d'un entretien) et n'importe quel prix en dollars
 * seraient charcutés.
 */
const RE_CMD_LATEX = new RegExp(
	BS + BS + "(?:times|rightarrow|leftarrow|xrightarrow|xleftarrow|text|frac|to)"
);

export function normaliserLatexHallucine(texte: string): { texte: string; corrections: number } {
	if (!RE_CMD_LATEX.test(texte)) return { texte, corrections: 0 };
	let n = 0;
	let s = texte;
	const remplacer = (re: RegExp, par: (m: string, x: string) => string) => {
		s = s.replace(re, (m: string, x: string) => {
			n++;
			return par(m, x);
		});
	};
	// Déballage d'abord : `\xrightarrow{\text{作る}}` devient `\xrightarrow{作る}`.
	remplacer(new RegExp(BS + BS + "(?:text|mathrm|mathbf)[{]([^{}]*)[}]", "g"), (_m, x) => x);
	remplacer(new RegExp(BS + BS + "xrightarrow[{]([^{}]*)[}]", "g"), (_m, x) => "\u2192" + x);
	remplacer(new RegExp(BS + BS + "xleftarrow[{]([^{}]*)[}]", "g"), (_m, x) => "\u2190" + x);
	remplacer(new RegExp(BS + BS + "(?:rightarrow|to)(?![a-zA-Z])", "g"), () => "\u2192");
	remplacer(new RegExp(BS + BS + "leftarrow(?![a-zA-Z])", "g"), () => "\u2190");
	remplacer(new RegExp(BS + BS + "times(?![a-zA-Z])", "g"), () => "\u00d7");
	// Délimiteurs : ligne isolée, paire double, paire simple.
	remplacer(/^[ \t]*\$\$[ \t]*$/gm, () => "");
	remplacer(/\$\$([^$]*)\$\$/g, (_m, x) => x);
	remplacer(/\$([^$\n]{1,60})\$/g, (_m, x) => x);
	return { texte: s, corrections: n };
}

// ---------------------------------------------------------------------------
// 5. Liens et images inventés
// ---------------------------------------------------------------------------

/**
 * Deux formes mesurées, toutes deux impossibles sur du papier :
 *
 *   - image markdown « ![Image of …](https://i.imgur.com/…) » — 2 planches
 *     (#11 p.14, #91 p.13, cette dernière la répétant 3 fois). L'URL est
 *     inventée de bout en bout (i.imgur.com/12345.jpg), la légende est une
 *     description anglaise de la case. Retirée entièrement.
 *   - lien à cible **vide ou ancre nue** — 2 planches (#120 p.18
 *     « ※[:!)]() [:!)]() », #154 p.6 « [planning new adventures](#) »). Le
 *     libellé est conservé, seule la cible morte part.
 *
 * Contre-exemple qui interdit d'aller plus loin : « [VJ WEB](http://jump.shueisha.co.jp/) »
 * (#202 p.20) est l'adresse réellement imprimée dans le magazine. Un lien
 * markdown vers une vraie URL n'est donc PAS un artefact en soi, et n'est pas
 * touché.
 */
export function retirerLiensHallucines(texte: string): { texte: string; corrections: number } {
	let n = 0;
	let s = texte.replace(/!\[[^\]\n]*\]\([^)\n]*\)/g, () => {
		n++;
		return "";
	});
	s = s.replace(/\[([^\]\n]{0,80})\]\(\s*#?\s*\)/g, (_m, libelle: string) => {
		n++;
		return libelle;
	});
	return { texte: s, corrections: n };
}

// ---------------------------------------------------------------------------
// 6. Entités HTML doublement échappées
// ---------------------------------------------------------------------------

/**
 * 13 planches, 54 occurrences, et seulement trois entités : `&amp;` (44x),
 * `&lt;` (5x), `&gt;` (5x). Toutes sont un double échappement subi par du
 * texte imprimé — « ポスター&amp;ラフスケッチ集 » (#3 p.13),
 * « ヤムチャ&lt;天津飯&gt; » (#259 p.14, tableau de niveaux d'un jeu).
 *
 * Pure normalisation : le rendu markdown décodait déjà l'entité, donc rien ne
 * change à l'écran ; ce qui change, c'est la **recherche** — « ポスター& » ne
 * matchait pas « ポスター&amp; ». Même esprit que
 * `normaliserLatinPleineChasse` du module frère.
 */
const ENTITES: Record<string, string> = {
	"&amp;": "&",
	"&lt;": "<",
	"&gt;": ">",
	"&quot;": '"',
	"&apos;": "'",
	"&nbsp;": " ",
};

export function decoderEntitesHtml(texte: string): { texte: string; corrections: number } {
	let n = 0;
	const sortie = texte.replace(/&(?:amp|lt|gt|quot|apos|nbsp);/gi, (m) => {
		n++;
		return ENTITES[m.toLowerCase()] ?? m;
	});
	return { texte: sortie, corrections: n };
}

// ---------------------------------------------------------------------------
// 6 bis. Balises HTML échappées dans la transcription markdown
// ---------------------------------------------------------------------------

/**
 * Les balises de structure issues d'une réponse HTML du modèle ne sont pas
 * des glyphes imprimés. On conserve le saut de ligne de `<br>` et retire les
 * balises de tableau/texte connues, sans toucher aux chevrons pleine chasse
 * ni aux comparaisons réellement imprimées.
 */
export function retirerBalisesHtml(texte: string): { texte: string; corrections: number } {
	let corrections = 0;
	const sortie = texte.replace(/<\/?(?:td|tr|table|div|span|p|br)>/gi, (balise) => {
		corrections++;
		return /^<br\s*\/?\s*>$/i.test(balise) ? "\n" : "";
	});
	return { texte: sortie, corrections };
}

// ---------------------------------------------------------------------------
// 7. Échappements littéraux
// ---------------------------------------------------------------------------

/**
 * Une barre oblique inverse suivie de « n », en toutes lettres, là où le
 * modèle voulait un saut de ligne : 16 planches, 17 occurrences, toujours
 * entre deux fragments de texte japonais (« か…\n変わった…… » #45 p.15,
 * « # 売り切れ間近！！\n書店へ急げ！！ » #300 p.36).
 *
 * Aucun databook n'imprime cette séquence : le risque de faux positif est
 * nul. On restaure le vrai saut de ligne.
 */
export function restaurerEchappementsLitteraux(texte: string): {
	texte: string;
	corrections: number;
} {
	let n = 0;
	const sortie = texte.replace(new RegExp(BS + BS + "n", "g"), () => {
		n++;
		return "\n";
	});
	return { texte: sortie, corrections: n };
}

/**
 * Boucle d'échappement markdown : une même séquence d'astérisque échappé
 * répétée en rafale. Une seule planche dans tout le corpus, mais
 * spectaculaire — #195 p.24 en aligne 2 040 d'affilée, soit les deux tiers de
 * ses 6 144 signes. C'est le pendant, au niveau du caractère, de la boucle de
 * lignes que traite `supprimerRepetitionsConsecutives` dans le module frère.
 *
 * Seuil à **3 répétitions consécutives**, aligné sur celui du module frère :
 * un ou deux astérisques échappés peuvent être une intention de mise en page
 * (#195 p.11, #257 p.19, qui restent donc intacts).
 */
export function reduireEchappementsRepetes(texte: string): { texte: string; corrections: number } {
	let n = 0;
	const sortie = texte.replace(new RegExp("(?:" + BS + BS + "{1,2}[*]){3,}", "g"), (m) => {
		n += m.length;
		return "";
	});
	return { texte: sortie, corrections: n };
}

// ---------------------------------------------------------------------------
// 8. Marqueur de page halluciné
// ---------------------------------------------------------------------------

/**
 * Le modèle a numéroté sa propre sortie, en anglais, en en-tête du texte :
 * « **Page 4** », « PAGE 50 », « ## Page 53 », « PAGE 54 : », « PAGE 56 ! ».
 * Mesuré : **61 planches**, concentrées sur 2 ouvrages (#20 et #21).
 *
 * Distinguer ce marqueur du folio authentique était l'enjeu, et deux mesures
 * le tranchent :
 *
 *   1. **La forme.** Le folio imprimé sur une planche japonaise est un chiffre
 *      **nu** — #20 p.3 se termine littéralement par « 4 », son vrai folio,
 *      pendant que son en-tête annonce « **Page 4** ». La règle exige le mot
 *      « page », donc ne peut pas manger un folio.
 *   2. **La position et l'isolement.** Le marqueur occupe la première ligne du
 *      texte, seul. Les mentions légitimes de pagination, elles, sont **dans
 *      le fil d'une phrase** : « à partir de la page 71 ! » (#6 p.5),
 *      « Consulte la page 7 pour plus de détails » (#318 p.8), « À la page 54,
 *      découvrez le CD single » (#21 p.23), et jusqu'à « このPage
 *      03-3847-5090 » (#317 p.18) qui est un numéro de téléphone. Aucune n'est
 *      seule sur sa ligne : aucune n'est touchée.
 *
 * Le numéro annoncé ne correspond d'ailleurs pas au numéro de planche
 * (planche 3 donne « Page 4 », planche 4 donne « Page 6 ») : c'est bien la
 * numérotation du modèle, pas celle du livre.
 *
 * Deux positions sont traitées, toutes deux mesurées :
 *   - en-tête, ligne isolée ou préfixe de la première ligne (57 planches, dont
 *     #21 p.2 « PAGE 2 : 週刊少年ジャンプ特別編集 ») ;
 *   - séparateur en milieu de texte, ligne isolée entourée de lignes vides
 *     (4 planches — #21 p.43/48/49/50, où le modèle a marqué le passage à la
 *     page suivante d'une double page).
 */
const RE_PAGE_LIGNE =
	/^[ \t]*(?:\*\*|#{1,6}[ \t]*)?[ \t]*[Pp][Aa][Gg][Ee][ \t]*\d{1,4}[ \t]*(?:\*\*)?[ \t]*[:!.]?[ \t]*$/;
const RE_PAGE_PREFIXE =
	/^[ \t]*(?:\*\*|#{1,6}[ \t]*)?[ \t]*[Pp][Aa][Gg][Ee][ \t]*\d{1,4}[ \t]*(?:\*\*)?[ \t]*[:!][ \t]*(?=\S)/;

export function retirerMarqueursPage(texte: string): { texte: string; corrections: number } {
	const lignes = texte.split("\n");
	let n = 0;
	const sortie: string[] = [];
	for (let i = 0; i < lignes.length; i++) {
		if (RE_PAGE_LIGNE.test(lignes[i])) {
			n++;
			continue;
		}
		if (i === 0 && RE_PAGE_PREFIXE.test(lignes[i])) {
			n++;
			sortie.push(lignes[i].replace(RE_PAGE_PREFIXE, ""));
			continue;
		}
		sortie.push(lignes[i]);
	}
	return { texte: sortie.join("\n"), corrections: n };
}

// ---------------------------------------------------------------------------
// 9. Ellipses
// ---------------------------------------------------------------------------

/**
 * Points ASCII là où la planche porte une ellipse japonaise.
 *
 * Double garde, imposée par les points de conduite des sommaires :
 *   - le run doit être **collé** (aucune espace) à un signe japonais, avant ou
 *     après — « 一方に... » oui, « アタック .......... P103 » non ;
 *   - le run doit faire **3 à 6 points** — « レッドリボン軍編
 *     ......................... 名シーン3 » (#24 p.38, 25 points) et
 *     « ............ おまえたち » (#45 p.16, 12 points) sont hors de portée.
 *
 * Population : 111 planches. Les 5 planches où un run de 7 points ou plus est
 * pourtant collé à du japonais (« 殺したくないんだよ.......... », #23 p.66)
 * sont laissées : impossible de trancher sur texte seul entre une ellipse
 * étirée et un point de conduite dont l'espace a sauté.
 *
 * 6 points donnent une ellipse doublée, la graphie japonaise usuelle du
 * silence long ; 3 à 5 points donnent une ellipse simple.
 */
export function normaliserEllipsesPoints(texte: string): { texte: string; corrections: number } {
	let n = 0;
	const re = new RegExp(
		"(" + JA + "|" + JA_FIN + ")([.]{3,6})(?![.])|(?<![.])([.]{3,6})(?=" + JA + ")",
		"g"
	);
	const sortie = texte.replace(re, (_m: string, avant: string, pts1: string, pts2: string) => {
		const points = pts1 ?? pts2;
		n++;
		const ellipse = points.length >= 6 ? "\u2026\u2026" : "\u2026";
		return avant ? avant + ellipse : ellipse;
	});
	return { texte: sortie, corrections: n };
}

/**
 * Point médian demi-chasse (U+FF65) répété, employé comme ellipse :
 * « 気絶･･･！ », « ボ･･･ボクはほんと ». **636 planches, 1 367 runs.**
 *
 * Le garde-fou prescrit — ne pas toucher au point médian **isolé**, séparateur
 * légitime des composés katakana (« ドラゴン・ボール ») — est appliqué, et la
 * mesure montre qu'il ne coûte rien : dans tout le corpus, **aucun point
 * médian demi-chasse n'est employé comme séparateur**. Les 4 runs de longueur
 * 1 relevés sont des ellipses tronquées en fin de segment (« そして･･････
 * とうとう･ », #65 p.43), et les composés katakana du corpus utilisent le
 * point médian **pleine chasse** U+30FB, un autre caractère, traité à part par
 * `normaliserEllipsesNakaguro` avec un seuil plus strict.
 *
 * Distribution des runs mesurée : 3 points x1 266, 4 x30, 6 x67, 8 x1, plus
 * 2 x3 et 1 x4. Comme pour les points ASCII, 6 et plus donnent une ellipse
 * doublée.
 */
export function normaliserEllipsesMidot(texte: string): { texte: string; corrections: number } {
	let n = 0;
	const sortie = texte.replace(/\uff65{2,}/g, (m) => {
		n++;
		return m.length >= 6 ? "\u2026\u2026" : "\u2026";
	});
	return { texte: sortie, corrections: n };
}

/**
 * Point médian **pleine chasse** (U+30FB) répété au moins trois fois, employé
 * comme ellipse : « 事件が発生・・・！ », « そして・・・！ », « なんとか波・・・」 ».
 * **333 planches, 532 runs** (528 de trois points, 4 de quatre).
 *
 * Même défaut de fond que `normaliserEllipsesMidot` — une ellipse écrite avec
 * le mauvais caractère — mais le risque est ici d'un tout autre ordre, car ce
 * caractère-ci **est** le séparateur légitime du japonais : 15 317 occurrences
 * isolées dans le corpus, sur 4 109 planches (« ミスター・サタン »,
 * « ドラゴン・ボール »).
 *
 * Le seuil de **trois** répétitions n'est donc pas de la prudence de principe,
 * il est imposé par la mesure. Les 18 runs de longueur exactement 2 ont été
 * lus un par un : **aucun n'est une ellipse**, ce sont des séparateurs
 * doublés, et le plus souvent des **puces de liste** —
 * « ・オーブングランデー・・本編前半・・本編後半・・エピソードに選ぶ » (#53),
 * « ・パルスト/ブライズ・・登録中 » (#259),
 * « サヤ人・・宇宙人の・外の世界 » (#12 p.172). Les convertir en ellipse
 * démolirait une énumération. Ils restent intacts.
 *
 * À l'inverse, les 532 runs de trois et plus sont sans ambiguïté : un
 * séparateur ne se triple jamais. Le contre-exemple le plus retors du corpus
 * le confirme — « 「黒・魔・導・爆・裂・破」・・・！！ » (#169) mêle les deux
 * usages dans la même ligne, et seul le run final est touché.
 */
export function normaliserEllipsesNakaguro(texte: string): { texte: string; corrections: number } {
	let n = 0;
	const sortie = texte.replace(/\u30fb{3,}/g, (m) => {
		n++;
		return m.length >= 6 ? "\u2026\u2026" : "\u2026";
	});
	return { texte: sortie, corrections: n };
}

// ---------------------------------------------------------------------------
// 10. Caractère de remplacement orphelin
// ---------------------------------------------------------------------------

/**
 * 116 planches portent exactement **un** caractère de remplacement U+FFFD —
 * jamais deux. Sur ces 116, 46 l'ont en **dernier caractère du texte**, et la
 * longueur de ces planches se masse entre 1 000 et 1 550 signes : ce n'est pas
 * un glyphe illisible sur le papier, c'est la **sortie du modèle coupée net**
 * par sa limite de longueur, le dernier caractère multi-octets tombant à
 * moitié.
 *
 * Ces caractères-là ne signalent donc rien à relire de plus que la troncature
 * elle-même, et ils partent. Sont retirés :
 *   - le caractère final du texte (46 planches) ;
 *   - le caractère seul sur sa ligne (14 planches, dont #155 p.37).
 *
 * Tous les autres restent, en particulier les 40 planches où il se trouve
 * **entre deux caractères japonais**. L'y retirer créerait une faute
 * silencieuse en soudant deux fragments (« 忍術が使える◆けではない » donnerait
 * « 使えるけではない »), et le remplacer serait deviner un kana. Ils gardent
 * leur marque, qui reste le signal exploitable en relecture.
 */
export function retirerRemplacementTerminal(texte: string): { texte: string; corrections: number } {
	let n = 0;
	// Caractère seul sur sa ligne.
	let s = texte
		.split("\n")
		.filter((l) => {
			if (/^[ \t]*\ufffd[ \t]*$/.test(l)) {
				n++;
				return false;
			}
			return true;
		})
		.join("\n");
	// Caractère en tout dernier signe non blanc.
	s = s.replace(/\ufffd(\s*)$/, (_m, fin: string) => {
		n++;
		return fin;
	});
	return { texte: s, corrections: n };
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export interface ResultatArtefacts {
	texte: string;
	rapport: RapportRegle[];
	modifie: boolean;
}

/**
 * Applique les règles dans un ordre délibéré :
 *
 *   1. `couperSerialisationJson` en premier — sinon toutes les règles
 *      suivantes travailleraient à l'intérieur d'une queue JSON vouée à
 *      disparaître, gonflant les compteurs pour rien.
 *   2. `restaurerEchappementsLitteraux` tôt — un saut de ligne littéral crée
 *      une ligne, or `retirerMarqueursPage` et `retirerRemplacementTerminal`
 *      raisonnent ligne par ligne.
 *   3. `retirerPhrasesMeta` avant les règles typographiques : elle supprime
 *      des paragraphes entiers, inutile d'y normaliser des ellipses.
 *   4. les règles typographiques (LaTeX, liens, entités, ellipses).
 *   5. `retirerRemplacementTerminal` en dernier des retraits : « en fin de
 *      texte » ne se juge qu'une fois les paragraphes finaux retirés.
 *
 * Idempotent par construction : aucune règle ne réintroduit le motif qu'une
 * autre corrige, et chaque règle l'est individuellement (prouvé dans
 * `tests/databooks-artefacts-modele.test.ts`).
 *
 * Ce module ne fait **pas** de nettoyage d'espaces : c'est le rôle de
 * `nettoyerOcr`, que le runner applique après coup, comme le pipeline frère.
 */
export function corrigerArtefactsModele(texte: string): ResultatArtefacts {
	const original = texte;
	const rapport: RapportRegle[] = [];
	let s = texte;

	const etape = (code: CodeArtefact, f: (t: string) => { texte: string; corrections: number }) => {
		const r = f(s);
		s = r.texte;
		rapport.push({ code, corrections: r.corrections });
	};

	etape("json-brut", couperSerialisationJson);
	etape("echappement-litteral", restaurerEchappementsLitteraux);
	etape("token-controle", retirerTokensControle);
	etape("phrase-meta-modele", retirerPhrasesMeta);
	etape("latex-hallucine", normaliserLatexHallucine);
	etape("lien-hallucine", retirerLiensHallucines);
	etape("entite-html", decoderEntitesHtml);
	etape("balise-html", retirerBalisesHtml);
	etape("echappement-repete", reduireEchappementsRepetes);
	etape("marqueur-page", retirerMarqueursPage);
	etape("ellipse-points", normaliserEllipsesPoints);
	etape("ellipse-midot", normaliserEllipsesMidot);
	etape("ellipse-nakaguro", normaliserEllipsesNakaguro);
	etape("remplacement-terminal", retirerRemplacementTerminal);

	return { texte: s, rapport, modifie: s !== original };
}
