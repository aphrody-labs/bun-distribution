#!/usr/bin/env bun
/**
 * Détecteur massif d'hallucinations sur le corpus databooks.
 *
 * Balaye les 11 255 planches transcrites de `bot.db_databooks` et classe tout
 * ce qui ressemble à une hallucination, avec pour chaque famille le seuil qui
 * la déclenche et le contre-exemple mesuré qui a fixé ce seuil.
 *
 * Ce script ne corrige RIEN. Il répond à une seule question : « qu'est-ce qui,
 * aujourd'hui, ne devrait pas être là ? » — et il le fait en comptant, jamais
 * en supposant. La passe de correction du 2026-08-25 a montré que quatre
 * chiffres tenus pour acquis dans la mémoire du projet étaient faux, et que
 * c'est le comptage préalable qui a évité d'écrire des règles destructrices.
 *
 * Trois niveaux, qui ne se traitent pas pareil :
 *
 *   bloquant   — ne doit jamais reparaître. Une règle de correction existe et
 *                a été appliquée ; si le compte remonte, c'est une régression,
 *                soit d'un dépôt neuf non nettoyé, soit d'un runner qui a
 *                écrasé le travail d'un autre. Fait sortir en code 1.
 *   signalé    — défaut réel, mais AUCUNE règle fiable ne peut le corriger sur
 *                le texte seul. Destination : la file de relecture humaine.
 *   témoin     — population légitime que les règles ne doivent pas toucher.
 *                Une baisse ici est une régression aussi grave qu'une hausse
 *                ailleurs : cela veut dire qu'une règle a mangé du vrai texte.
 *
 * Le balayage du lexique (§ LEXIQUE) est le détecteur le plus important : il
 * régénère les variantes sourde/sonore de chaque nom propre du wiki et les
 * cherche dans le corpus. C'est lui qui rattrape ce qu'une table de correction
 * figée laisse passer — `プロリー` est resté 28 planches durant parce qu'il
 * manquait d'une table, pas parce qu'il était indétectable.
 *
 * Usage :
 *   bun scripts/detecte-hallucinations.ts                 rapport lisible
 *   bun scripts/detecte-hallucinations.ts --json out.json rapport machine
 *   bun scripts/detecte-hallucinations.ts --famille boucle-motif-long
 *   bun scripts/detecte-hallucinations.ts --echantillons 5
 *   bun scripts/detecte-hallucinations.ts --sans-lexique  saute le § LEXIQUE
 *
 * Sortie : code 1 si une famille bloquante est non vide, ou si une population
 * témoin s'écarte de sa valeur de référence de plus de 2 %.
 */
import postgres from "postgres";

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const flag = (nom: string) => args.includes(`--${nom}`);
const opt = (nom: string): string | undefined => {
	const i = args.indexOf(`--${nom}`);
	return i >= 0 ? args[i + 1] : undefined;
};

const SORTIE_JSON = opt("json");
const FAMILLE = opt("famille");
const ECHANTILLONS = Number(opt("echantillons") ?? 3);
const SANS_LEXIQUE = flag("sans-lexique");

// ---------------------------------------------------------------------------
// Planches
// ---------------------------------------------------------------------------

interface Planche {
	fiche: number;
	titre: string;
	numero: string;
	texte: string;
}

// ---------------------------------------------------------------------------
// Familles de défauts
// ---------------------------------------------------------------------------

type Niveau = "bloquant" | "signale" | "temoin";

interface Famille {
	code: string;
	titre: string;
	niveau: Niveau;
	/** Le seuil, et la mesure qui l'a fixé. */
	pourquoi: string;
	/** Ce qui ressemble au défaut et n'en est pas. Chacun a été vu en base. */
	contreExemples: string[];
	/** Nombre de planches attendu. `null` = pas de référence figée. */
	reference: number | null;
	/** Combien de fois le défaut apparaît dans ce texte. 0 = planche saine. */
	compte(texte: string): number;
}

/** Suite de signes tous identiques : périodique pour toute période, donc
 *  fausse toute détection de boucle. `ーーーー`, `……`, un cri étiré `おおおお`. */
function segmentUniforme(s: string): boolean {
	return s.length > 0 && [...s].every((c) => c === s[0]);
}

/**
 * Plus longue zone périodique du texte, pour une période comprise entre `min`
 * et `max`. Renvoie le motif, le nombre de tours et la part du texte couverte.
 *
 * Écrit à la main plutôt qu'en expression rationnelle : `(.{7,40}?)\1{9,}`
 * part en explosion combinatoire sur des planches de six mille signes, ce qui
 * a fait expirer la première version de ce script.
 */
