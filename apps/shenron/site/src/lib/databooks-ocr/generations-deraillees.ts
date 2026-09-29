// SPDX-License-Identifier: Apache-2.0

/**
 * Transcriptions de databooks — **générations qui ont déraillé** (module pur).
 *
 * Complète `../databooks-ocr-corrections.ts` sans le modifier : ce module ne
 * traite qu'une famille de défauts, celle où le modèle de vision a cessé de
 * lire la planche et s'est mis à produire du texte tout seul, en boucle,
 * jusqu'à sa limite de génération.
 *
 * La règle existante `supprimerRepetitionsConsecutives` ne voit pas ces
 * cas-là : elle raisonne **ligne par ligne**, donc elle exige que la boucle
 * ait la politesse de retourner à la ligne. Or **le japonais s'écrit sans
 * espaces** : une génération bloquée sort comme un seul jet ininterrompu
 * (« 、キネの名前で » ×133 sans un seul saut de ligne, #95 p.13). Tout
 * découpage sur les espaces ou les fins de ligne est structurellement aveugle
 * ici. La détection se fait donc sur la **périodicité du flux de
 * caractères**, sans jamais présupposer de séparateur.
 *
 * Mesuré le 2026-08-25 sur les 11 255 planches transcrites de
 * `bot.db_databooks`.
 *
 * ## Ce que ce module corrige
 *
 *   1. `couperBouclesDegenerees` — un segment de période 2 à 64 répété assez
 *      de fois pour qu'aucune mise en page ne l'explique. Le remède est
 *      toujours le même : **garder le bon préfixe** (le texte lu avant que le
 *      modèle ne décroche) **plus une occurrence du motif**, et jeter le
 *      reste. Jamais la planche entière — le préfixe est du vrai texte de la
 *      planche, c'est même souvent le seul qui ait été lu.
 *   2. `supprimerBlocsHallucinesRepetes` — un bloc identique recollé sous
 *      chaque titre d'une planche, et qui boucle déjà en interne. Là, garder
 *      une occurrence ne servirait à rien : les N occurrences sont le même
 *      délire, elles partent toutes (cf. #93 p.6, la seule du corpus).
 *
 * ## Ce que ce module NE corrige PAS, et pourquoi (mesuré)
 *
 *   - **Textes très courts (moins de 15 signes), 284 planches.** L'hypothèse
 *     « les 4 signes ou moins concentrent des fragments d'onomatopée mal lus
 *     (力 力, 二三) » est **infirmée par le comptage** : ces deux chaînes
 *     n'existent nulle part dans le corpus (0 occurrence), et sur les 84
 *     planches de 4 signes ou moins, **44 sont purement numériques** — des
 *     folios et des millésimes légitimes (1990, 第51話, 12), 31 portent un mot
 *     japonais plausible (大砲, 開発, 食玩, ピッコロ). Vider sur le seul critère
 *     de longueur détruirait donc surtout des folios corrects. Aucune règle de
 *     longueur n'est fournie ici. Les planches réellement avortées sont déjà
 *     classées `courte` par `classerDefaut` et reprises par la file de
 *     relecture.
 *   - **Romaji-only, 259 planches.** La seconde population annoncée — des
 *     bulles japonaises rendues en romaji approximatif (ありがとうございます →
 *     « ary ga thu ») — est **introuvable dans le corpus** : les 259 planches
 *     sont du latin authentique (logos DRAGON BALL, folios, JUMP FESTA 2015,
 *     lignes de copyright ©1986 ARMOR PROJECT/BIRD STUDIO), plus trois
 *     ouvrages réellement anglophones (#46 « Dragon Book » 77 planches, #318
 *     notice SNES 16, #319 « Burst Limit » 6). Rien à vider.
 *   - **Mojibake, 1 planche.** #16 p.346 porte « ÃO » en plein milieu d'une
 *     phrase par ailleurs correcte (« …世界を舞台にするÃO？？ »). Deux signes
 *     parasites dans une interview de 761 signes : les retirer donnerait une
 *     phrase plausible mais inventée, les reconstruire demande le scan.
 *     Signalé, pas touché.
 */
import { nettoyerOcr } from "../databooks-format";

