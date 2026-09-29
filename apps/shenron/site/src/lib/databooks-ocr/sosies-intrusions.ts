/**
 * Transcriptions de databooks — glyphes sosies et intrusions d'alphabets étrangers.
 *
 * Module **autonome** : il ne modifie pas `databooks-ocr-corrections.ts`, il
 * expose le même genre de fonction pure (`corrigerSosiesEtIntrusions`) pour que
 * l'intégration au pipeline principal se fasse plus tard, en un seul point.
 *
 * Deux familles de défauts, mesurées le 2026-08-25 sur les 11 255 planches
 * transcrites de `bot.db_databooks`, et une troisième volontairement laissée en
 * signalement.
 *
 * ## 1. Débordement d'énumération en hangul cerclé — 26 planches, 1 334 signes
 *
 * Unicode range les nombres cerclés en trois blocs disjoints : U+2460 à U+2473
 * pour 1 à 20, U+3251 à U+325F pour 21 à 35, puis U+32B1 à U+32BF pour 36 à 50.
 * Entre le deuxième et le troisième s'intercale un bloc coréen, les **lettres
 * hangul cerclées**, U+3260 à U+326E.
 *
 * Un modèle de vision qui numérote une table des matières continue donc en
 * hangul après le 35 cerclé : il suit la séquence des **codets**, pas celle des
 * **nombres**. Le décalage est constant et se corrige sans relire l'image —
 * U+3260 vaut 36, U+326E vaut 50.
 *
 * Vérifié occurrence par occurrence : sur les 26 planches, la première lettre
 * hangul suit TOUJOURS un 35 cerclé dans l'ordre de lecture, et la suite est
 * monotone. Aucune n'est du coréen. Relevés typiques : une liste de storyboard
 * du Daizenshuu 6 p.113, un titre de niveau 3 dans V Jump juin 2019 p.56, un
 * sommaire de V Jump octobre 2014 p.30.
 *
 * **Ce qui n'est PAS corrigé** : U+326F à U+3273, qui vaudraient 51 à 55.
 * Unicode n'a pas de nombre cerclé au-delà de 50 ; écrire quoi que ce soit
 * serait inventer. Ces 95 occurrences (deux planches, toutes prises dans une
 * boucle du modèle) restent telles quelles et ressortiront à la passe
 * « boucles ».
 *
 * ## 2. Sosies typographiques kanji / katakana — 35 occurrences, 32 planches
 *
 * Le kanji de la force et le katakana ka, celui de la bouche et le katakana ro,
 * celui du deux et le katakana ni, sont des paires de caractères distincts au
 * dessin quasi identique. La désambiguïsation se fait **par le mot**, jamais
 * par le caractère : le kanji seul est parfaitement légitime, c'est au milieu
 * d'une suite de katakana qu'il devient une faute.
 *
 * La règle, portée de `aphrody-ocr::japonais::corrige_sosies` (crate Rust, dont
 * les seuils sont déjà calibrés), tient en une double condition : la
 * substitution n'est retenue que si elle transforme une suite que le
 * dictionnaire **ignore** en un mot qu'il **connaît**. Sans cette confirmation,
 * on ne corrige pas.
 *
 * S'y ajoute un garde-fou que la mesure a rendu indispensable — cf.
 * `bordeKanji` — et l'exclusion délibérée du sosie kanji-un / prolongateur :
 * signalé sur 88 planches, il est légitime dans 95 % des cas, et n'est donc pas
 * traité ici.
 *
 * ## 3. Autres intrusions d'alphabet — 824 planches, 2 797 signes : SIGNALÉES
 *
 * Cyrillique (383 planches), arabe (230), grec (64), hangul (60), thaï (59),
 * devanagari (20), hébreu (8), posés au milieu d'un mot japonais à la place
 * d'un caractère que le modèle n'a pas su lire. Aucune règle ne les corrige, et
 * c'est délibéré : deviner le caractère juste demande de **relire l'image**,
 * pas le texte. Le seul motif systématique du lot — le hangul cerclé — est
 * traité au point 1 parce qu'il relève d'une arithmétique, pas d'une lecture.
 * `signalerIntrusions` les relève pour orienter une relecture ciblée.
 */

