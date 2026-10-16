/**
 * Tests de la mise en forme Achillea.
 *
 * Ils portent sur ce qui casse réellement en production : le dépassement de la limite
 * d'un champ d'embed sur un serveur peuplé, et le rangement des salons sous leurs
 * catégories. Les chiffres utilisés viennent du scan réel d'Achillea du 14/8/2026
 * (102 rôles, 113 salons), pas d'un exemple inventé.
 */

import { describe, expect, test } from "bun:test";

import {
	bloquerLignes,
	compterRolesGeres,
	couleurHex,
	dateScan,
	grouperParCategorie,
	libelleType,
	LIMITE_CHAMP,
	repartitionParType,
	rolesUtiles,
} from "./achillea-format";
import type { RoleAchillea, SalonAchillea } from "../services/achillea";

const role = (p: Partial<RoleAchillea> & { id: string; name: string }): RoleAchillea => ({
	color: 0,
	hoist: false,
	managed: false,
	mentionable: false,
	permissions: null,
	position: 0,
	...p,
});

const salon = (p: Partial<SalonAchillea> & { id: string; name: string; type: number }): SalonAchillea => ({
	nsfw: false,
	parent_id: null,
	position: 0,
	topic: null,
	...p,
});

describe("types de salons", () => {
	test("les types connus sont en français, les inconnus restent lisibles", () => {
		expect(libelleType(0)).toBe("textuel");
		expect(libelleType(2)).toBe("vocal");
		expect(libelleType(4)).toBe("catégorie");
		expect(libelleType(15)).toBe("forum");
		// Discord ajoute des types : un salon d'un type inconnu doit rester VISIBLE.
		// L'omettre ferait mentir le décompte affiché à côté.
		expect(libelleType(99)).toBe("type 99");
	});
});

describe("rôles", () => {
	test("@everyone est retiré et l'ordre suit la hiérarchie Discord", () => {
		const liste = rolesUtiles([
			role({ id: "1".repeat(18), name: "@everyone", position: 0 }),
			role({ id: "2".repeat(18), name: "Membre", position: 1 }),
			role({ id: "3".repeat(18), name: "Administrateur", position: 50 }),
		]);
		expect(liste.map((r) => r.name)).toEqual(["Administrateur", "Membre"]);
	});

	test("les rôles d'intégration sont comptés à part", () => {
		expect(
			compterRolesGeres([
				role({ id: "1".repeat(18), name: "AchilleaBot", managed: true }),
				role({ id: "2".repeat(18), name: "Membre" }),
			])
		).toBe(1);
	});

	test("la couleur 0 n'est pas du noir, c'est l'absence de couleur", () => {
		expect(couleurHex(0)).toBe("—");
		expect(couleurHex(0xff_00_88)).toBe("#ff0088");
		// Le remplissage à six chiffres compte : #0f9 ne serait pas la même couleur.
		expect(couleurHex(0x00_0f_f9)).toBe("#000ff9");
	});
});

describe("salons", () => {
	test("la répartition par type est ordonnée du plus fréquent au moins fréquent", () => {
		const liste = [
			salon({ id: "1".repeat(18), name: "a", type: 0 }),
			salon({ id: "2".repeat(18), name: "b", type: 0 }),
			salon({ id: "3".repeat(18), name: "c", type: 2 }),
		];
		expect(repartitionParType(liste)).toEqual([
			["textuel", 2],
			["vocal", 1],
		]);
	});

	test("les salons se rangent sous le NOM de leur catégorie, pas son identifiant", () => {
		const categorie = "4".repeat(18);
		const groupes = grouperParCategorie([
			salon({ id: categorie, name: "Informations", type: 4 }),
			salon({ id: "5".repeat(18), name: "regles", type: 0, parent_id: categorie, position: 1 }),
			salon({ id: "6".repeat(18), name: "annonces", type: 0, parent_id: categorie, position: 0 }),
			salon({ id: "7".repeat(18), name: "bienvenue", type: 0 }),
		]);

		// Les salons sans catégorie viennent en tête, comme dans Discord.
		expect(groupes[0]?.categorie).toBeNull();
		expect(groupes[0]?.salons.map((s) => s.name)).toEqual(["bienvenue"]);

		const info = groupes.find((g) => g.categorie === "Informations");
		expect(info).toBeDefined();
		// Ordre interne = position, pas ordre d'arrivée.
		expect(info?.salons.map((s) => s.name)).toEqual(["annonces", "regles"]);
		// La catégorie ne se contient pas elle-même.
		expect(groupes.some((g) => g.salons.some((s) => s.type === 4))).toBe(false);
	});
});

describe("découpage pour un embed", () => {
	test("un bloc ne dépasse jamais la limite d'un champ, mention de troncature comprise", () => {
		const lignes = Array.from({ length: 102 }, (_, i) => `#${i} ${"nom-de-role-assez-long".repeat(2)}`);
		const bloc = bloquerLignes(lignes);
		expect(bloc.length).toBeLessThanOrEqual(LIMITE_CHAMP);
		// Et il DIT ce qu'il a coupé : un décompte de 102 dans le titre avec quarante
		// lignes affichées et rien d'autre serait un mensonge.
		expect(bloc).toMatch(/… et \d+ de plus$/u);
	});

	test("une liste qui tient est rendue entière, sans mention", () => {
		const bloc = bloquerLignes(["un", "deux", "trois"]);
		expect(bloc).toBe("un\ndeux\ntrois");
	});

	test("une liste vide ne rend pas une chaîne vide (Discord refuse un champ vide)", () => {
		expect(bloquerLignes([])).toBe("—");
	});
});

describe("date de scan", () => {
	test("l'absence de scan se dit, elle ne s'affiche pas comme une date", () => {
		expect(dateScan(null)).toBe("jamais scanné");
	});

	test("le format Postgres est converti en horodatage Discord relatif", () => {
		// Forme rendue par l'API : « 2026-08-14 18:29:55.510814+00 », espace et non « T ».
		expect(dateScan("2026-08-14 18:29:55.510814+00")).toMatch(/^<t:\d+:R>$/u);
	});
});