function zonePeriodique(
	texte: string,
	min: number,
	max: number
): { motif: string; tours: number; couverture: number } | null {
	const n = texte.length;
	if (n < min * 2) return null;

	let meilleur: { motif: string; tours: number; couverture: number } | null = null;

	// Pour une période p donnée, une plage où `t[i] === t[i + p]` de longueur L
	// signifie L/p + 1 tours du motif. Un seul parcours par période suffit donc,
	// au lieu d'essayer chaque position de départ.
	//
	// La version naïve — pour chaque début, pour chaque période, un startsWith
	// en boucle — est quadratique et met plus de sept minutes sur ce corpus.
	// Elle a expiré en production avant d'être remplacée par celle-ci.
	for (let p = min; p <= Math.min(max, n >> 1); p++) {
		let run = 0;
		for (let i = 0; i + p < n; i++) {
			if (texte[i] === texte[i + p]) {
				run++;
				continue;
			}
			if (run >= p) {
				const tours = Math.floor(run / p) + 1;
				const debut = i - run;
				const zone = tours * p;
				if (
					(!meilleur || tours > meilleur.tours) &&
					!segmentUniforme(texte.slice(debut, debut + zone))
				) {
					meilleur = {
						motif: texte.slice(debut, debut + p),
						tours,
						couverture: zone / n,
					};
				}
			}
			run = 0;
		}
		// La dernière plage se termine avec le texte, jamais sur une rupture.
		if (run >= p) {
			const tours = Math.floor(run / p) + 1;
			const debut = n - p - run;
			const zone = tours * p;
			if (
				(!meilleur || tours > meilleur.tours) &&
				!segmentUniforme(texte.slice(debut, debut + zone))
			) {
				meilleur = { motif: texte.slice(debut, debut + p), tours, couverture: zone / n };
			}
		}
	}
	return meilleur;
}

const JAPONAIS = /[぀-ヿ㐀-䶿一-鿿]/;