/**
 * Même forme que le `RapportRegle` de `databooks-ocr-corrections.ts`, avec des
 * codes propres à ce module. Type local et non import : le pipeline principal
 * est édité en parallèle par d'autres passes, et y ajouter des codes créerait
 * un conflit. Les deux structures sont interchangeables au moment de
 * l'intégration.
 */
export interface RapportRegle {
	code: "enumeration-hangul" | "sosies-typographiques";
	corrections: number;
}

// ---------------------------------------------------------------------------
// 1. Débordement d'énumération en hangul cerclé
// ---------------------------------------------------------------------------

/** Première lettre hangul cerclée : ce que le modèle écrit pour 36. */
const HANGUL_CERCLE_DEBUT = 0x3260;
/** Dernière lettre hangul cerclée traduisible : elle vaut 50. */
const HANGUL_CERCLE_FIN = 0x326e;
/** Premier nombre cerclé du troisième bloc, valeur 36. */
const NOMBRE_CERCLE_36 = 0x32b1;

/**
 * Y a-t-il, ailleurs dans la planche, une énumération cerclée japonaise ?
 *
 * Précondition volontairement faible mais non nulle : elle est vraie sur les
 * 26 planches mesurées, et elle empêcherait la règle de s'appliquer à une page
 * réellement coréenne, où des lettres hangul cerclées isolées seraient de la
 * langue et non un débordement de compteur. Le corpus n'en contient aucune,
 * mais la règle ne coûte rien et rend le module sûr hors de son échantillon.
 */
const ENUMERATION_JAPONAISE = /[①-⑳㉑-㉟]/;

/**
 * Poursuit la numérotation là où le modèle a suivi les codets.
 *
 * Idempotent : la sortie n'est plus dans la plage hangul, donc un second
 * passage ne trouve plus rien.
 */
export function corrigerEnumerationHangul(texte: string): { texte: string; corrections: number } {
	if (!ENUMERATION_JAPONAISE.test(texte)) return { texte, corrections: 0 };
	let n = 0;
	const sortie = [...texte]
		.map((c) => {
			const cp = c.codePointAt(0)!;
			if (cp < HANGUL_CERCLE_DEBUT || cp > HANGUL_CERCLE_FIN) return c;
			n++;
			return String.fromCodePoint(NOMBRE_CERCLE_36 + (cp - HANGUL_CERCLE_DEBUT));
		})
		.join("");
	return { texte: sortie, corrections: n };
}

// ---------------------------------------------------------------------------
// 2. Sosies typographiques
// ---------------------------------------------------------------------------

/**
 * Le katakana qu'un sosie remplace. Les paires viennent de la **ressemblance de
 * dessin**, pas du son : c'est un modèle de vision qui les confond.
 *
 * Le couple kanji-un / prolongateur est **absent à dessein**. Il est le sosie
 * le plus fréquemment signalé du corpus (88 planches) et le plus souvent
 * légitime : 一味, 一家, 一同, 一ツ橋 sont du japonais correct. Le corriger
 * casserait 95 % des cas pour en réparer 5 %.
 */
const SOSIES: Readonly<Record<string, string>> = {
	力: "カ", // chikara / ka
	口: "ロ", // kuchi / ro
	二: "ニ", // ni (kanji) / ni (katakana)
	卜: "ト", // boku / to
	夕: "タ", // yuu / ta
	工: "エ", // kou / e
	八: "ハ", // hachi / ha
	匕: "ヒ", // hi (kanji rare) / hi
	へ: "ヘ", // hiragana he / katakana he, au dessin identique
	べ: "ベ",
	ぺ: "ペ",
};

