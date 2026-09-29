/**
 * Word-level attestation of a Japanese spelling in a transcribed planche.
 *
 * Shared by `fill-character-identity.ts` (automatic proposals) and
 * `fill-ja-identities.ts` (reviewed evidence file): both must judge an
 * occurrence the same way, or a spelling refused by one would be written by
 * the other.
 */

const KATAKANA = /[゠-ヿ]/;

/**
 * Index of the first occurrence of `ja` that stands as a word, or -1.
 *
 * A katakana spelling inside a longer katakana word proves nothing: キャベ
 * (Cabba) was "attested" by キャベツ (cabbage). A katakana edge must therefore
 * not touch another katakana (ー included). A kanji edge cannot be bounded this
 * way — 孫悟天登場 is a legitimate occurrence — and is accepted as is.
 */
export function attestedAt(text: string, ja: string): number {
	if (!ja) return -1;
	const leftKana = KATAKANA.test(ja[0]!);
	const rightKana = KATAKANA.test(ja.at(-1)!);
	let from = 0;
	for (;;) {
		const i = text.indexOf(ja, from);
		if (i === -1) return -1;
		const leftOk = !leftKana || !KATAKANA.test(text[i - 1] ?? "");
		const rightOk = !rightKana || !KATAKANA.test(text[i + ja.length] ?? "");
		if (leftOk && rightOk) return i;
		from = i + 1;
	}
}
