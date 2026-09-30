/**
 * Doublon entre une case de stat et une rubrique Powerscaling.
 *
 * La fiche Goku affichait « Vitesse : Super-lumineuse » en grande case, et
 * juste en dessous les onglets « Vitesse de Combat » et « Vitesse de
 * Déplacement ». Deux endroits pour la même notion — la case est donc écartée
 * quand une rubrique PWS couvre déjà le sujet.
 *
 * Ce test fige la règle de rapprochement : trop lâche, elle effacerait des
 * stats légitimes ; trop stricte, le doublon revient au premier synonyme.
 */
import { describe, expect, test } from "bun:test";
import { PWS_GROUP_PRESETS } from "@/lib/wiki-fields";
import { sectionSlug } from "@/lib/wiki-article-sections";

const rubriques = new Set(PWS_GROUP_PRESETS.flatMap((p) => [sectionSlug(p.label), p.key]));
function doublonPws(label: string): boolean {
	const slug = sectionSlug(label);
	if (rubriques.has(slug)) return true;
	return [...rubriques].some((r) => r.startsWith(slug) || slug.startsWith(r));
}

describe("stat qui double une rubrique PWS", () => {
	test("le cas qui a motivé la règle", () => {
		expect(doublonPws("Vitesse")).toBe(true);
	});

	test("les libellés exacts des rubriques PWS", () => {
		for (const p of PWS_GROUP_PRESETS) expect(doublonPws(p.label)).toBe(true);
	});

	test("les variantes de casse et d'accent", () => {
		expect(doublonPws("VITESSE")).toBe(true);
		expect(doublonPws("Durabilite")).toBe(true);
		expect(doublonPws("Intelligence")).toBe(true);
	});

	test("une stat SANS équivalent PWS est conservée", () => {
		// Ce sont les cases qui ont encore un sens à côté du groupe Powerscaling.
		for (const l of ["Rang", "Taille", "Poids", "Groupe sanguin", "Âge", "Ki de base"]) {
			expect(doublonPws(l)).toBe(false);
		}
	});

	test("la règle ne mange pas un libellé qui commence pareil sans être le même sujet", () => {
		// « Fort » n'est pas « Force de Frappe » : c'est la RUBRIQUE qui doit
		// commencer par la stat, pas l'inverse au premier caractère commun.
		expect(doublonPws("F")).toBe(true); // cas limite assumé : une stat d'une lettre n'existe pas
		expect(doublonPws("Endurance mentale")).toBe(false);
	});
});
