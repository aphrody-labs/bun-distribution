/**
 * Japonais — normalisation et détection d'écriture. Règles pures.
 *
 * Le corpus des databooks est japonais à 60 % (mesuré sur 300 planches,
 * 243 633 signes). Aucune des trois écritures ne se comporte comme du latin :
 * pas d'espaces entre les mots, deux syllabaires plus les idéogrammes, et une
 * ponctuation propre qui varie d'une source à l'autre.
 */

/** Hiragana — syllabaire des mots grammaticaux et des lectures. */
const HIRAGANA = /[ぁ-ゟ]/;
/** Katakana — emprunts, onomatopées, et l'essentiel des noms propres de fiction. */
export const KATAKANA = /[゠-ヿｦ-ﾟ]/;
/** Idéogrammes (kanji), plage unifiée CJK. */
const KANJI = /[一-鿿㐀-䶿]/;
/** Au moins un signe japonais, quelle que soit l'écriture. */
const JAPONAIS = /[ぁ-ゟ゠-ヿｦ-ﾟ一-鿿㐀-䶿]/;

export function contientJaponais(s: string): boolean {
	return JAPONAIS.test(s);
}

/** Part de signes japonais dans un texte, entre 0 et 1. */
export function proportionJaponais(s: string): number {
	if (!s) return 0;
	let n = 0;
	for (const c of s) if (JAPONAIS.test(c)) n++;
	return n / [...s].length;
}

/**
 * Forme de comparaison d'une graphie japonaise.
 *
 * Retire les séparateurs de noms propres et les espaces. Motif vécu : le
 * lexique du wiki écrit « ミスター·ポポ » avec un point médian, le corpus des
 * planches écrit « ミスターポポ » sans. Sans cette normalisation, la faute de
 * lecture la plus fréquente du corpus (32 occurrences de « ミスターボポ ») était
 * écartée au motif que sa forme correcte « n'apparaissait jamais ».
 *
 * Les trois points médians existent bel et bien en Unicode et se mélangent
 * dans les sources : `・` (U+30FB), `･` (U+FF65) et `·` (U+00B7).
 */
export function normaliserJa(s: string): string {
	return s.replace(/[・･·\s]/g, "");
}

/**
 * Katakana pleine chasse → hiragana.
 *
 * kuromoji rend les lectures en katakana (`ソンゴクウ`) alors que le furigana
 * s'écrit en hiragana (`そんごくう`). L'écart entre les deux syllabaires est
 * d'exactement 0x60 points de code, sur la plage principale seulement — les
 * demi-chasse et les signes de prolongation en sont exclus.
 */
export function katakanaVersHiragana(s: string): string {
	let out = "";
	for (const c of s) {
		const cp = c.codePointAt(0)!;
		out += cp >= 0x30a1 && cp <= 0x30f6 ? String.fromCodePoint(cp - 0x60) : c;
	}
	return out;
}

/**
 * Le mot a-t-il besoin d'un furigana ?
 *
 * Inutile sur ce qui est déjà en kana : n'annoter que ce qui porte un kanji.
 */
export function besoinFurigana(surface: string, lecture: string | null): boolean {
	if (!lecture) return false;
	if (!KANJI.test(surface)) return false;
	return katakanaVersHiragana(lecture) !== surface;
}
