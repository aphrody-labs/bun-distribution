// SPDX-License-Identifier: Apache-2.0
/**
 * Symbole et format de la monnaie du serveur, les Zénis.
 *
 * Un seul endroit pour le symbole : il était écrit à la main sous trois formes
 * (« ¥ », « zénis », « zéni ») selon l'écran. « Ƶ » (U+01B5) est lu comme une
 * lettre par les polices : pas un emoji, et il ne se confond pas avec le yen.
 * L'espace insécable empêche le symbole de partir seul à la ligne.
 */
export const ZENI_SYMBOL = "Ƶ";

/** `1250` → `1 250 Ƶ` (format fr-FR, espace insécable). */
export function formatZeni(n: number | null | undefined): string {
	const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
	return `${v.toLocaleString("fr-FR")}\u00a0${ZENI_SYMBOL}`;
}

/** Montant signé pour un gain ou une perte : `+100 Ƶ`, `−50 Ƶ`. */
export function formatZeniDelta(n: number): string {
	const signe = n > 0 ? "+" : n < 0 ? "−" : "";
	return `${signe}${formatZeni(Math.abs(n))}`;
}