// ---------------------------------------------------------------------------
// 1. Boucle dégénérée — périodicité du flux de caractères
// ---------------------------------------------------------------------------

/**
 * Période la plus courte cherchée.
 *
 * Borner à 2 ne suffit **pas** à écarter la période 1 : une suite de signes
 * identiques (ーーーー, ……, おおおお) est périodique pour *toutes* les
 * périodes, donc elle ressort aussi en période 2. C'est `segmentUniforme` qui
 * l'écarte — sans quoi la règle couperait un filet de tirets ou un cri étiré,
 * qui sont de la typographie et de la mise en page, pas des boucles.
 */
const PERIODE_MIN = 2;
/**
 * Période la plus longue cherchée. 64 couvre les boucles observées les plus
 * larges — les listes de repères de légende du Daizenshuu 6 rejouées en
 * rafale (④ ⑤ … ⑳, période 51) — sans descendre au niveau où un paragraphe
 * entier légitimement redit deux fois serait candidat.
 */
const PERIODE_MAX = 64;

/** En deçà, un segment « périodique » n'est qu'un mot redoublé. */
const REPETITIONS_MIN_ABSOLU = 3;

/**
 * Seuil pour un motif d'au moins 7 signes.
 *
 * Mesuré : 129 planches franchissent ce seuil, et l'inspection des 21 cas de
 * la bande basse (10 à 24 répétitions, couverture parfois inférieure à 40 %)
 * les donne toutes fautives — « オプングラマ・ » ×70, « 実体のないコマンドで »
 * ×45, « 「I」「N」「A」… » ×13. Aucune couverture minimale n'est donc exigée
 * pour un motif long : un fragment de 7 signes répété dix fois est déjà hors
 * de portée de toute mise en page.
 *
 * En dessous de 10, les faux positifs commencent : à 8 répétitions on trouve
 * des grilles de tournoi qui redisent légitimement leur en-tête
 * (« ## ジヤロベーvsシェン / パ Full / 101 », #2 p.223), et à 4-6 des
 * séparateurs de tableau markdown et des sommaires.
 */
const REPETITIONS_MOTIF_LONG = 10;
/** Frontière motif court / motif long. */
const PERIODE_MOTIF_LONG = 7;

/**
 * Seuils pour un motif de 2 à 6 signes, bien plus stricts.
 *
 * Un motif court se répète légitimement dans le corpus : « …… » (points de
 * suspension), « |--- » (séparateur de tableau markdown, #159 p.13,
 * 11 répétitions), « おお » (cri), « 〇〇 » (masquage). Le seul cas où la
 * répétition courte est un défaut, c'est quand elle mange la planche :
 * 20 répétitions ET 60 % du texte. 12 planches, toutes des générations parties
 * jusqu'à la limite (~8 000 signes) sur « ？！ » ou sur une paire d'échappements.
 * Les contre-exemples cités ci-dessus plafonnent à 11 répétitions et 45 % de
 * couverture : la marge est franche des deux côtés.
 */
const REPETITIONS_MOTIF_COURT = 20;
const COUVERTURE_MOTIF_COURT = 0.6;

/** Nombre maximal de coupes par planche — une boucle peut en cacher une autre. */
const PASSES_MAX = 8;

/** Un segment périodique repéré dans le flux de caractères. */
export interface BoucleDetectee {
	/** Indice du premier caractère du segment périodique. */
	debut: number;
	/** Période, en nombre de caractères. */
	periode: number;
	/** Longueur totale du segment périodique (période × répétitions). */
	longueur: number;
	/** `longueur / periode` — fractionnaire si la boucle est coupée en son milieu. */
	repetitions: number;
}

/**
 * Énumère les segments périodiques maximaux du texte, période par période.
 *
 * Pour une période `p`, un segment périodique est une plage où chaque
 * caractère est égal à celui situé `p` positions plus loin. On avance sur le
 * texte, on repère les plages maximales, et on les rend telles quelles — la
 * qualification (est-ce une boucle ou une mise en page ?) est faite à part,
 * par `estBoucleDegeneree`, pour que les seuils restent lisibles et testables
 * indépendamment de la détection.
 *
 * Coût : O(n × PERIODE_MAX) au pire, avec sortie anticipée dès qu'une période
 * ne peut plus tenir trois fois dans le texte.
 */
