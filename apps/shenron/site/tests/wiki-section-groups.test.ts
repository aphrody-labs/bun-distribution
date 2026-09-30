import { describe, expect, test } from "bun:test";
import { normalizeWikiSectionGroups } from "@/lib/wiki-section-groups";

describe("normalizeWikiSectionGroups", () => {
	test("inverse titre PWS + groupe sous-section", () => {
		const out = normalizeWikiSectionGroups([
			{ label: "PWS", group: "Puissance d'attaque" },
			{ label: "Vitesse", group: null },
			{ label: "Durabilité & Endurance", group: null },
		]);
		expect(out.map((s) => [s.label, s.group])).toEqual([
			["Puissance d'attaque", "PWS"],
			["Vitesse", "PWS"],
			["Durabilité & Endurance", "PWS"],
		]);
	});

	test("laisse les sections hors PWS inchangées", () => {
		const out = normalizeWikiSectionGroups([
			{ label: "Histoire", group: null },
			{ label: "Vitesse", group: "PWS" },
		]);
		expect(out).toEqual([
			{ label: "Histoire", group: null },
			{ label: "Vitesse", group: "PWS" },
		]);
	});
});
