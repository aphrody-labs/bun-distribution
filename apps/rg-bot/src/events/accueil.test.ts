/**
 * Tests du gabarit d'accueil.
 *
 * Le texte de bienvenue est réglable par le staff, et il est ensuite injecté
 * dans un message envoyé à tout un salon. Deux choses doivent tenir : que les
 * jetons soient remplacés PARTOUT (un `{membre}` oublié se lit tel quel devant
 * deux mille personnes), et qu'aucune autre substitution ne se produise — le
 * champ n'est pas un langage.
 */
import { describe, expect, test } from "bun:test";

import { remplirGabarit } from "../lib/accueil-gabarit";

const VALEURS = { compte: 1_903, membre: "<@42>", serveur: "Rose Griffon" };

describe("gabarit d'accueil", () => {
	test("les trois jetons sont remplacés", () => {
		expect(remplirGabarit("{membre} rejoint {serveur} — {compte} membres !", VALEURS)).toBe(
			"<@42> rejoint Rose Griffon — 1903 membres !"
		);
	});

	test("un jeton répété est remplacé à CHAQUE occurrence", () => {
		// `replace` sans `All` n'aurait remplacé que la première : le second
		// `{membre}` se lirait tel quel dans le salon.
		expect(remplirGabarit("{membre} {membre}", VALEURS)).toBe("<@42> <@42>");
	});

	test("un texte sans jeton passe tel quel", () => {
		expect(remplirGabarit("Bienvenue !", VALEURS)).toBe("Bienvenue !");
	});

	test("aucun autre motif n'est interprété — le champ n'est pas un langage", () => {
		const brut = "{inconnu} ${process.env.SECRET} {{membre}} <@&123>";
		expect(remplirGabarit(brut, VALEURS)).toBe("{inconnu} ${process.env.SECRET} {<@42>} <@&123>");
	});

	test("un texte vide reste vide", () => {
		expect(remplirGabarit("", VALEURS)).toBe("");
	});
});