const FAMILLES: Famille[] = [
	// ---------------------------------------------------------------- bloquants
	{
		code: "token-controle",
		titre: "Jeton de contrôle du modèle",
		niveau: "bloquant",
		pourquoi:
			"Un marqueur de tour de parole n'est jamais imprimé sur du papier. " +
			"Mesuré à 0 sur les 11 255 planches, toutes formes confondues : la " +
			"famille est conservée pour les lots futurs, pas pour l'existant.",
		contreExemples: [],
		reference: 0,
		compte: (t) => (t.match(/<\|[a-z_]+\|>|<\/?s>|\[\/?INST\]|<end_of_turn>|<pad>/gi) ?? []).length,
	},
	{
		code: "json-brut",
		titre: "Sérialisation JSON du modèle",
		niveau: "bloquant",
		pourquoi:
			"Ce n'est pas une mauvaise lecture de la planche, c'est une " +
			"non-lecture. La queue répète le texte déjà mis en forme, donc on " +
			"coupe au lieu de ré-extraire.",
		contreExemples: [
			"Une planche qui cite du JSON imprimé — aucune trouvée, mais la règle coupe la queue plutôt que la planche",
		],
		reference: 2, // #4 p.121 et #12 p.97, écartées par le garde-fou des 50 %
		compte: (t) => (t.match(/"bbox"\s*:|"category"\s*:/g) ?? []).length,
	},
	{
		code: "boucle-motif-long",
		titre: "Boucle dégénérée, motif de 7 à 64 signes",
		niveau: "bloquant",
		pourquoi:
			"Seuil à 10 tours. À 8 tours on trouve des grilles de tournoi qui " +
			"redisent légitimement leur en-tête ; à 4-6, des séparateurs de " +
			"tableau. Le détecteur du dépôt plafonnait le motif à 40 signes et " +
			"laissait passer les listes de repères du Daizenshuu 6 (période 51).",
		contreExemples: [
			"## ジヤロベーvsシェン / パ Full / 101 — grille de tournoi, 8 tours (#2 p.223)",
		],
		reference: 0,
		compte: (t) => {
			const z = zonePeriodique(t, 7, 64);
			return z && z.tours >= 10 ? 1 : 0;
		},
	},
	{
		code: "boucle-motif-court",
		titre: "Boucle dégénérée, motif de 2 à 6 signes",
		niveau: "bloquant",
		pourquoi:
			"Double condition : 20 tours ET 60 % du texte. Les répétitions " +
			"légitimes plafonnent à 11 tours et 45 % de couverture, la marge est " +
			"franche. Les segments uniformes sont exclus : une suite de signes " +
			"identiques est périodique pour toute période et ressortirait à tort.",
		contreExemples: [
			"|--- répété 11 fois dans un tableau, 5 % de couverture (#159 p.13)",
			"…… / おお / 〇〇 — segments uniformes, jamais des boucles",
		],
		reference: 0,
		compte: (t) => {
			const z = zonePeriodique(t, 2, 6);
			return z && z.tours >= 20 && z.couverture >= 0.6 ? 1 : 0;
		},
	},
	{
		code: "fffd-final",
		titre: "Caractère de remplacement en fin de texte",
		niveau: "bloquant",
		pourquoi:
			"Les 46 planches concernées faisaient toutes entre 1 000 et 1 550 " +
			"signes : ce n'est pas un glyphe illisible sur le papier, c'est la " +
			"sortie coupée net par la limite de longueur, dernier caractère " +
			"multi-octets tombé à moitié.",
		contreExemples: [],
		reference: 0,
		compte: (t) => (/�\s*$/.test(t) ? 1 : 0),
	},
	{
		code: "nakaguro-demi-chasse",
		titre: "Point médian demi-chasse répété",
		niveau: "bloquant",
		pourquoi:
			"Une ellipse écrite avec le mauvais caractère. Le corpus ne contient " +
			"AUCUN `･` isolé : les composés katakana utilisent `・`, un " +
			"autre codet. La règle ne peut donc pas mordre sur du légitime.",
		contreExemples: [],
		reference: 0,
		compte: (t) => (t.match(/･{2,}/g) ?? []).length,
	},
	{
		code: "nakaguro-ellipse",
		titre: "Point médian pleine chasse en ellipse (3 et plus)",
		niveau: "bloquant",
		pourquoi:
			"Seuil à 3. Les runs de 2 sont des puces de liste, pas des ellipses, " +
			"et les convertir effacerait la structure de l'énumération.",
		contreExemples: [
			"・オーブングランデー・・本編前半・・本編後半 — puces doublées (#53)",
			"サヤ12人・・宇宙人の・外の世界 — séparateur doublé (#12 p.172)",
			"「黒・魔・導・爆・裂・破」・・・！！ — les deux usages sur une ligne (#169)",
		],
		reference: 0,
		compte: (t) => (t.match(/・{3,}/g) ?? []).length,
	},
	{
		code: "ellipse-ascii",
		titre: "Points ASCII au contact du japonais",
		niveau: "bloquant",
		pourquoi:
			"Deux gardes cumulées : collé sans espace, ET run de 3 à 6 points. " +
			"Au-delà de 7 points collés, c'est indécidable sur texte seul entre " +
			"ellipse étirée et point de conduite dont l'espace a sauté.",
		contreExemples: [
			"アタック .......... P103 — point de conduite de sommaire (#88 p.103)",
			"レッドリボン軍編 ......... 名シーン3 — 25 points (#24 p.38)",
		],
		reference: 0,
		compte: (t) => (t.match(/[぀-ヿ一-鿿]\.{3,6}(?!\.)|(?<!\.)\.{3,6}[぀-ヿ一-鿿]/g) ?? []).length,
	},
	{
		code: "marqueur-page",
		titre: "Marqueur de page halluciné",
		niveau: "bloquant",
		pourquoi:
			"Le folio authentique est un chiffre NU. Discriminant mesuré : #20 " +
			"p.3 finit par `4`, son vrai folio, pendant que son en-tête annonce " +
			"`**Page 4**` fabriqué par le modèle.",
		contreExemples: [
			"à partir de la page 71 ! — renvoi imprimé (#6 p.5)",
			"Consulte la page 7 — idem (#318 p.8)",
			"このPage 03-3847-5090 — numéro de téléphone (#317 p.18)",
		],
		reference: 0,
		compte: (t) => (t.match(/(^|\n)\s*\**\s*Page\s+\d+\s*\**\s*(?=\n|$)/gi) ?? []).length,
	},
	{
		code: "hangul-cercle",
		titre: "Compteur cerclé passé en hangul",
		niveau: "bloquant",
		pourquoi:
			"Arithmétique, pas écriture. Unicode met 1-20 en U+2460, 21-35 en " +
			"U+3251, 36-50 en U+32B1, et intercale le hangul cerclé en U+3260 : " +
			"le modèle a suivi les codets. Formule `35 + (cp - U+325F)`. Dans " +
			"les 26 planches, le premier hangul suivait un ㉟, 26 fois sur 26.",
		contreExemples: [
			"Une page réellement coréenne — aucune dans le corpus ; la règle exige qu'un compteur ①-㉟ figure ailleurs dans la planche",
		],
		reference: 0,
		compte: (t) => (t.match(/[㉠-㉮]/g) ?? []).length,
	},
	{
		code: "balisage-survivant",
		titre: "Balisage HTML, entité doublement échappée, saut de ligne littéral",
		niveau: "bloquant",
		pourquoi:
			"Le modèle répond en markdown ou en HTML ; ce qui survit au parseur " +
			"est du bruit de format, jamais du texte imprimé.",
		contreExemples: [
			"ポスター&ラフスケッチ集 — l'esperluette simple est imprimée, seul &amp;amp; est un artefact",
		],
		reference: 0,
		compte: (t) =>
			(t.match(/<\/?(td|tr|table|div|span|p|br)>|&amp;(amp|lt|gt);|\\n/g) ?? []).length,
	},
	{
		code: "rafale-echappements",
		titre: "Rafale d'échappements markdown",
		niveau: "bloquant",
		pourquoi:
			"Seuil à 3. Deux planches portent 1 ou 2 astérisques échappés qui " +
			"peuvent être voulus ; au-delà c'est une génération partie en vrille " +
			"(#195 p.24 : 6 119 signes d'échappements pour 25 signes utiles).",
		contreExemples: ["1 à 2 astérisques échappés, possiblement voulus (#195 p.11, #257 p.19)"],
		reference: 0,
		compte: (t) => (t.match(/(\\\*){3,}/g) ?? []).length,
	},

	// ----------------------------------------------------------------- signalés
	{
		code: "fffd-median",
		titre: "Caractère de remplacement entre deux caractères japonais",
		niveau: "signale",
		pourquoi:
			"Ni corrigeable ni retirable. Le remplacer serait deviner un kana ; " +
			"le retirer souderait deux fragments — `使える�けではない` " +
			"deviendrait `使えるけではない`, une faute silencieuse strictement " +
			"pire que le signal actuel.\n\n" +
			"Référence 40, et non 70 : 70 est le total des caractères de " +
			"remplacement restants, dont 30 ne sont PAS entre deux kana. " +
			"Confondre les deux fait crier la régression à chaque exécution — " +
			"c'est l'erreur qu'a faite la première version de ce fichier.",
		contreExemples: [],
		reference: 40,
		compte: (t) => (t.match(/[぀-ヿ一-鿿]�[぀-ヿ一-鿿]/g) ?? []).length,
	},
	{
		code: "intrusion-alphabet",
		titre: "Alphabet étranger intrus dans du japonais",
		niveau: "signale",
		pourquoi:
			"Un caractère isolé substitué au milieu d'un mot : `げмар`, " +
			"`容питしない`, `卑igayな性格`. Aucun motif systématique — " +
			"reconstruire exige de rouvrir l'image. Le latin est exclu " +
			"(DRAGON BALL est imprimé), le hangul cerclé aussi (c'est un compteur).",
		contreExemples: [
			"ドラゴンボールSUPER — latin imprimé, légitime",
			"㉠ — compteur cerclé, traité par hangul-cercle",
		],
		reference: 818,
		compte: (t) => {
			if (!JAPONAIS.test(t)) return 0; // ouvrage réellement non japonais
			return (t.match(/[Ѐ-ӿ؀-ۿͰ-Ͽ฀-๿ऀ-ॿ֐-׿가-힯]/g) ?? []).length;
		},
	},
	{
		code: "cercle-hors-plage",
		titre: "Compteur cerclé au-delà de 50",
		niveau: "signale",
		pourquoi:
			"Unicode n'a aucun nombre cerclé au-delà de 50. Écrire quoi que ce " +
			"soit serait inventer. Les 95 occurrences sont dans deux planches " +
			"prises dans une boucle du modèle.",
		contreExemples: [],
		reference: 3,
		compte: (t) => (t.match(/[㉯-㉳]/g) ?? []).length,
	},
	{
		code: "texte-court",
		titre: "Transcription de moins de 15 signes",
		niveau: "signale",
		pourquoi:
			"À signaler, JAMAIS à vider. Sur les 84 planches de 4 signes ou " +
			"moins, 44 sont PUREMENT NUMÉRIQUES — des folios et millésimes " +
			"légitimes (1990, 第51話) — et 31 portent un mot japonais plausible. " +
			"Vider sur le critère de longueur détruirait surtout des folios corrects.",
		contreExemples: [
			"1990 / 12 / 第51話 — folios et millésimes",
			"大砲 / 開発 / 食玩 / ピッコロ — mots japonais isolés mais réels",
			"關 相 超 — fragment de titre vertical (#18 p.299)",
		],
		// Peut monter légitimement quand une boucle est coupée : la planche
		// raccourcit sans que rien de correct ait été perdu.
		reference: 287,
		compte: (t) => (t.trim().length < 15 ? 1 : 0),
	},
	{
		code: "mojibake",
		titre: "Mojibake",
		niveau: "signale",
		pourquoi:
			"Une seule planche : #16 p.346, `ÃO` au milieu de " +
			"`…世界を舞台にするÃO？？`, dans une interview par ailleurs correcte. " +
			"Retirer donnerait une phrase plausible mais inventée.",
		contreExemples: [],
		reference: null,
		compte: (t) => (t.match(/[ÃÂ][-¿À-ÿ]/g) ?? []).length,
	},

	// ------------------------------------------------------------------ témoins
	// Une BAISSE ici est une régression : une règle a mangé du texte légitime.
	{
		code: "temoin-nakaguro-isole",
		titre: "TÉMOIN — séparateur ・ isolé",
		niveau: "temoin",
		pourquoi:
			"15 317 occurrences sur 4 109 planches, strictement inchangées de " +
			"part et d'autre de la passe de correction. C'est la vérification qui " +
			"compte le plus : la règle d'ellipse ne doit pas toucher un séparateur.",
		contreExemples: [],
		reference: 4109,
		compte: (t) => (/(?<!・)・(?!・)/.test(t) ? 1 : 0),
	},
	{
		code: "temoin-ichi",
		titre: "TÉMOIN — 一 en tête de composé",
		niveau: "temoin",
		pourquoi:
			"Le sosie 一 → ー est légitime à 95 % : 一味, 一家, 一ツ橋, 一同. " +
			"Jamais implémenté comme correction, et cette ligne existe pour que " +
			"personne ne le tente.",
		contreExemples: [],
		reference: 581,
		compte: (t) => (/一[味家同ツ緒人]/.test(t) ? 1 : 0),
	},
	{
		code: "temoin-vegetable",
		titre: "TÉMOIN — ベジタブル, l'étymologie de Vegeta",
		niveau: "temoin",
		pourquoi:
			"Deux planches expliquent que le nom de Vegeta vient de `vegetable`. " +
			"Une règle `ベジタ → ベジータ` sans garde de frontière détruirait " +
			"exactement le passage qui la justifie. Doit rester à 2, toujours.",
		contreExemples: [],
		reference: 2,
		compte: (t) => (t.includes("ベジタブル") ? 1 : 0),
	},
	{
		code: "temoin-bomberman",
		titre: "TÉMOIN — スーパーボンバーマン",
		niveau: "temoin",
		pourquoi:
			"`パーボン` est une sous-chaîne du titre de Hudson. La garde de " +
			"frontière de mot a évité 7 régressions ici sans que personne l'ait " +
			"anticipé — c'est l'argument le plus net pour ne jamais l'assouplir.",
		contreExemples: [],
		reference: 6,
		compte: (t) => (t.includes("スーパーボンバーマン") ? 1 : 0),
	},
];