/**
 * Longueur minimale d'une suite pour qu'on ose y toucher.
 *
 * Trois : en deçà, un katakana collé à un kanji est de la langue courante
 * (力技, 入り口), et la substitution n'aurait pas assez de contexte pour être
 * autre chose qu'un pari.
 */
const SUITE_MINIMUM = 3;

function estKatakana(c: string): boolean {
	const cp = c.codePointAt(0)!;
	// U+30A1 à U+30FA : katakana ; U+30FC : prolongateur ; U+30FD/FE : itérations.
	return (cp >= 0x30a1 && cp <= 0x30fa) || cp === 0x30fc || cp === 0x30fd || cp === 0x30fe;
}

function estKanji(c: string): boolean {
	const cp = c.codePointAt(0)!;
	return (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3400 && cp <= 0x4dbf);
}

/**
 * Le sosie déborde-t-il sur un mot en kanji voisin ?
 *
 * **Le garde-fou que la mesure a imposé.** Une suite katakana commence au
 * premier caractère non-kanji : si ce premier caractère est un sosie collé à un
 * kanji, il appartient peut-être au mot kanji d'avant, pas à la suite katakana
 * d'après. Trois faux positifs mesurés, tous du même schéma :
 *
 *   - 「7弾最新能力リスト！！」 — c'est 能力 (capacité) + リスト, PAS カリスト
 *     (Callisto). Fiche #159, planches 4 et 10.
 *   - 「映像技術協力フジ・メディア・テクノロジー」 — c'est 協力 (coopération)
 *     + フジ, dans un générique. Fiche #54 p.24.
 *   - 「グー超能力グー超能力 B」 — encore 能力. Fiche #252 p.30.
 *
 * Et son symétrique, à droite :
 *
 *   - 「この部分をチョロチョ口上的」 — 口上 (boniment) est un mot ; on ne peut
 *     pas trancher entre lui et チョロチョロ. Fiche #92 p.162.
 *
 * Le prix de ce garde-fou est réel — il écarte aussi 巨大口ボット, 聖地力リン,
 * 全力ットの再撮影 — mais 全力, 地力, 大口 sont des mots japonais réels :
 * l'ambiguïté n'est pas une illusion du garde-fou, elle est dans le texte. Les
 * cas où la lecture ne fait aucun doute sont rattrapés par
 * `SOSIES_VALIDES_A_LA_MAIN`.
 *
 * Ce garde-fou n'attrape pas tout : 「大界王…槐柳二シン(界王神)」 échappait à
 * toutes les variantes essayées (le nom du comédien 槐柳二 finit par le kanji
 * deux, et 柳二 n'est pas un mot). C'est ce cas qui a fait retenir la version
 * stricte — sosie en bord de suite collé à un kanji, sans consulter le
 * dictionnaire — plutôt qu'une version qui ne refuse que si le composé kanji
 * existe.
 */
function bordeKanji(chars: string[], debut: number, fin: number): boolean {
	const teteEstSosie = SOSIES[chars[debut]] !== undefined;
	const queueEstSosie = SOSIES[chars[fin - 1]] !== undefined;
	if (teteEstSosie && debut > 0 && estKanji(chars[debut - 1])) return true;
	if (queueEstSosie && fin < chars.length && estKanji(chars[fin])) return true;
	return false;
}

/**
 * Suites écartées par `bordeKanji` mais dont la lecture ne fait aucun doute une
 * fois le contexte lu — vérifiées une par une le 2026-08-25, sur les
 * 35 occurrences du corpus.
 *
 * La clé inclut le kanji de gauche : c'est lui qui déclenchait le garde-fou, et
 * l'inclure rend le remplacement non ambigu (on ne corrige pas 力リン partout,
 * on corrige 聖地力リン). Même discipline que `FAUTES_VALIDEES` dans
 * `databooks-ocr-corrections.ts` : rien n'entre ici sans sa preuve en contexte.
 */
