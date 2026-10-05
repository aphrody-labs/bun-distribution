/**
 * Japonais — détection des fautes de lecture par proximité au lexique. Règles pures.
 *
 * Les transcriptions viennent d'un modèle de vision lisant des scans japonais.
 * Il se trompe surtout sur les noms propres, et toujours de la même façon : un
 * ou deux signes de travers sur un mot que l'on connaît. Relevé sur le corpus :
 * « ミスターボポ » pour ミスターポポ, « ビッコロ » pour ピッコロ, « フルマ » pour
 * ブルマ, « ペジータ » pour ベジータ.
 *
 * Une graphie n'est suspecte que si QUATRE filtres la laissent passer, chacun
 * réglant une famille de faux positifs que le précédent laissait entrer :
 *
 *   1. l'analyseur morphologique la marque inconnue de son dictionnaire ;
 *   2. **JMdict** ne la connaît pas non plus — c'est ce qui absout les emprunts
 *      à l'anglais, absents des dictionnaires morphologiques mais parfaitement
 *      corrects (コミックス « comics », バーサス « versus », スライム « slime ») ;
 *   3. elle n'est ni un terme du domaine, ni un **morceau** d'un terme du
 *      domaine — l'analyseur découpe les noms qu'il ignore, et « ンクス » (bout
 *      de トランクス) ressortait 105 fois comme mot inconnu ;
 *   4. la forme correcte proposée existe vraiment dans le corpus, et plus
 *      souvent que la graphie suspecte.
 *
 * Mesuré sur 300 planches : 4 858 tokens inconnus du dictionnaire → 92
 * suggestions. Aucune n'est appliquée automatiquement — le détecteur propose,
 * la relecture tranche.
 */
import { normaliserJa } from "./normalisation";

export interface TermeLexique {
	ja: string;
	fr: string;
	kind: string;
}

export interface Suggestion {
	/** Graphie telle qu'elle figure dans la transcription. */
	lu: string;
	/** Graphie du lexique dont elle est proche. */
	attendu: string;
	fr: string;
	kind: string;
	/** Nombre de signes à changer (1 ou 2). */
	distance: number;
}

/**
 * Distance d'édition, abandonnée dès qu'elle dépasse `max`.
 *
 * On ne veut pas la vraie distance, seulement savoir si elle reste sous le
 * seuil : sortir tôt évite de comparer chaque graphie inconnue au lexique
 * entier, mot par mot et signe par signe.
 */
export function distanceBornee(a: string, b: string, max: number): number {
	if (Math.abs(a.length - b.length) > max) return max + 1;
	let precedente = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 1; i <= a.length; i++) {
		const courante = [i];
		let minLigne = i;
		for (let j = 1; j <= b.length; j++) {
			const cout = a[i - 1] === b[j - 1] ? 0 : 1;
			const v = Math.min(courante[j - 1] + 1, precedente[j] + 1, precedente[j - 1] + cout);
			courante.push(v);
			if (v < minLigne) minLigne = v;
		}
		// Toute la ligne dépasse déjà le seuil : aucune suite ne le fera redescendre.
		if (minLigne > max) return max + 1;
		precedente = courante;
	}
	return precedente[b.length];
}

/**
 * Index d'appartenance du lexique du domaine.
 *
 * `fragments` contient toutes les SOUS-CHAÎNES des termes, pas seulement leurs
 * débuts : l'analyseur ne connaît pas « トランクス » et le coupe, si bien que
 * « ンクS » ou « ンクス » remontent comme mots inconnus. Un morceau de terme
 * connu n'est pas une faute de lecture, où qu'il tombe dans le mot.
 */
export interface IndexLexique {
	exacts: Set<string>;
	fragments: Set<string>;
}

export function indexerLexique(lex: TermeLexique[]): IndexLexique {
	const exacts = new Set<string>();
	const fragments = new Set<string>();
	for (const t of lex) {
		const n = normaliserJa(t.ja);
		if (!n) continue;
		exacts.add(n);
		for (let debut = 0; debut < n.length; debut++) {
			for (let fin = debut + 2; fin <= n.length; fin++) {
				const sous = n.slice(debut, fin);
				if (sous !== n) fragments.add(sous);
			}
		}
	}
	return { exacts, fragments };
}

/** Trie le lexique du plus long au plus court — l'appariement long d'abord. */
export function trierLexique(lex: TermeLexique[]): TermeLexique[] {
	return lex.slice().toSorted((a, b) => b.ja.length - a.ja.length);
}

/**
 * Terme du lexique dont `mot` est probablement une lecture fautive.
 *
 * `poidsDe` départage les candidats à distance égale — en pratique, leur nombre
 * d'occurrences dans le corpus. Sans lui, « ペジータ » se faisait corriger en
 * « ゴジータ » (Gogeta, 13 occurrences) plutôt qu'en « ベジータ » (Vegeta, 197) :
 * les deux sont à un signe près, et c'est l'ordre du lexique qui tranchait.
 */
export function suggerer(
	mot: string,
	lexTrie: TermeLexique[],
	index: IndexLexique,
	poidsDe?: (ja: string) => number
): Suggestion | null {
	const norme = normaliserJa(mot);
	// Sous trois signes, tout ressemble à tout : on ne suggère rien.
	if (norme.length < 3) return null;
	if (index.exacts.has(norme)) return null;
	if (index.fragments.has(norme)) return null;

	const max = norme.length <= 4 ? 1 : 2;
	let meilleur: Suggestion | null = null;
	let meilleurPoids = -1;
	for (const t of lexTrie) {
		const cible = normaliserJa(t.ja);
		if (Math.abs(cible.length - norme.length) > max) continue;
		const d = distanceBornee(norme, cible, max);
		if (d > max || d === 0) continue;
		const poids = poidsDe?.(t.ja) ?? 0;
		if (!meilleur || d < meilleur.distance || (d === meilleur.distance && poids > meilleurPoids)) {
			meilleur = { lu: mot, attendu: t.ja, fr: t.fr, kind: t.kind, distance: d };
			meilleurPoids = poids;
		}
	}
	return meilleur;
}

/**
 * Garde une suggestion seulement si la forme correcte domine dans le corpus.
 *
 * C'est le filtre qui distingue une faute d'un mot rare : « コニック » n'apparaît
 * nulle part, donc corriger « コミックス » vers lui n'a aucun sens. À l'inverse,
 * « ベジータ » est partout — corriger « ペジータ » vers lui en a un.
 */
export function retenirParFrequence(
	s: Suggestion,
	occurrences: (graphie: string) => number
): boolean {
	return occurrences(s.attendu) > occurrences(s.lu);
}