// ---------------------------------------------------------------------------
// § LEXIQUE — variantes sourde/sonore des noms propres du wiki
// ---------------------------------------------------------------------------

/**
 * Groupes de bascule. Un OCR qui rate un dakuten ou un handakuten déplace un
 * kana à l'intérieur de son groupe, jamais ailleurs.
 */
const GROUPES = [
	"ハバパ",
	"ヒビピ",
	"フブプ",
	"ヘベペ",
	"ホボポ",
	"カガ",
	"キギ",
	"クグ",
	"ケゲ",
	"コゴ",
	"サザ",
	"シジ",
	"スズ",
	"セゼ",
	"ソゾ",
	"タダ",
	"チヂ",
	"ツヅ",
	"テデ",
	"トド",
];

/** Toutes les graphies obtenues en basculant UN seul kana. */
function variantes(graphie: string): string[] {
	const out: string[] = [];
	const signes = [...graphie];
	for (let i = 0; i < signes.length; i++) {
		const groupe = GROUPES.find((g) => g.includes(signes[i]));
		if (!groupe) continue;
		for (const alt of groupe) {
			if (alt === signes[i]) continue;
			out.push([...signes.slice(0, i), alt, ...signes.slice(i + 1)].join(""));
		}
	}
	return out;
}

/**
 * Paires déjà jugées, avec le motif du verdict.
 *
 * Le balayage les retrouvera à chaque exécution — c'est normal et voulu : il
 * mesure le corpus, il ne se souvient de rien. Sans cette table, le rapport
 * redemanderait indéfiniment d'arbitrer des cas tranchés, et le bruit finirait
 * par masquer les vrais trous.
 *
 * Une paire n'entre ici QUE si son verdict s'appuie sur une preuve écrite
 * ci-contre. « J'ai regardé et ça va » n'est pas un motif.
 */
