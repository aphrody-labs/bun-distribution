import { describe, expect, test } from "bun:test";
import {
	analyzeCanon,
	DEFAULT_CANON_CONFIG,
	DEFAULT_POWER_SCALING_CONFIG,
	resolveCanonConfig,
} from "@/lib/canon-engine";

describe("Power Scaling canonique & déterministe", () => {
	test("DEFAULT_POWER_SCALING_CONFIG contient les multiplicateurs et BP officiels", () => {
		const cfg = DEFAULT_POWER_SCALING_CONFIG;
		expect(cfg.enabled).toBe(true);
		expect(cfg.kiriToBpRate).toBe(50000);
		expect(cfg.planetDestructionKiriFloor).toBe(200);

		// Multiplicateurs SEG / Daizenshuu 7
		const ssj1 = cfg.multipliers.find((m) => m.form.includes("SSJ1"));
		expect(ssj1?.multiplier).toBe(50);

		const ssj2 = cfg.multipliers.find((m) => m.form.includes("SSJ2"));
		expect(ssj2?.multiplier).toBe(100);

		const ssj3 = cfg.multipliers.find((m) => m.form.includes("SSJ3"));
		expect(ssj3?.multiplier).toBe(400);

		const oozaru = cfg.multipliers.find((m) => m.form.includes("Oozaru"));
		expect(oozaru?.multiplier).toBe(10);

		// Battle Powers officiels
		const fermier = cfg.officialBps.find((b) => b.character.includes("Fermier"));
		expect(fermier?.bp).toBe(5);
		expect(fermier?.scouter).toBe(true);

		const gokuSsj = cfg.officialBps.find((b) => b.character.includes("Goku") && b.state.includes("SSJ1"));
		expect(gokuSsj?.bp).toBe(150000000);

		const freeza100 = cfg.officialBps.find(
			(b) => (b.character.includes("Freeza") || b.character.includes("Freezer")) && b.state.includes("100%"),
		);
		expect(freeza100?.bp).toBe(120000000);
	});

	test("resolveCanonConfig persiste et sécurise powerScaling", () => {
		const patchVide = resolveCanonConfig({});
		expect(patchVide.powerScaling.enabled).toBe(true);
		expect(patchVide.powerScaling.kiriToBpRate).toBe(50000);

		const patchPerso = resolveCanonConfig({
			powerScaling: {
				enabled: false,
				kiriToBpRate: 60000,
				planetDestructionKiriFloor: 250,
			},
		});
		expect(patchPerso.powerScaling.enabled).toBe(false);
		expect(patchPerso.powerScaling.kiriToBpRate).toBe(60000);
		expect(patchPerso.powerScaling.planetDestructionKiriFloor).toBe(250);
	});

	test("analyzeCanon répond précisément sur les multiplicateurs Super Saiyan", () => {
		const verdict = analyzeCanon("Quel est le multiplicateur officiel du Super Saiyan ?", DEFAULT_CANON_CONFIG);
		expect(verdict.verdict).toContain("Daizenshuu 7");
		expect(verdict.verdict).toContain("SSJ1 = x50");
		expect(verdict.sources.some((s) => s.includes("Daizenshuu 7"))).toBe(true);
	});

	test("analyzeCanon répond précisément sur l'unité Kiri de Babidi", () => {
		const verdict = analyzeCanon("Comment fonctionne l'unité Kiri de Babidi ?", DEFAULT_CANON_CONFIG);
		expect(verdict.tier).toBe("CANON_ABSOLU");
		expect(verdict.verdict).toContain("800 Kiri");
		expect(verdict.verdict).toContain("3 000 Kiri");
	});

	test("analyzeCanon répond sur la puissance 150 millions de Goku sur Namek", () => {
		const verdict = analyzeCanon("Est-ce que Goku fait 150 millions sur Namek ?", DEFAULT_CANON_CONFIG);
		expect(verdict.verdict).toContain("150 000 000");
		expect(verdict.verdict).toContain("120 000 000");
	});
});
