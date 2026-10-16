/**
 * Données de référence d'Achilléa — tables fixes partagées par toutes les
 * cibles (langues proposées à la création d'un clan ou d'une organisation).
 *
 * Ici et non dans le contrat : une liste de valeurs n'est pas une forme
 * d'échange, et elle évolue sans casser la compatibilité du protocole.
 */

import type { Country } from "@rosegriffon/achillea-types";

/** Chemins de drapeaux relatifs aux assets du front (`public/flags/`). */
export const COUNTRIES: readonly Country[] = [
	{ code: "fr", language: "Français", name: "France", flag: "flags/flag_fr.svg" },
	{ code: "en", language: "Anglais", name: "Royaume-Uni", flag: "flags/flag_en.svg" },
	{ code: "es", language: "Espagnol", name: "Espagne", flag: "flags/flag_sp.svg" },
	{ code: "de", language: "Allemand", name: "Allemagne", flag: "flags/flag_de.svg" },
	{ code: "it", language: "Italien", name: "Italie", flag: "flags/flag_it.svg" },
	{ code: "pt", language: "Portugais", name: "Portugal", flag: "flags/flag_pt.svg" },
	{ code: "jp", language: "Japonais", name: "Japon", flag: "flags/flag_jp.svg" },
];

/** Pays correspondant à un code ISO, insensible à la casse. */
export function countryByCode(code: string | null | undefined): Country | null {
	if (!code) return null;
	const normalized = code.toLowerCase();
	return COUNTRIES.find((country) => country.code === normalized) ?? null;
}

/** Libellé de langue d'un code ISO, ou le code brut s'il est inconnu. */
export function languageLabel(code: string | null | undefined): string {
	return countryByCode(code)?.language ?? (code ?? "");
}
