/**
 * Normalisation / translittération de noms (logique pure, portable).
 *
 * Réplique exacte de `apps/bot/src/utils/functions/normalizeName.ts` :
 * mappe les variantes Unicode stylisées (lettres mathématiques, cerclées, ...)
 * vers leur équivalent ASCII majuscule, puis translittère le reste via
 * `@sindresorhus/transliterate` (ESM pur, `sideEffects: false`).
 */

import transliterate from "@sindresorhus/transliterate";

/**
 * Normalise un nom en majuscules ASCII.
 *
 * Retourne `""` si un caractère ne peut pas être normalisé (signal de rejet,
 * conservé à l'identique du comportement bot).
 */
export function normalizeNames(name: string): string {
	name = name.normalize("NFKC");

	const alphaBlocks: [number, number][] = [
		[0x1d504, 26],
		[0x1d538, 26],
		[0x1d49c, 26],
		[0x1d4d0, 26],
		[0x1d56c, 26],
		[0x1d5a0, 26],
		[0x1d5d4, 26],
		[0x1d608, 26],
		[0x1d63c, 26],
		[0x1d670, 26],
		[0x24b6, 26],
	];

	const digitBlocks: [number, number][] = [
		[0x1d7ce, 10],
		[0x1d7d8, 10],
		[0x1d7e2, 10],
		[0x1d7ec, 10],
		[0x1d7f6, 10],
	];

	const A = "A".charCodeAt(0);
	const Z = "Z".charCodeAt(0);
	const a = "a".charCodeAt(0);
	const z = "z".charCodeAt(0);
	const zero = "0".charCodeAt(0);
	const nine = "9".charCodeAt(0);

	let normalized = "";

	for (const char of Array.from(name)) {
		const code = char.codePointAt(0);
		if (!code) return "";

		let mappedChar = "";

		if ((code >= A && code <= Z) || (code >= zero && code <= nine)) {
			mappedChar = char;
		} else if (code >= a && code <= z) {
			mappedChar = String.fromCharCode(code - 32);
		}

		if (!mappedChar) {
			for (const [start, len] of alphaBlocks) {
				if (code >= start && code < start + len) {
					mappedChar = String.fromCharCode(A + (code - start));
					break;
				}
			}
		}

		if (!mappedChar) {
			for (const [start, len] of digitBlocks) {
				if (code >= start && code < start + len) {
					mappedChar = String.fromCharCode(zero + (code - start));
					break;
				}
			}
		}

		if (!mappedChar) {
			mappedChar = transliterate(char);
		}

		if (mappedChar === "") return "";

		normalized += mappedChar;
	}

	return normalized;
}
