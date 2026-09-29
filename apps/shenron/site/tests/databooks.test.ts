/**
 * Databooks — normalisation des pages et garde d'identifiant.
 *
 * `bot.db_databooks.pages` est un jsonb : il a déjà été écrit en scalaire par le
 * passé (piège `sql.json` documenté dans CLAUDE.md), et 21 des 318 fiches n'ont
 * aucune page. Le lecteur ne doit jamais tomber là-dessus.
 *
 * L'identifiant, lui, arrivait en `parseInt(segment, 10)` : `/wiki/databooks/abc`
 * produisait `NaN`, Postgres rejetait `NaN` sur un `bigint`, et l'erreur était
 * avalée par `safe()` — un 404 finissait par s'afficher, après un aller-retour
 * base inutile et une ligne d'erreur par URL malformée.
 */
import { describe, expect, test } from "bun:test";
import { isDatabookIndexable, normalizePages, parseDatabookId } from "../src/lib/databooks-rules";

describe("normalizePages", () => {
	test("une valeur non tableau ne casse rien", () => {
		for (const v of [null, undefined, "pages", 42, { 0: "x" }]) {
			expect(normalizePages(v)).toEqual([]);
		}
	});

	test("les entrées non exploitables sont écartées", () => {
		expect(normalizePages([null, "x", 3, { number: 1, image: "a.jpg", text: null }])).toEqual([
			{ number: 1, image: "a.jpg", text: null, verifiee: false },
		]);
	});

	test("un numéro absent ou aberrant retombe sur le rang", () => {
		const r = normalizePages([{ image: "a.jpg" }, { number: -4, image: "b.jpg" }]);
		expect(r.map((p) => p.number)).toEqual([1, 2]);
	});

	test("les chaînes vides deviennent null (pas de page fantôme au rendu)", () => {
		const [p] = normalizePages([{ number: 1, image: "   ", text: "" }]);
		expect(p).toEqual({ number: 1, image: null, text: null, verifiee: false });
	});

	test("le drapeau de relecture manuelle est relu tel quel", () => {
		// Sans lui, une planche acquittée (« vérifier quand même ») redeviendrait
		// « à vérifier » au premier enregistrement du studio, qui renvoie le
		// tableau `pages` entier.
		const [p] = normalizePages([{ number: 1, image: "a.jpg", text: "3月号", verifiee: true }]);
		expect(p!.verifiee).toBe(true);
	});

	test("un numéro décimal est tronqué", () => {
		expect(normalizePages([{ number: 3.9, image: "a.jpg" }])[0]!.number).toBe(3);
	});
});

describe("garde d'identifiant", () => {
	test("accepte un entier positif", () => {
		expect(parseDatabookId("42")).toBe(42);
	});

	test("rejette tout ce qui ferait un NaN ou un bigint invalide côté Postgres", () => {
		for (const v of ["abc", "1abc", "-1", "0", "", " 1", "1.5", "1e3", "999999999999999999999"]) {
			expect(parseDatabookId(v)).toBeNull();
		}
	});
});

describe("isDatabookIndexable", () => {
	test("une fiche avec des planches est indexable", () => {
		expect(isDatabookIndexable({ description: null, pages: [{ image: "a.jpg" }] })).toBe(true);
	});

	test("une planche transcrite suffit, même sans image", () => {
		expect(isDatabookIndexable({ description: null, pages: [{ text: "du texte" }] })).toBe(true);
	});

	test("une description substantielle suffit, même sans planche", () => {
		expect(
			isDatabookIndexable({
				description: "Recueil des illustrations couleur de la première série, publié en 1995.",
				pages: [],
			})
		).toBe(true);
	});

	test("ni planche ni description : hors index", () => {
		// Cas réel : 21 fiches sur 318, dont les 5 interviews en entier.
		expect(isDatabookIndexable({ description: null, pages: [] })).toBe(false);
		expect(isDatabookIndexable({ description: "—", pages: [] })).toBe(false);
		expect(isDatabookIndexable({ description: "  ", pages: null })).toBe(false);
	});

	test("des planches vides ne comptent pas pour du contenu", () => {
		expect(isDatabookIndexable({ description: null, pages: [{ image: null, text: "" }] })).toBe(
			false
		);
	});

	test("un scan public dragonballcn rend une fiche indexable", () => {
		expect(
			isDatabookIndexable({
				description: null,
				pages: [
					{
						image: "https://comic.dragonballcn.com/list/book/001.jpg",
						text: "",
					},
				],
			})
		).toBe(true);
	});

	test("la règle se répare seule quand une transcription arrive", () => {
		const avant = { description: null, pages: [{ image: null, text: "" }] };
		expect(isDatabookIndexable(avant)).toBe(false);
		const apres = { description: null, pages: [{ image: null, text: "planche transcrite" }] };
		expect(isDatabookIndexable(apres)).toBe(true);
	});
});