const ARBITRAGES: Record<string, string> = {
	"ジャンパ→シャンパ":
		"REFUSÉ — ジャンパ est le blouson, mot japonais courant. 17 des 18 " +
		"occurrences sont agglutinées, ce qui le confirme.",
	"ガンバー→カンバー": "REFUSÉ — titre de jeu de 1992 (#19 p.265), treize ans avant Cumber.",
	"ドキトキ→トキトキ":
		"REFUSÉ — ドキドキ mal lu (#212 : ドキトキのお楽しみ抽選会). Tokitoki date de 2015.",
	"ドギドキ→ドギドギ": "REFUSÉ — à un kana de ドキドキ autant que de ドギドギ, rien ne tranche.",
	"カステル→ガステル":
		"REFUSÉ — Castel, nom étranger courant ; aucun dictionnaire ne contient ce genre d'emprunt.",
	"ビックバンアタック→ビッグバンアタック":
		"REFUSÉ — ビック est une graphie japonaise attestée de « big » (ビックカメラ) : variante éditoriale.",
	"パスキー→ハスキー":
		"REFUSÉ — パスキー est un personnage (femme de main de l'Armée du Ruban Rouge), pas une faute de ハスキー.",
	"シレン→ジレン":
		"REFUSÉ — 風来のシレン, jeu Chunsoft cité de 1996 à 2000, vingt ans avant Jiren.",
	"ゲール→ケール":
		"REFUSÉ — Gale, garde du corps de DBGT ; la planche porte sa traduction « シーラ&ゲール / Sheera & Gale ».",
	"チャフチャイ→チャプチャイ": "CORRIGÉ le 2026-08-25.",
	"チャブチャイ→チャプチャイ": "CORRIGÉ le 2026-08-25.",

	// Formes que le crible JMdict écartait comme mots réels, reprises une à une
	// le 2026-08-25 : sur 52 écartées, 35 attestées, 4 rendues au corpus.
	"スラック→スラッグ":
		"CORRIGÉ (52 occ.) — mais MIXTE : #82 p.65, Fortune Book, parle de « slack » " +
		"au sens de récession (不況, 底値). Deux suffixes protégés dans le module.",
	"ゴット→ゴッド":
		"CORRIGÉ (16 occ.) — 超サイヤ人ゴットSSベジータ, ゴットかめはめ波, aucune exception.",
	"オッズ→オッス": "CORRIGÉ (10 occ.) — オッズ！オラ悟空 ; jamais « odds ».",
	"シース→ジース": "CORRIGÉ (4 occ.) — membre du commando Ginyu, シースとバータ.",
	"パーツ→バーツ":
		"REFUSÉ — 135 occurrences, TOUJOURS « pièces » : オーラのパーツ, 眼球パーツ. " +
		"Le plus gros faux positif possible du corpus.",
	"バーツ→ハーツ": "REFUSÉ — ce n'est pas Hearts mais パーツ mal lu : 筋肉バーツ, 顔バーツ付き.",
	"ピート→ビート":
		"REFUSÉ — le mécanicien de Dub & Peter 1, manga de Toriyama : 天才ピートのつくったピーター.",
	"シータ→ジータ": "REFUSÉ — un ベジータ amputé, sous le titre latin VEGETA.",
	"クルド→グルド": "REFUSÉ — 2 occurrences sur une planche de cartes, contexte non identifiant.",
};

interface TrouLexique {
	fautif: string;
	juste: string;
	planches: number;
	occurrences: number;
	/** Combien de fois la forme juste est plus attestée que la fautive. */
	rapport: number;
	/** Occurrences bordées de non-katakana : lisibles telles quelles. */
	nettes: number;
	/** Occurrences collées à du katakana voisin : souvent une sous-chaîne. */
	agglutinees: number;
	exemples: string[];
}

