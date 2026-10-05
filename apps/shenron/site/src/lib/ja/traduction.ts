/**
 * Japonais — protection du vocabulaire du domaine avant traduction. Règles pures.
 *
 * Mesuré avec NLLB-200 en local : la grammaire japonaise est correctement
 * rendue, **le vocabulaire de la série est massacré**. `孫悟空は界王拳を使った`
 * devient « Son-gu a utilisé le poing du roi » : le modèle translittère les noms
 * propres au son et traduit les techniques littéralement, parce qu'il ne les a
 * jamais vus. `ベジータ` ressort en « Végitta », `フリーザ` en « Frézza ».
 *
 * Or la forme française de ces termes, nous l'avons — dans la même ligne de base
 * que leur graphie japonaise. On masque donc chaque terme connu par un jeton
 * avant de traduire, puis on réinjecte la forme officielle. Le modèle ne traduit
 * plus que ce qu'il sait traduire : la phrase autour.
 *
 * Résultat sur les mêmes phrases : « **Son Goku** a utilisé… », « **Vegeta** est
 * le prince des **Saiyans** », « **Piccolo** et **Krilin** protègent la Terre ».
 *
 * Ce module ne charge aucun modèle : il prépare le texte et recompose la
 * sortie. L'inférence vit dans `scripts/ja-traduire.ts`, parce qu'elle demande
 * 87 s de chargement et ~3 s par phrase — un traitement par lot, pas une
 * fonctionnalité de page.
 */
import type { TermeLexique } from "./anomalies";

/**
 * Jetons de substitution : `Zeta001`, `Zeta002`…
 *
 * Un marqueur symbolique (« ⟦0⟧ », « __X__ ») ne survit pas : le modèle le
 * réécrit, le traduit ou le perd. Un nom latin court suivi d'un numéro traverse,
 * parce que le moteur le prend pour un nom à recopier.
 *
 * Il traverse… presque. Mesuré sur `shenron-massive-vps` (2026-09-14) : Google
 * Traduction rend `Zeta010` en « Zêta010 » — 567 planches sur 2 081 ont gardé le
 * jeton en clair, parce que la restauration cherchait la graphie exacte. La
 * restauration tolère donc désormais la casse, les accents et un séparateur
 * (`motifJetons`), et tout jeton qui survit fait échouer la planche
 * (`jetonsResiduels`) au lieu d'atterrir en base.
 *
 * L'ancien jeu de mots nus (« Kilo », « Nova », « Puma »…) est abandonné : ce
 * sont des mots français, qu'aucun contrôle ne pouvait distinguer d'une fuite.
 */
export const PREFIXE_JETON = "Zeta";

/** Borne du nombre de termes distincts masqués par segment (`protegerTermes`). */
const MAX_JETONS = 16;

/** Le jeton numéro `n` (à partir de 1). */
function jeton(n: number, prefixe = PREFIXE_JETON, largeur = 3): string {
	return `${prefixe}${String(n).padStart(largeur, "0")}`;
}

const VOYELLES: Record<string, string> = {
	a: "[aàâäá]",
	e: "[eéèêë]",
	i: "[iîïí]",
	o: "[oôöó]",
	u: "[uùûüú]",
};

/**
 * Motif (global, insensible à la casse) d'un jeton tel qu'un moteur peut le
 * rendre : `Zeta001`, `ZETA001`, `Zêta001`, `Zeta 001`, `Zeta-001`. Le groupe 1
 * porte le numéro. `(?!\d)` empêche `Zeta001` de mordre dans `Zeta0010`.
 */
