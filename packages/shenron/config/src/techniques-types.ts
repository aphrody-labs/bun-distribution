// SPDX-License-Identifier: Apache-2.0

/**
 * techniques-types — d'où vient le classement des techniques, et comment le dire.
 *
 * `bot.db_techniques.type` ne porte pas une catégorie de l'œuvre : ce sont les
 * **slots de compétence de Xenoverse 2** (`super`, `ultimate`, `evasive`,
 * `awoken`), hérités de l'import du jeu. L'index les traduisait déjà et
 * affichait une note de provenance ; la fiche, elle, imprimait la valeur brute
 * — « ultimate », en anglais, présenté comme si l'œuvre classait ainsi ses
 * techniques.
 *
 * Ce module est le registre unique des deux côtés. Module **pur**, client-safe.
 */

/** Libellés français des slots de compétence Xenoverse 2. */
export const LIBELLES_TYPE: Record<string, string> = {
	super: "Attaques spéciales",
	ultimate: "Attaques ultimes",
	evasive: "Esquives et déplacements",
	awoken: "Éveils et transformations",
	Autre: "Non classées",
};

/**
 * Libellé d'un type, ou un repli neutre.
 *
 * Le repli n'est PAS « Autre » mais « Capacité » : 120 des 825 techniques n'ont
 * pas de type, et les ranger sous une étiquette de jeu qu'elles ne portent pas
 * leur inventerait une provenance.
 */
export function libelleType(type: string | null | undefined): string {
	const t = type?.trim();
	if (!t) return "Capacité";
	return LIBELLES_TYPE[t] ?? t;
}

/** Vrai si la valeur vient bien du classement de jeu (et non d'une saisie libre). */
export function estTypeDeJeu(type: string | null | undefined): boolean {
	const t = type?.trim();
	return !!t && t !== "Autre" && t in LIBELLES_TYPE;
}

/**
 * Mention de provenance à afficher partout où ce classement apparaît. Une seule
 * phrase, identique sur l'index et sur la fiche : deux formulations différentes
 * pour la même réserve donnent l'impression que l'une des deux est facultative.
 */
export const NOTE_PROVENANCE =
	"Ce classement reprend les catégories de compétence des jeux Xenoverse 2, pas une taxonomie de l'œuvre.";
