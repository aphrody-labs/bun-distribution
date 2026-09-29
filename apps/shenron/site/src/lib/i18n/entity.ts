// SPDX-License-Identifier: Apache-2.0

/**
 * Names of wiki entities in the reader's language.
 *
 * The database carries three namings for characters, planets, techniques,
 * sagas, episodes, films and games: `name` (French), `name_ja` (Japanese) and
 * `name_romaji` (Hepburn). Pages showed the French one only. This is the single
 * place that decides which to print for a locale, so no component picks a
 * column by hand.
 */
import type { SupportedLocale } from "./types";

export interface TrilingualName {
	name: string;
	nameJa?: string | null;
	nameRomaji?: string | null;
}

/** The name to print first for a locale, with a secondary name when it adds information. */
export function localizedName(entity: TrilingualName, locale: SupportedLocale): { primary: string; secondary: string | null } {
	const ja = clean(entity.nameJa);
	const romaji = clean(entity.nameRomaji);
	const fr = entity.name;
	switch (locale) {
		case "ja":
			return ja ? { primary: ja, secondary: fr } : { primary: fr, secondary: romaji };
		case "en":
			// English readers know the Hepburn form; Japanese stays as the reference.
			return romaji ? { primary: romaji, secondary: ja ?? fr } : { primary: fr, secondary: ja };
		default:
			return { primary: fr, secondary: ja };
	}
}

/** Japanese fields sometimes hold Latin text (see memory « name_ja pas toujours japonais »). */
function clean(value: string | null | undefined): string | null {
	const v = value?.trim();
	if (!v) return null;
	return v;
}

/** `lang` attribute for a printed name, so screen readers pronounce it right. */
export function langOfName(entity: TrilingualName, printed: string): "fr" | "ja" | "ja-Latn" {
	if (printed === clean(entity.nameJa) && /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(printed)) return "ja";
	if (printed === clean(entity.nameRomaji)) return "ja-Latn";
	return "fr";
}