function motifJetons(prefixe = PREFIXE_JETON, largeur?: number): RegExp {
	const corps = [...prefixe.toLowerCase()]
		.map((c) => VOYELLES[c] ?? c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
		.join("");
	const chiffres = largeur ? `(\\d{${largeur}})` : `(\\d{3,4})(?!\\d)`;
	return new RegExp(`${corps}[\\s\\-_]?${chiffres}`, "giu");
}

/** Jetons encore présents dans un texte (vide = restauration complète). */
export function jetonsResiduels(texte: string, prefixe = PREFIXE_JETON, largeur?: number): string[] {
	return [...texte.matchAll(motifJetons(prefixe, largeur))].map((m) => m[0]);
}

// ── Appariement du lexique ──────────────────────────────────────────────────

/**
 * Signes qui forment un MOT avec leurs voisins de même classe.
 *
 * Le katakana n'a pas d'espace : « カプセルコーポレーション » est un seul mot, et
 * « セル » (Cell) y apparaît en sous-chaîne. La recherche par `includes` le
 * masquait — d'où les « Capsule Cell Corporation » de `shenron-vps-agent`. Un
 * terme qui commence (ou finit) par un katakana ne s'apparie donc que si le
 * signe voisin n'est PAS un katakana. Même règle pour le latin et les chiffres.
 *
 * Les kanji et les kana grammaticaux restent sans frontière : le japonais colle
 * légitimement `悟空達`, `フリーザ軍`, `ベジータは` — une frontière stricte y
 * perdrait l'essentiel des noms. Là, c'est l'appariement long d'abord qui
 * protège (`孫悟空` gagne sur `悟空`).
 *
 * Le point médian `・` (U+30FB) est un séparateur, pas une lettre : il est exclu.
 */
const KATAKANA_MOT = /[ァ-ヺー-ヿㇰ-ㇿｦ-ﾟ]/;
const LATIN_MOT = /[A-Za-z0-9À-ɏ]/;

function classeDeSigne(c: string | undefined): "katakana" | "latin" | null {
	if (!c) return null;
	if (KATAKANA_MOT.test(c)) return "katakana";
	if (LATIN_MOT.test(c)) return "latin";
	return null;
}

/** Vrai si `texte.slice(debut, fin)` n'est pas un morceau d'un mot plus long. */
export function bordsDeMot(texte: string, debut: number, fin: number): boolean {
	const initiale = classeDeSigne(texte[debut]);
	if (initiale && classeDeSigne(texte[debut - 1]) === initiale) return false;
	const finale = classeDeSigne(texte[fin - 1]);
	if (finale && classeDeSigne(texte[fin]) === finale) return false;
	return true;
}

export interface Occurrence<T> {
	debut: number;
	fin: number;
	terme: T;
}

/**
 * Occurrences retenues des termes dans le texte : **le plus long d'abord**, sans
 * chevauchement, en respectant les frontières de mot (`bordsDeMot`).
 *
 * Indépendant de l'ordre du lexique fourni : l'ancien masquage dépendait d'un
 * tri fait ailleurs (et pas toujours), et remplaçait terme par terme dans un
 * texte déjà modifié.
 */
export function occurrencesDuLexique<T extends { ja: string }>(
	texte: string,
	termes: readonly T[]
): Occurrence<T>[] {
	const parInitiale = new Map<string, T[]>();
	for (const t of termes) {
		if (!t.ja || [...t.ja].length < 2) continue;
		const liste = parInitiale.get(t.ja[0]!) ?? [];
		liste.push(t);
		parInitiale.set(t.ja[0]!, liste);
	}
	const candidates: Occurrence<T>[] = [];
	for (let i = 0; i < texte.length; i++) {
		const liste = parInitiale.get(texte[i]!);
		if (!liste) continue;
		for (const t of liste) {
			const fin = i + t.ja.length;
			if (texte.startsWith(t.ja, i) && bordsDeMot(texte, i, fin)) {
				candidates.push({ debut: i, fin, terme: t });
			}
		}
	}
	candidates.sort((a, b) => b.fin - b.debut - (a.fin - a.debut) || a.debut - b.debut);
	const occupe = new Uint8Array(texte.length);
	const retenues: Occurrence<T>[] = [];
	for (const c of candidates) {
		let libre = true;
		for (let k = c.debut; k < c.fin; k++) {
			if (occupe[k]) {
				libre = false;
				break;
			}
		}
		if (!libre) continue;
		occupe.fill(1, c.debut, c.fin);
		retenues.push(c);
	}
	return retenues.toSorted((a, b) => a.debut - b.debut);
}

/**
 * Masque les termes du lexique, en une passe, par des jetons numérotés.
 *
 * Un même terme reçoit un même jeton. Au-delà de `max` termes distincts, les
 * suivants restent en clair (`debordement`) plutôt que de partager un jeton.
 */
export function masquerTermes<T extends { ja: string }>(
	texte: string,
	termes: readonly T[],
	options: { max?: number; prefixe?: string; largeur?: number } = {}
): { masque: string; jetons: Map<string, T>; debordement: number } {
	const max = options.max ?? Number.POSITIVE_INFINITY;
	const prefixe = options.prefixe ?? PREFIXE_JETON;
	const jetons = new Map<string, T>();
	const jetonDe = new Map<string, string | null>();
	let debordement = 0;
	let masque = "";
	let curseur = 0;
	for (const o of occurrencesDuLexique(texte, termes)) {
		let j = jetonDe.get(o.terme.ja);
		if (j === undefined) {
			if (jetons.size >= max) {
				j = null;
				debordement++;
			} else {
				j = jeton(jetons.size + 1, prefixe, options.largeur);
				jetons.set(j, o.terme);
			}
			jetonDe.set(o.terme.ja, j);
		}
		if (j === null) continue;
		masque += texte.slice(curseur, o.debut) + j;
		curseur = o.fin;
	}
	masque += texte.slice(curseur);
	return { masque, jetons, debordement };
}

const echappe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Marqueurs internes de doublon absorbé (jamais présents dans une traduction). */
const ABSORBE_AVANT = "\u0001";
const ABSORBE_APRES = "\u0002";

/**
 * Réinjecte les formes françaises à la place des jetons, quelle que soit la
 * graphie que le moteur leur a donnée (`motifJetons`).
 *
 * Le moteur traduit parfois le terme ET recopie le jeton : « sur la Terre
 * Zeta003 » où `Zeta003` vaut « Terre ». Restaurer tel quel donnait les « Terre
 * Terre » de `shenron-vps-agent` ; le doublon immédiat est donc absorbé.
 *
 * `residuels` liste les jetons que la table ne connaît pas : l'appelant DOIT
 * faire échouer la planche s'il n'est pas vide.
 */
export function restaurerJetons(
	traduction: string,
	table: Map<string, string>,
	prefixe = PREFIXE_JETON,
	largeur?: number
): { texte: string; residuels: string[] } {
	const parNumero = new Map<number, string>();
	for (const [cle, fr] of table) {
		const m = /(\d{3,4})$/.exec(cle);
		if (m) parNumero.set(Number(m[1]), fr);
	}
	const texte = traduction
		.replace(motifJetons(prefixe, largeur), (brut, numero: string, decalage: number, source: string) => {
			const fr = parNumero.get(Number(numero));
			if (fr === undefined) return brut;
			const motFr = echappe(fr);
			const avant = source.slice(0, decalage);
			const apres = source.slice(decalage + brut.length);
			// Doublon absorbé : un marqueur dit de quel côté retirer l'espace qui
			// séparait le jeton du mot déjà traduit.
			if (new RegExp(`(?:^|[^\\p{L}\\p{N}])${motFr}[ \\t]*$`, "iu").test(avant)) return ABSORBE_AVANT;
			if (new RegExp(`^[ \\t]*${motFr}(?![\\p{L}\\p{N}])`, "iu").test(apres)) return ABSORBE_APRES;
			return fr;
		})
		.replace(new RegExp(`[ \\t]*${ABSORBE_AVANT}`, "g"), "")
		.replace(new RegExp(`${ABSORBE_APRES}[ \\t]*`, "g"), "");
	return { texte, residuels: jetonsResiduels(texte, prefixe, largeur) };
}

export interface TexteProtege {
	/** Texte à soumettre au modèle, termes du domaine masqués. */
	masque: string;
	/** Jeton → forme française officielle. */
	table: Map<string, string>;
	/** Termes du lexique présents mais non masqués, faute de jetons libres. */
	debordement: number;
}

/**
 * Masque les termes du lexique présents dans le texte.
 *
 * Appariement long d'abord et aux frontières de mot (`occurrencesDuLexique`) :
 * « サイヤ » ne mord plus dans « サイヤ人 », « セル » plus dans
 * « カプセルコーポレーション », quel que soit l'ordre du lexique reçu.
 *
 * Le nombre de jetons est borné (`MAX_JETONS`). Au-delà, les termes restants
 * sont laissés tels quels plutôt que réutiliser un jeton déjà pris — deux termes
 * différents derrière le même jeton produiraient une traduction fausse et
 * silencieuse. `debordement` remonte le compte.
 */
export function protegerTermes(
	texte: string,
	lexTrie: TermeLexique[],
	options: { prefixe?: string; largeur?: number } = {}
): TexteProtege {
	const { masque, jetons, debordement } = masquerTermes(
		texte,
		lexTrie.filter((t) => t.fr),
		{ max: MAX_JETONS, prefixe: options.prefixe, largeur: options.largeur }
	);
	const table = new Map<string, string>();
	for (const [j, t] of jetons) table.set(j, t.fr);
	return { masque, table, debordement };
}

/**
 * Réinjecte les formes françaises à la place des jetons (forme simple). Les
 * chaînes de dépôt doivent préférer `restaurerJetons`, qui rend aussi les jetons
 * non restaurés.
 */
export function restaurerTermes(traduction: string, table: Map<string, string>): string {
	return restaurerJetons(traduction, table).texte;
}

/**
 * Découpe un texte japonais en segments traduisibles.
 *
 * Les modèles de traduction tronquent au-delà de quelques centaines de tokens,
 * et une planche peut faire 8 171 signes. On coupe aux fins de phrase japonaises
 * (`。`, `！`, `？`) et aux sauts de ligne, jamais au milieu d'une phrase : un
 * segment tronqué se traduit en contresens plutôt qu'en phrase incomplète.
 */
export function segmentsTraduisibles(texte: string, maxSignes = 300): string[] {
	const out: string[] = [];
	let courant = "";
	// Le séparateur est conservé avec le segment qui le précède.
	for (const morceau of texte.split(/(?<=[。！？\n])/)) {
		if (courant.length + morceau.length > maxSignes && courant.trim()) {
			out.push(courant.trim());
			courant = "";
		}
		courant += morceau;
	}
	if (courant.trim()) out.push(courant.trim());
	return out;
}
