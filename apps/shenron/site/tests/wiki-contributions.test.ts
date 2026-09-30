/**
 * Contributions communautaires — les règles qui décident si une proposition
 * peut être déposée, et sur quoi.
 *
 * On ne teste pas ici l'écriture en base (elle passe par `updateWiki`, déjà
 * couvert) mais les garde-fous qui l'entourent : ce sont eux qui empêchent
 * qu'une proposition acceptée trop vite touche autre chose que du texte.
 */
import { describe, expect, test } from "bun:test";
import {
	CONTRIBUTABLE_COLUMNS,
	isContributableColumn,
	TOURNURES_NON_SOURCEES,
} from "../src/lib/contributions-shared";
import { WIKI_TABLE_SPECS } from "../src/lib/wiki-tables";

describe("champs ouverts à la contribution", () => {
	test("n'ouvre que du texte éditorial", () => {
		// Une proposition ne doit jamais pouvoir rebrancher une fiche sur une
		// autre, changer une image, ni masquer quoi que ce soit.
		for (const interdit of [
			"image",
			"cover",
			"poster",
			"visible",
			"characterId",
			"originPlanetId",
			"sortOrder",
			"slug",
			"ki",
			"stats",
		]) {
			expect(isContributableColumn(interdit)).toBe(false);
		}
	});

	test("ouvre bien l'article, la description et le corps de section", () => {
		for (const ouvert of ["article", "description", "synopsis", "body", "nameJa"]) {
			expect(isContributableColumn(ouvert)).toBe(true);
		}
	});

	test("chaque champ ouvert porte un libellé et une consigne", () => {
		for (const [col, def] of Object.entries(CONTRIBUTABLE_COLUMNS)) {
			expect(def.label.length, `libellé manquant pour ${col}`).toBeGreaterThan(0);
			expect(def.hint.length, `consigne manquante pour ${col}`).toBeGreaterThan(10);
		}
	});

	test("tout champ ouvert est réellement écrivable sur au moins une table", () => {
		// Un champ ouvert mais absent de toutes les `mutableColumns` produirait un
		// bouton qui échoue à l'acceptation — panne invisible jusqu'au premier clic.
		const ecrivables = new Set(Object.values(WIKI_TABLE_SPECS).flatMap((s) => s.mutableColumns));
		for (const col of Object.keys(CONTRIBUTABLE_COLUMNS)) {
			expect(ecrivables.has(col), `${col} n'est mutable sur aucune table`).toBe(true);
		}
	});

	test("l'article est mutable sur les 7 tables qui en portent un", () => {
		for (const t of [
			"db_characters",
			"db_planets",
			"db_transformations",
			"db_races",
			"db_techniques",
			"db_sagas",
			"db_arcs",
		]) {
			expect(WIKI_TABLE_SPECS[t]!.mutableColumns).toContain("article");
		}
	});
});

describe("détection des tournures non sourcées", () => {
	test("repère les hypothèses", () => {
		for (const phrase of [
			"Il s'agit probablement du frère de Goku.",
			"Sans doute le plus fort des Saiyans.",
			"On suppose qu'il vient de Végéta.",
			"Il semblerait que la planète ait explosé.",
		]) {
			expect(TOURNURES_NON_SOURCEES.test(phrase)).toBe(true);
		}
	});

	test("laisse passer une affirmation sourcée", () => {
		for (const phrase of [
			"Le Daizenshuu 7 donne 530 000 unités.",
			"Au tome 17, Goku atteint la planète Namek.",
			// « doute » seul n'est pas « sans doute » — pas de faux positif sur un
			// mot légitime du récit.
			"Krilin doute de sa victoire.",
		]) {
			expect(TOURNURES_NON_SOURCEES.test(phrase)).toBe(false);
		}
	});
});