export const SOSIES_VALIDES_A_LA_MAIN: { lu: string; correct: string; note: string }[] = [
	{
		lu: "巨大口ボット",
		correct: "巨大ロボット",
		note: "Chōzenshū 3 p.199 : 「かめはめ波が、巨大ロボットを…」. Écarté par le garde-fou parce que 大口 est un mot ; mais 巨大 + ロボット est la seule lecture qui tienne. ロボット est attesté sur 211 planches du corpus.",
	},
	{
		lu: "誘導口ボット",
		correct: "誘導ロボット",
		note: "Daizenshuu 7 p.126 : 「誘導ロボット☆」. 導口 n'est pas un mot ; le garde-fou ne tombe que sur le fait que 導 est un kanji.",
	},
	{
		lu: "聖地力リン",
		correct: "聖地カリン",
		note: "TV Anime Guide #24 p.10 : 「▲聖地カリンにそそえたつ塔」, dans un encadré titré カリン塔. カリン塔 est attesté sur 83 planches du corpus.",
	},
	{
		lu: "仙猫力リン",
		correct: "仙猫カリン",
		note: "TV Anime Guide #24 p.10, même encadré : 「仙猫カリンの修業を受けた」. 仙猫カリン est attesté sur 4 planches du corpus.",
	},
	{
		lu: "オネ工言葉",
		correct: "オネエ言葉",
		note: "Jump Anime Library #33 p.34 : 「なぜかオネエ言葉をしゃべる」. Écarté par le garde-fou parce que le sosie est en queue de suite, collé au kanji 言 ; mais 工言 n'est un mot dans aucun dictionnaire, alors que オネエ言葉 est dans JMdict.",
	},
	{
		lu: "茅野力エデ",
		correct: "茅野カエデ",
		note: "Fiches #16 p.363 et #17 p.359 : 「さらわれた茅野カエデと神崎有希子を救出する」, deux personnages d'Assassination Classroom cités ensemble. La lecture 野力 n'existe pas.",
	},
];

/**
 * Remplace les sosies typographiques par le caractère que le mot appelait.
 *
 * `motConnu` est **injecté** plutôt qu'importé : le dictionnaire (kuromoji +
 * JMdict, cf. `src/lib/ja/dictionnaire.ts`) se charge de façon asynchrone
 * depuis `.ja-data/`, alors que cette fonction doit rester pure et synchrone
 * pour être testable et réutilisable. Sans oracle, seule la table validée à la
 * main s'applique : la règle générale ne devine jamais — même contrat de
 * dégradation que `dictionnaire.ts` face à une ressource absente.
 */
export function corrigerSosies(
	texte: string,
	motConnu?: (mot: string) => boolean
): { texte: string; corrections: number; details: { avant: string; apres: string }[] } {
	const details: { avant: string; apres: string }[] = [];
	let sortie = texte;

	// Rattrapage des cas vérifiés à la main, avant la règle générale : ce sont
	// justement ceux que le garde-fou écarte.
	for (const { lu, correct } of SOSIES_VALIDES_A_LA_MAIN) {
		let i = sortie.indexOf(lu);
		while (i >= 0) {
			details.push({ avant: lu, apres: correct });
			sortie = sortie.slice(0, i) + correct + sortie.slice(i + lu.length);
			i = sortie.indexOf(lu, i + correct.length);
		}
	}

	if (!motConnu) return { texte: sortie, corrections: details.length, details };

	const chars = [...sortie];
	const morceaux: string[] = [];
	let i = 0;
	while (i < chars.length) {
		let fin = i;
		let katakanas = 0;
		let sosies = 0;
		while (fin < chars.length) {
			const c = chars[fin];
			if (estKatakana(c)) katakanas++;
			else if (SOSIES[c] !== undefined) sosies++;
			else break;
			fin++;
		}
		if (fin === i) {
			morceaux.push(chars[i]);
			i++;
			continue;
		}
		const avant = chars.slice(i, fin).join("");
		if (fin - i >= SUITE_MINIMUM && katakanas > 0 && sosies > 0 && !bordeKanji(chars, i, fin)) {
			const apres = [...avant].map((c) => SOSIES[c] ?? c).join("");
			if (apres !== avant && motConnu(apres) && !motConnu(avant)) {
				details.push({ avant, apres });
				morceaux.push(apres);
				i = fin;
				continue;
			}
		}
		morceaux.push(avant);
		i = fin;
	}

	return { texte: morceaux.join(""), corrections: details.length, details };
}