function* segmentsPeriodiques(texte: string): Generator<BoucleDetectee> {
	const n = texte.length;
	for (let p = PERIODE_MIN; p <= PERIODE_MAX; p++) {
		if (n < p * REPETITIONS_MIN_ABSOLU) break;
		let i = 0;
		while (i + p < n) {
			if (texte[i] !== texte[i + p]) {
				i++;
				continue;
			}
			let j = i;
			while (j + p < n && texte[j] === texte[j + p]) j++;
			const longueur = j + p - i;
			yield { debut: i, periode: p, longueur, repetitions: longueur / p };
			i = j + 1;
		}
	}
}

/**
 * Le segment n'est-il qu'un même signe répété ?
 *
 * ーーーーー (filet), ・・・・・ (points de conduite d'un sommaire), ……………,
 * おおおおお (cri étiré) : c'est de la typographie ou de la mise en page, et ça
 * ressort en période 2 comme en période 7, puisqu'un signe répété est
 * périodique pour toutes les périodes. Une seule planche du corpus perd sa
 * correction à cause de cette garde (#33 p.69, « ポスタ » suivi de 超 ×40) —
 * elle reste classée `boucle` par `classerDefaut`, donc dans la file de
 * relecture, ce qui est de toute façon le bon endroit pour elle : il n'y a
 * rien à sauver dans ces 40 signes.
 */
export function segmentUniforme(texte: string, b: BoucleDetectee): boolean {
	const premier = texte[b.debut];
	for (let i = b.debut + 1; i < b.debut + b.longueur; i++) {
		if (texte[i] !== premier) return false;
	}
	return true;
}

/** Le segment franchit-il les seuils de sa classe de période ? */
export function estBoucleDegeneree(b: BoucleDetectee, longueurTexte: number): boolean {
	if (b.repetitions < REPETITIONS_MIN_ABSOLU) return false;
	if (b.periode >= PERIODE_MOTIF_LONG) return b.repetitions >= REPETITIONS_MOTIF_LONG;
	return (
		b.repetitions >= REPETITIONS_MOTIF_COURT &&
		longueurTexte > 0 &&
		b.longueur / longueurTexte >= COUVERTURE_MOTIF_COURT
	);
}

/**
 * La plus longue boucle dégénérée du texte, ou `null`.
 *
 * La qualification est appliquée **avant** la comparaison, pas après : sinon
 * un long segment non qualifiant (des points de suspension, par exemple)
 * masquerait une vraie boucle plus courte de la même planche.
 */
export function plusLongueBoucle(texte: string): BoucleDetectee | null {
	let meilleure: BoucleDetectee | null = null;
	for (const b of segmentsPeriodiques(texte)) {
		if (!estBoucleDegeneree(b, texte.length)) continue;
		if (segmentUniforme(texte, b)) continue;
		if (
			meilleure === null ||
			b.longueur > meilleure.longueur ||
			(b.longueur === meilleure.longueur && b.periode < meilleure.periode)
		) {
			meilleure = b;
		}
	}
	return meilleure;
}

/**
 * Coupe les boucles dégénérées en **gardant le bon préfixe** : tout ce qui
 * précède la boucle est conservé intact, la boucle est réduite à **une seule
 * occurrence de son motif**, et ce qui suit (le modèle se remet parfois à
 * lire) est recollé derrière.
 *
 * Garder une occurrence plutôt que zéro n'est pas une coquetterie : la
 * première itération est fréquemment la fin légitime de la phrase que le
 * modèle était en train de lire quand il a décroché (#95 p.13 :
 * « …キネの名前で » puis ×133). La jeter reviendrait à couper un mot.
 *
 * Deux invariants, qui garantissent que rien n'est inventé ni réordonné :
 *
 *   - ce qui est retiré est **un multiple entier de la période**, entièrement
 *     pris dans la zone périodique ; c'est ce que garantit le `longueur %
 *     periode` ajouté à la portion gardée : la zone maximale ne tombe pas
 *     forcément sur un multiple de la période (elle peut mordre sur le texte
 *     qui précède, ou s'arrêter en plein motif), et sans ce report la soudure
 *     avec la suite se ferait au milieu d'un motif ;
 *   - la tête conservée est un **préfixe littéral** du texte d'origine.
 *
 * Conséquence assumée : quand le texte qui précède se termine par les mêmes
 * signes que la fin du motif (« …ビデオ game で、 » suivi de « 超人力の力で、 »
 * ×167), la zone périodique commence en réalité avant le motif, et la
 * jointure perd ces quelques signes-là. Un signe de ponctuation en moins à la
 * soudure vaut mieux qu'une reconstruction devinée.
 *
 * Idempotent : après la coupe le motif n'apparaît plus qu'une fois, donc
 * aucun segment périodique qualifiant ne subsiste au même endroit.
 */
