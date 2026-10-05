// SPDX-License-Identifier: Apache-2.0

/**
 * The Dragon Ball glossary that machine translation must never touch.
 *
 * Measured, not assumed: asking Google to translate « Le Kaméhaméha de Son
 * Goku » into English returns *The Goku Sound Camel*. Proper nouns of the
 * series — characters, techniques, planets, races, transformations — are not
 * words, they are names, and a generic engine has no reason to know that.
 *
 * So every string goes through `protect()` before translation and `restore()`
 * after: each known term becomes an opaque token (`⟦3⟧`) the engine carries
 * across, reordering it as the target grammar requires (verified: « Le ⟦0⟧ de
 * ⟦1⟧ » → « ⟦1⟧ の ⟦0⟧ »), and comes back as the term spelled for the target
 * language — the Japanese name for Japanese, the canonical Latin form
 * otherwise.
 *
 * The term list lives in `messages/glossary.json`, built from our own tables by
 * `scripts/i18n-glossary-build.ts`. It is committed so translation works
 * without a database, and so the protected vocabulary is reviewable.
 */
import glossaireBrut from "../../../messages/glossary.json";
import type { SupportedLocale } from "./types";

export interface GlossaryTerm {
	/** The reference (French) spelling, as printed by the site. */
	fr: string;
	/** Japanese spelling, only when the source really is Japanese script. */
	ja?: string;
	/** Hepburn romanisation, when the corpus carries one. */
	romaji?: string;
}

/** Terms longest first: « Super Saiyan Blue » must match before « Super Saiyan ». */
export const GLOSSARY: GlossaryTerm[] = [...(glossaireBrut as GlossaryTerm[])].toSorted(
	(a, b) => b.fr.length - a.fr.length
);

const TOKEN = /⟦(\d+)⟧/g;

/** A token that survives translation: no letters to translate, no spaces to split. */
function token(index: number): string {
	return `⟦${index}⟧`;
}

/**
 * Same string, diacritics removed, **length preserved**.
 *
 * The site writes « Kaméhaméha » and « Kaiōken »; the table stores
 * « Kamehameha » and « Kaioken ». Both spell the same technique, so matching
 * must ignore the accents — but positions have to stay aligned with the
 * original text, or the slice that rebuilds the sentence would cut mid-word.
 * Folding character by character keeps one output character per input one.
 */
function fold(value: string): string {
	let out = "";
	for (const c of value) {
		const nu = c.normalize("NFD").replace(/\p{M}/gu, "");
		out += nu.length === 1 ? nu : c;
	}
	return out;
}

/**
 * Word boundary on both sides, Unicode-aware, and **case-sensitive**.
 *
 * A plain `includes` would match « Boo » inside « Boobies » and « Ki » inside
 * « Kinto-Un ». Hyphen and apostrophe count as boundaries, since that is how
 * the series spells « Kinto-Un » and « l'Au-delà ».
 *
 * Case matters because Toriyama named his cast after groceries: the roster
 * holds Acide, Carotte, Radis and Pomme. Matching « acide » in « une pluie
 * acide » would freeze an ordinary adjective as a proper noun in every
 * language. A capital is exactly what tells the name from the word.
 */
function boundedMatches(haystack: string, needle: string): number[] {
	const positions: number[] = [];
	const foin = fold(haystack);
	const aiguille = fold(needle);
	let from = 0;
	for (;;) {
		const at = foin.indexOf(aiguille, from);
		if (at === -1) break;
		const before = haystack[at - 1];
		const after = haystack[at + needle.length];
		const isWord = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);
		if (!isWord(before) && !isWord(after)) positions.push(at);
		from = at + needle.length;
	}
	return positions;
}

export interface Protected {
	/** The text with every known term replaced by a token. */
	text: string;
	/** Terms in token order. */
	terms: GlossaryTerm[];
}

/** Replaces every glossary term with an opaque token. */
export function protect(text: string, glossary: GlossaryTerm[] = GLOSSARY): Protected {
	const terms: GlossaryTerm[] = [];
	let out = text;
	for (const term of glossary) {
		if (!boundedMatches(out, term.fr).length) continue;
		const index = terms.length;
		terms.push(term);
		// Rebuild rather than `replaceAll`, so the boundary rule applies to every
		// occurrence and the term's own spelling is never used as a regex.
		let rebuilt = "";
		let cursor = 0;
		for (const at of boundedMatches(out, term.fr)) {
			rebuilt += out.slice(cursor, at) + token(index);
			cursor = at + term.fr.length;
		}
		out = rebuilt + out.slice(cursor);
	}
	return { text: out, terms };
}

/** The spelling of a term for a target language. */
export function spell(term: GlossaryTerm, locale: SupportedLocale): string {
	if (locale === "ja" && term.ja) return term.ja;
	if (locale === "en" && term.romaji) return term.romaji;
	return term.fr;
}

/**
 * Puts the terms back, in the target language.
 *
 * A token the engine dropped is an error, not a detail: the sentence would
 * silently lose the name it was about. The caller gets `missing` and decides
 * (the translation script refuses the string).
 */
export function restore(
	translated: string,
	terms: GlossaryTerm[],
	locale: SupportedLocale
): { text: string; missing: number[] } {
	const seen = new Set<number>();
	const text = translated.replace(TOKEN, (whole, raw: string) => {
		const index = Number(raw);
		const term = terms[index];
		if (!term) return whole;
		seen.add(index);
		return spell(term, locale);
	});
	const missing = terms.map((_, i) => i).filter((i) => !seen.has(i));
	return { text, missing };
}