// ---------------------------------------------------------------------------
// 3. Intrusions d'alphabet — signalées, jamais corrigées
// ---------------------------------------------------------------------------

/** Un fragment d'écriture étrangère posé au milieu d'un texte japonais. */
export interface Intrusion {
	/** Position du fragment, en unités de code UTF-16 dans le texte. */
	debut: number;
	/** Le fragment lui-même. */
	fragment: string;
	/** Le morceau de texte autour, pour qu'un rapport soit lisible seul. */
	contexte: string;
}

/**
 * Écritures qu'un databook japonais ne contient jamais : grec, cyrillique,
 * hébreu, arabe, devanagari, thaï, jamo et syllabes hangul.
 *
 * Le latin en est **exclu** : il y figure légitimement (DRAGON BALL, TV, une
 * référence produit), et le signaler noierait le reste. Les lettres hangul
 * cerclées en sont exclues aussi — elles ne sont pas une intrusion d'écriture
 * mais un débordement de compteur, corrigé par `corrigerEnumerationHangul`.
 */
const ECRITURE_ETRANGERE = /[Ͱ-ϿЀ-ӿ֐-׿؀-ۿऀ-ॿ฀-๿ᄀ-ᇿ가-힣]+/g;

/** Un texte japonais contient au moins un kana ou un kanji. */
const JAPONAIS = /[぀-ヿ㐀-䶿一-鿿]/;

/**
 * Relève les fragments d'écriture étrangère. **Ne corrige rien.**
 *
 * Mesuré : 824 planches, 2 797 signes. Reconstruire le caractère juste
 * demanderait de relire l'image, donc la seule sortie honnête est un
 * signalement.
 */
export function signalerIntrusions(texte: string): Intrusion[] {
	if (!JAPONAIS.test(texte)) return [];
	const out: Intrusion[] = [];
	for (const m of texte.matchAll(ECRITURE_ETRANGERE)) {
		const debut = m.index!;
		out.push({
			debut,
			fragment: m[0],
			contexte: texte.slice(Math.max(0, debut - 12), debut + m[0].length + 12).replace(/\n/g, "⏎"),
		});
	}
	return out;
}

// ---------------------------------------------------------------------------
// Pipeline du module
// ---------------------------------------------------------------------------

/**
 * Applique les deux règles correctrices du module, dans cet ordre :
 *
 *   1. `corrigerEnumerationHangul` — arithmétique pure, sans dictionnaire ;
 *   2. `corrigerSosies` — sous double condition du dictionnaire, si un oracle
 *      est fourni.
 *
 * Les deux sont indépendantes (l'une ne touche que des signes cerclés, l'autre
 * que des kana et des kanji) et chacune est idempotente, donc leur composition
 * l'est aussi.
 */
export function corrigerSosiesEtIntrusions(
	texte: string,
	options?: { motConnu?: (mot: string) => boolean }
): { texte: string; rapport: RapportRegle[]; details: { avant: string; apres: string }[] } {
	const hangul = corrigerEnumerationHangul(texte);
	const sosies = corrigerSosies(hangul.texte, options?.motConnu);
	return {
		texte: sosies.texte,
		rapport: [
			{ code: "enumeration-hangul", corrections: hangul.corrections },
			{ code: "sosies-typographiques", corrections: sosies.corrections },
		],
		details: sosies.details,
	};
}
