import { describe, expect, test } from "bun:test";
import { GLOSSARY, protect, restore, spell } from "@/lib/i18n/glossary";

describe("glossaire", () => {
	test("le corpus protégé est chargé et trié du plus long au plus court", () => {
		expect(GLOSSARY.length).toBeGreaterThan(500);
		for (let i = 1; i < 50; i++) {
			expect(GLOSSARY[i - 1]!.fr.length).toBeGreaterThanOrEqual(GLOSSARY[i]!.fr.length);
		}
	});

	test("le nom le plus long gagne : « Son Goku » et non « Goku »", () => {
		const p = protect("Le Kaméhaméha de Son Goku");
		expect(p.terms.map((t) => t.fr)).toEqual(["Kamehameha", "Son Goku"]);
		expect(p.text).toBe("Le ⟦0⟧ de ⟦1⟧");
	});

	test("les accents du site retrouvent la graphie de la base", () => {
		expect(protect("Kaméhaméha").terms[0]?.fr).toBe("Kamehameha");
	});

	test("un nom propre se distingue du mot commun par sa capitale", () => {
		// Toriyama a nommé ses personnages d'après l'épicerie : Acide, Carotte…
		expect(protect("une pluie acide").terms).toHaveLength(0);
		expect(protect("Acide attaque").terms.map((t) => t.fr)).toEqual(["Acide"]);
	});

	test("aucun appariement au milieu d'un mot", () => {
		expect(protect("Kintoblabla").terms).toHaveLength(0);
	});

	test("le japonais revient en japonais, le reste dans la graphie du site", () => {
		const p = protect("Les techniques de Son Goku");
		expect(restore(p.text, p.terms, "ja").text).toContain("孫悟空");
		expect(restore(p.text, p.terms, "fr").text).toContain("Son Goku");
	});

	test("un jeton perdu par le moteur est signalé, jamais avalé", () => {
		const p = protect("Le Kaméhaméha de Son Goku");
		const r = restore("The ⟦0⟧", p.terms, "en");
		expect(r.missing).toEqual([1]);
	});

	test("une graphie ambiguë retombe sur le français", () => {
		const vegeta = GLOSSARY.find((t) => t.fr === "Vegeta")!;
		// Le prince et sa planète portent le même nom : aucune romanisation ne
		// vaut pour les deux.
		expect(vegeta.romaji).toBeUndefined();
		expect(spell(vegeta, "en")).toBe("Vegeta");
	});
});