export function couperBouclesDegenerees(texte: string): {
	texte: string;
	corrections: number;
	coupes: BoucleDetectee[];
} {
	let sortie = texte;
	const coupes: BoucleDetectee[] = [];
	for (let passe = 0; passe < PASSES_MAX; passe++) {
		const b = plusLongueBoucle(sortie);
		if (!b) break;
		const garde = b.periode + (b.longueur % b.periode);
		sortie = sortie.slice(0, b.debut + garde) + sortie.slice(b.debut + b.longueur);
		coupes.push(b);
	}
	return { texte: sortie, corrections: coupes.length, coupes };
}

// ---------------------------------------------------------------------------
// 2. Bloc halluciné recollé sous chaque titre
// ---------------------------------------------------------------------------

/** Longueur en deçà de laquelle un bloc répété reste anodin (folio, sigle). */
const LONGUEUR_MIN_BLOC = 12;
/** Occurrences à partir desquelles un bloc bouclant devient une hallucination. */
const OCCURRENCES_MIN_BLOC = 3;
/** Longueur minimale d'une queue tronquée pour être reconnue comme telle. */
const LONGUEUR_MIN_QUEUE = 4;

/** Le bloc boucle-t-il déjà sur lui-même (deux lignes non triviales identiques d'affilée) ? */
export function blocBoucleEnInterne(bloc: string): boolean {
	const lignes = bloc
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean);
	for (let i = 1; i < lignes.length; i++) {
		if (lignes[i].length >= LONGUEUR_MIN_BLOC && lignes[i] === lignes[i - 1]) return true;
	}
	return false;
}

/**
 * Supprime **toutes** les occurrences d'un bloc identique répété au moins
 * trois fois dans la planche **et qui boucle déjà en interne**.
 *
 * Le cas type, et le seul du corpus (#93 p.6, « DBS Broly (Anime Comics) ») :
 * une planche de présentation des personnages où chaque titre est suivi du
 * même pavé « ヒリースの身に着いた衣を / 着衣に着いた衣を被衣に着いた衣を ×4 ».
 * Le modèle a lu les intitulés, puis a recopié treize fois le même délire à
 * la place des notices. Ici, garder une occurrence (ce que fait la règle par
 * lignes existante, d'où son ratio de 44 % qui déclenche le garde-fou)
 * laisserait le délire collé sous le premier titre : les treize occurrences
 * sont le même bruit, elles partent ensemble. Ce qui reste — les titres — est
 * la seule matière réellement lue sur la planche.
 *
 * Les deux conditions se gardent l'une l'autre. « Répété trois fois » seul
 * frapperait des blocs de mise en page légitimes (en-têtes de fiches de
 * cartes, mentions de copyright). « Boucle en interne » seul frapperait une
 * planche à boucle unique, que `couperBouclesDegenerees` traite déjà mieux.
 * Réunies, elles ne désignent qu'une planche sur 11 255.
 *
 * La **queue tronquée** est retirée avec le reste : la génération s'arrête au
 * milieu du pavé (« ヒリースの身に着 »), ce fragment est le même délire coupé
 * net, pas une lecture. Trois conditions, et il en faut trois : être un
 * préfixe strict d'un bloc déjà supprimé, ne pas être un titre, et être le
 * **dernier bloc de la planche**. Sans cette dernière condition la règle
 * mangeait aussi, sur cette même planche #93 p.6, un « ヒリース » isolé placé
 * en deuxième position — qui est peut-être le nom du premier personnage, lu
 * pour de bon. Une génération tronquée l'est par définition à la fin : c'est
 * le seul endroit où l'on peut affirmer qu'un fragment est une coupure.
 */