/**
 * Une occurrence est-elle bordée de non-katakana des deux côtés ?
 *
 * Le point médian `・` compte comme frontière, pas comme katakana : c'est la
 * règle du correcteur, et l'écart entre les deux a coûté cher. Le script
 * d'analyse qui a construit la table comptait `・` comme bloquant, donc
 * `プロリー` — dont toutes les occurrences propres sont bordées d'un `・` —
 * ressortait à zéro occurrence et disparaissait par un `continue` silencieux.
 * 25 planches sont restées fautives pour cette seule divergence.
 */
function occurrencesNettes(texte: string, aiguille: string): number {
	const katakana = /[゠-ヺー]/; // ・ (U+30FB) volontairement exclu
	let n = 0;
	let i = texte.indexOf(aiguille);
	while (i !== -1) {
		const avant = i > 0 ? texte[i - 1] : "";
		const apres = texte[i + aiguille.length] ?? "";
		if (!katakana.test(avant) && !katakana.test(apres)) n++;
		i = texte.indexOf(aiguille, i + aiguille.length);
	}
	return n;
}

/**
 * Cherche, pour chaque nom propre du wiki, ses variantes à un kana près
 * présentes dans le corpus.
 *
 * C'est le détecteur que l'absence de `プロリー` dans une table de correction
 * figée aurait dû déclencher. Une table se périme ; ce balayage, non.
 *
 * Trois filtres, et pas un de plus — le tri fin est le travail d'un relecteur :
 *
 *   1. la variante ne doit pas être elle-même une graphie du lexique, sinon on
 *      signalerait un nom comme faute d'un autre nom ;
 *   2. la forme juste doit être attestée dans le corpus, sinon rien ne dit que
 *      c'est elle qu'on aurait dû lire ;
 *   3. **la forme juste doit être au moins deux fois plus fréquente que la
 *      fautive.** Une faute de lecture est toujours moins attestée que la
 *      forme dont elle dérive ; sans ce rapport, la simple ressemblance fait
 *      remonter du vocabulaire courant — `アビリティ` (798 occurrences) sort
 *      comme faute de `レアリティ` (178), `ナルト` comme faute de `ボルト`.
 *
 * Le troisième filtre vient de l'export `base-connaissance-dragon-ball`
 * (`japonais/graphies-corpus.tsv`), qui a mesuré le même écueil sur les 33 919
 * mots katakana du corpus. Si cet export est présent, ce balayage reste utile
 * pour ce qu'il fait de plus : il part des noms propres du wiki plutôt que des
 * mots du corpus, donc il voit les fautes d'un nom que le corpus n'écrit
 * JAMAIS correctement.
 *
 * Piège connu de la source, documenté et non corrigeable ici : la couverture
 * `name_ja` est de 95 % sur les databooks mais de 2 % sur les techniques (17
 * sur 825). `ギャリック` (de ギャリック砲) est donc absent du lexique alors que
 * `ガーリック` (Garlic, personnage) y figure. Une bascule d'UN kana ne mène pas
 * de l'un à l'autre — il en faudrait deux — donc ce balayage ne produit pas ce
 * faux positif, mais tout élargissement de la distance le ferait apparaître.
 */
async function balayerLexique(sql: postgres.Sql, planches: Planche[]): Promise<TrouLexique[]> {
	const tables = ["db_characters", "db_planets", "db_races", "db_sagas", "db_techniques"];
	const graphies = new Set<string>();
	for (const table of tables) {
		try {
			const lignes = await sql.unsafe(
				`SELECT name_ja FROM bot.${table} WHERE name_ja IS NOT NULL AND name_ja <> ''`
			);
			for (const l of lignes as unknown as Array<{ name_ja: string }>) {
				graphies.add(l.name_ja);
			}
		} catch {
			// une table absente ne doit pas faire tomber tout le rapport
		}
	}

	// Katakana pur d'au moins 4 signes : en deçà, le taux de collision avec du
	// vocabulaire ordinaire explose et le rapport devient illisible.
	const cibles = [...graphies].filter((g) => /^[゠-ヿ]{4,}$/.test(g));
	const corpus = planches.map((p) => p.texte).join("\n");

	/** Occurrences d'une chaîne dans le corpus, sans expression rationnelle. */
	const compter = (aiguille: string): number => {
		let n = 0;
		let i = corpus.indexOf(aiguille);
		while (i !== -1) {
			n++;
			i = corpus.indexOf(aiguille, i + aiguille.length);
		}
		return n;
	};

	// Index compact : toutes les suites katakana DISTINCTES du corpus, jointes.
	// Environ 270 Ko contre 6 Mo pour le corpus entier, pour la même réponse à
	// la question « cette graphie apparaît-elle quelque part ? ».
	//
	// Sans lui, ce balayage scanne le corpus une fois par variante — près de
	// neuf mille fois six mégaoctets — et met plus d'un quart d'heure. On teste
	// donc la présence sur l'index, et on ne paie le comptage exact que pour les
	// quelques centaines de candidates qui ont passé ce crible.
	//
	// Les suites sont gardées ENTIÈRES, jamais découpées en mots : c'est ce qui
	// permet de retrouver une graphie agglutinée à son voisin, exactement le cas
	// que le filtre silencieux avait fait disparaître.
	const index = [...new Set(corpus.match(/[゠-ヿ]+/g) ?? [])].join("\n");

	const trous: TrouLexique[] = [];
	for (const juste of cibles) {
		if (!index.includes(juste)) continue; // forme correcte jamais attestée
		const freqJuste = compter(juste);
		if (freqJuste === 0) continue;
		for (const fautif of variantes(juste)) {
			if (graphies.has(fautif)) continue; // c'est un autre nom du lexique
			if (!index.includes(fautif)) continue; // crible rapide
			const freqFautif = compter(fautif);
			if (freqFautif === 0) continue;
			// Une faute est toujours moins attestée que sa forme d'origine.
			if (freqJuste < freqFautif * 2) continue;
			const touchees = planches.filter((p) => p.texte.includes(fautif));
			if (touchees.length === 0) continue;
			// On ANNOTE la position, on ne filtre pas dessus : une occurrence
			// agglutinée est souvent une sous-chaîne accidentelle (ゴニック dans
			// ドラゴニック), mais parfois un vrai nom collé à son voisin. Trancher
			// ici reproduirait le défaut qui a caché プロリー.
			const nettes = touchees.reduce((n, p) => n + occurrencesNettes(p.texte, fautif), 0);
			trous.push({
				fautif,
				juste,
				planches: touchees.length,
				occurrences: freqFautif,
				rapport: Math.round((freqJuste / freqFautif) * 10) / 10,
				nettes,
				agglutinees: freqFautif - nettes,
				exemples: touchees.slice(0, ECHANTILLONS).map((p) => {
					const i = p.texte.indexOf(fautif);
					return `#${p.fiche} p.${p.numero} — ${p.texte
						.slice(Math.max(0, i - 12), i + fautif.length + 10)
						.replace(/\n/g, " ")}`;
				}),
			});
		}
	}
	return trous.toSorted((a, b) => b.planches - a.planches);
}

