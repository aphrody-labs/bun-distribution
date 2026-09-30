import { describe, expect, test } from "bun:test";
import { analyzeCanon, DEFAULT_CANON_CONFIG } from "@/lib/canon-engine";

describe("Power Scaling — Validation exhaustive des règles officielles", () => {
	test("1. Règle du duel Namek : Goku SSJ1 (150M) vs Freeza 100% (120M)", () => {
		const res = analyzeCanon("Quelle est la puissance de Goku SSJ1 sur Namek (150 millions) face à Freeza 100% ?", DEFAULT_CANON_CONFIG);
		expect(res.verdict).toContain("150 000 000");
		expect(res.verdict).toContain("120 000 000");
		expect(res.sources.some((s) => s.includes("Daizenshuu 7"))).toBe(true);
	});

	test("2. Multiplicateur de l'Oozaru (Grand Singe x10)", () => {

		expect(DEFAULT_CANON_CONFIG.powerScaling.multipliers.find((m) => m.form.includes("Oozaru"))?.multiplier).toBe(10);
	});

	test("3. Multiplicateurs Super Saiyan 1, 2 et 3 du Super Exciting Guide", () => {
		const res = analyzeCanon("Quels sont les multiplicateurs officiels du Super Saiyan 1, 2 et 3 selon le SEG ?", DEFAULT_CANON_CONFIG);
		expect(res.verdict).toContain("SSJ1 = x50");
		expect(res.verdict).toContain("SSJ2 = x2 de SSJ1 (x100)");
		expect(res.verdict).toContain("SSJ3 = x4 de SSJ2 (x400)");
		expect(res.sources.some((s) => s.includes("Super Exciting Guide"))).toBe(true);
	});

	test("4. Mesure en Kiri de Babidi (Yakon, Goku SSJ2, seuil planétaire)", () => {
		const res = analyzeCanon("Comment fonctionne l'unité magique Kiri utilisée par Babidi ?", DEFAULT_CANON_CONFIG);
		expect(res.verdict).toContain("800 Kiri");
		expect(res.verdict).toContain("3 000 Kiri");
		expect(res.verdict).toContain("200 à 300 Kiri");
		expect(res.tier).toBe("CANON_ABSOLU");
	});

	test("5. Comparaison Potara vs Métamol selon Akira Toriyama et le SEG", () => {
		const res = analyzeCanon("Est-ce que la fusion Potara est supérieure à la fusion Métamol ?", DEFAULT_CANON_CONFIG);
		expect(res.verdict).toContain("Potaras");
		expect(res.explanation).toContain("Vieux Kaïoshin");
		expect(res.explanation).toContain("multiplication");
	});

	test("6. Clôture des scouters par Akira Toriyama", () => {
		const res = analyzeCanon("Pourquoi Akira Toriyama a arrêté de donner des chiffres scouter après Namek ?", DEFAULT_CANON_CONFIG);
		expect(res.explanation).toContain("chiffres scouter");
		expect(res.sources.some((s) => s.includes("Daizenshuu 7"))).toBe(true);
	});
});