export function supprimerBlocsHallucinesRepetes(texte: string): {
	texte: string;
	corrections: number;
	blocsSupprimes: string[];
} {
	const blocs = texte.split(/\n{2,}/);
	const compte = new Map<string, number>();
	for (const b of blocs) {
		const t = b.trim();
		if (t.length >= LONGUEUR_MIN_BLOC) compte.set(t, (compte.get(t) ?? 0) + 1);
	}
	const cibles = [...compte.entries()]
		.filter(([bloc, n]) => n >= OCCURRENCES_MIN_BLOC && blocBoucleEnInterne(bloc))
		.map(([bloc]) => bloc);
	if (cibles.length === 0) return { texte, corrections: 0, blocsSupprimes: [] };

	const dernier = blocs.length - 1;
	const estQueueTronquee = (t: string, i: number) =>
		i === dernier &&
		t.length >= LONGUEUR_MIN_QUEUE &&
		!t.startsWith("#") &&
		cibles.some((c) => c !== t && c.startsWith(t));

	let corrections = 0;
	const gardes = blocs.filter((b, i) => {
		const t = b.trim();
		if (cibles.includes(t) || estQueueTronquee(t, i)) {
			corrections++;
			return false;
		}
		return true;
	});
	return { texte: gardes.join("\n\n"), corrections, blocsSupprimes: cibles };
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

type CodeRegleDeraillee = "bloc-hallucine-repete" | "boucle-degeneree";

/** Même forme que le `RapportRegle` de `../databooks-ocr-corrections.ts`. */
interface RapportRegle {
	code: CodeRegleDeraillee;
	corrections: number;
}

export interface RapportGenerationDeraillee {
	texte: string;
	rapport: RapportRegle[];
	/** `true` si au moins une règle a changé le texte. */
	modifie: boolean;
	/** Boucles coupées, pour le rapport du runner (taille, position, répétitions). */
	coupes: BoucleDetectee[];
	/** Blocs hallucinés supprimés, pour le rapport du runner. */
	blocsSupprimes: string[];
}

/**
 * Pipeline du module, dans un ordre délibéré :
 *
 *   1. `supprimerBlocsHallucinesRepetes` — la règle la plus spécifique
 *      d'abord. Elle raisonne sur des blocs entiers ; passer après une coupe
 *      de boucle lui ferait voir des blocs déjà mutilés, donc plus identiques
 *      entre eux, et elle ne verrait plus rien.
 *   2. `couperBouclesDegenerees` — sur le texte restant.
 *   3. `nettoyerOcr` — **uniquement si quelque chose a changé**. Retirer un
 *      bloc ou un segment laisse des lignes vides en trop ; mais sur une
 *      planche que ce module ne touche pas, il ne doit rien se passer du tout
 *      (la mise en forme générale ne relève pas d'ici).
 *
 * Idempotent : chaque règle l'est, et aucune ne recrée le motif que l'autre
 * supprime.
 */
export function corrigerGenerationsDeraillees(texte: string): RapportGenerationDeraillee {
	const blocs = supprimerBlocsHallucinesRepetes(texte);
	const boucles = couperBouclesDegenerees(blocs.texte);
	const brut = boucles.texte;
	const modifie = brut !== texte;
	return {
		texte: modifie ? nettoyerOcr(brut) : texte,
		modifie,
		rapport: [
			{ code: "bloc-hallucine-repete", corrections: blocs.corrections },
			{ code: "boucle-degeneree", corrections: boucles.corrections },
		],
		coupes: boucles.coupes,
		blocsSupprimes: blocs.blocsSupprimes,
	};
}

/**
 * Les codes de règle qui autorisent, et eux seuls, à franchir le garde-fou
 * des 50 % du runner. Exporté pour que le runner **nomme** cette voie au lieu
 * de désactiver le garde.
 */
export const REGLES_BOUCLE_DEGENEREE: ReadonlySet<string> = new Set<CodeRegleDeraillee>([
	"bloc-hallucine-repete",
	"boucle-degeneree",
]);