// ---------------------------------------------------------------------------
// Balayage
// ---------------------------------------------------------------------------

async function readEnvValue(file: string, key: string): Promise<string | undefined> {
	const text = await Bun.file(file)
		.text()
		.catch(() => "");
	return text
		.split("\n")
		.filter((line) => line.trim().startsWith(`${key}=`))
		.at(-1)
		?.slice(key.length + 1)
		.trim()
		.replace(/^["']|["']$/g, "");
}

// La base distante est la source éditoriale; le .env local peut être obsolète.
const DATABASE_URL =
	process.env.DATABASE_URL?.trim() ||
	(await readEnvValue(".env.remote-db", "REMOTE_DATABASE_URL")) ||
	(await readEnvValue("apps/shenron/site/.env", "DATABASE_URL"));

if (!DATABASE_URL) {
	console.error("DATABASE_URL introuvable dans apps/shenron/site/.env");
	process.exit(2);
}

const sql = postgres(DATABASE_URL, { max: 2 });

console.log("· lecture du corpus…");
const lignes = await sql`
	SELECT d.id AS fiche, d.title AS titre, p->>'number' AS numero, p->>'text' AS texte
	FROM bot.db_databooks d, jsonb_array_elements(d.pages) p
	WHERE coalesce(p->>'text', '') <> ''
	ORDER BY d.id, (p->>'number')
`;
const planches: Planche[] = lignes.map((l) => ({
	fiche: Number(l.fiche),
	titre: String(l.titre),
	numero: String(l.numero),
	texte: String(l.texte),
}));
console.log(`  ${planches.length} planche(s) transcrite(s)\n`);

interface Resultat {
	famille: Famille;
	planches: Array<{ fiche: number; titre: string; numero: string; extrait: string }>;
	occurrences: number;
}

const resultats: Resultat[] = [];
for (const famille of FAMILLES) {
	if (FAMILLE && famille.code !== FAMILLE) continue;
	const touchees: Resultat["planches"] = [];
	let occurrences = 0;
	for (const p of planches) {
		const n = famille.compte(p.texte);
		if (n === 0) continue;
		occurrences += n;
		touchees.push({
			fiche: p.fiche,
			titre: p.titre,
			numero: p.numero,
			extrait: p.texte.slice(0, 90).replace(/\n/g, " "),
		});
	}
	resultats.push({ famille, planches: touchees, occurrences });
}

// ---------------------------------------------------------------------------
// Rapport
// ---------------------------------------------------------------------------

function bloc(niveau: Niveau, titre: string) {
	const dedans = resultats.filter((r) => r.famille.niveau === niveau);
	if (dedans.length === 0) return;
	console.log("=".repeat(78));
	console.log(titre);
	console.log("=".repeat(78));
	for (const r of dedans) {
		const ecart =
			r.famille.reference !== null && r.planches.length !== r.famille.reference
				? `  ⚠ référence ${r.famille.reference}`
				: "";
		console.log(
			`${r.famille.titre.padEnd(52)} ${String(r.planches.length).padStart(5)} planche(s)  ${String(
				r.occurrences
			).padStart(6)} occ.${ecart}`
		);
		for (const p of r.planches.slice(0, ECHANTILLONS)) {
			console.log(`      #${p.fiche} p.${p.numero} « ${p.titre} » — ${p.extrait}`);
		}
		if (r.planches.length > ECHANTILLONS) {
			console.log(`      … et ${r.planches.length - ECHANTILLONS} autre(s)`);
		}
	}
	console.log("");
}

bloc("bloquant", "BLOQUANT — une règle existe, ceci ne devrait plus exister");
bloc("signale", "SIGNALÉ — défaut réel, aucune règle fiable : relecture humaine");
bloc("temoin", "TÉMOIN — population légitime ; une BAISSE est une régression");

let trous: TrouLexique[] = [];
if (!SANS_LEXIQUE && !FAMILLE) {
	console.log("· balayage du lexique (variantes sourde/sonore des noms propres)…");
	trous = await balayerLexique(sql, planches);
	console.log("=".repeat(78));
	console.log("LEXIQUE — noms propres à un dakuten près d'une graphie attestée");
	console.log("=".repeat(78));
	if (trous.length === 0) {
		console.log("aucune variante fautive détectée\n");
	} else {
		const neuves = trous.filter((t) => !ARBITRAGES[`${t.fautif}→${t.juste}`]).length;
		console.log(
			`${trous.length} paire(s) dont ${neuves} neuve(s), ${trous.reduce((n, t) => n + t.planches, 0)} planche(s)\n`
		);
		console.log(
			"Une paire listée n'est PAS une correction à appliquer : c'est une\n" +
				"lecture à vérifier. Trois pièges mesurés — un mot japonais réel\n" +
				"(ジャンパ, blouson, vise シャンパ), une sous-chaîne d'un autre titre\n" +
				"(パーボン dans スーパーボンバーマン), et la chronologie (ガンバー est\n" +
				"un jeu de 1992, treize ans avant Cumber).\n"
		);
		// Les nettes d'abord : ce sont celles qui se lisent sans rouvrir l'image.
		const ordonnes = [...trous].toSorted((a, b) => b.nettes - a.nettes || b.planches - a.planches);
		const neufs = ordonnes.filter((t) => !ARBITRAGES[`${t.fautif}→${t.juste}`]);
		const juges = ordonnes.filter((t) => ARBITRAGES[`${t.fautif}→${t.juste}`]);

		for (const t of neufs.slice(0, 40)) {
			// Sans nuance ici, ce libellé mentirait : プロリー est une vraie faute
			// dont toutes les occurrences restantes sont agglutinées, tandis que
			// ゴニック n'est qu'un morceau de ドラゴニック. Les deux se ressemblent
			// dans le rapport et se distinguent seulement en lisant la planche.
			const position =
				t.nettes === 0
					? "TOUTES agglutinées — sous-chaîne accidentelle, OU nom collé à son voisin : lire la planche"
					: `${t.nettes} nette(s), ${t.agglutinees} agglutinée(s)`;
			console.log(
				`  ${t.fautif} → ${t.juste}   ${t.planches} planche(s), ${t.occurrences} occ., forme juste ${t.rapport}× plus attestée`
			);
			console.log(`      ${position}`);
			for (const e of t.exemples) console.log(`      ${e}`);
		}
		if (neufs.length > 40) console.log(`  … et ${neufs.length - 40} autre(s) paire(s) neuve(s)`);

		if (juges.length > 0) {
			console.log(`\n  --- ${juges.length} paire(s) déjà arbitrée(s), rappel du verdict ---`);
			for (const t of juges) {
				console.log(
					`  ${t.fautif} → ${t.juste} (${t.planches} pl.) : ${ARBITRAGES[`${t.fautif}→${t.juste}`]}`
				);
			}
		}
		if (trous.length > 40) console.log(`  … et ${trous.length - 40} autre(s) paire(s)`);
		console.log("");
	}
}

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

const regressions: string[] = [];
for (const r of resultats) {
	const ref = r.famille.reference;
	if (ref === null) continue;
	if (r.famille.niveau === "temoin") {
		// Une population témoin qui FOND est le signal le plus grave : une règle
		// a mangé du texte légitime. Tolérance 2 %.
		if (r.planches.length < ref * 0.98) {
			regressions.push(
				`${r.famille.code} : ${r.planches.length} planches contre ${ref} attendues — une règle a mangé du texte légitime`
			);
		}
	} else if (r.planches.length > ref) {
		regressions.push(`${r.famille.code} : ${r.planches.length} planches contre ${ref} attendues`);
	}
}

console.log("=".repeat(78));
if (regressions.length > 0) {
	console.log("RÉGRESSIONS");
	for (const r of regressions) console.log(`  ✗ ${r}`);
} else {
	console.log("Aucune régression : chaque famille est à sa valeur de référence.");
}
console.log("=".repeat(78));

if (SORTIE_JSON) {
	await Bun.write(
		SORTIE_JSON,
		JSON.stringify(
			{
				date: new Date().toISOString(),
				planches: planches.length,
				familles: resultats.map((r) => ({
					code: r.famille.code,
					titre: r.famille.titre,
					niveau: r.famille.niveau,
					pourquoi: r.famille.pourquoi,
					contreExemples: r.famille.contreExemples,
					reference: r.famille.reference,
					planches: r.planches.length,
					occurrences: r.occurrences,
					detail: r.planches,
				})),
				lexique: trous,
				regressions,
			},
			null,
			2
		)
	);
	console.log(`\nrapport écrit dans ${SORTIE_JSON}`);
}

await sql.end();
process.exit(regressions.length > 0 ? 1 : 0);
