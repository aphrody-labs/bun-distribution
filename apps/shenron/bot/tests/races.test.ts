/**
 * Tests du module pur lib/races (multiplicateurs de progression par race).
 */
import { describe, expect, test } from "bun:test";
import {
	RACE_IDS,
	RACES,
	REGEN_MS,
	applyZeniRace,
	getRace,
	hasRegen,
	hasZenkai,
	isRaceId,
	messageXpMultiplier,
	regenTuning,
	setRaceTuning,
	voiceXpMultiplier,
	ZENKAI_MULT,
} from "~/lib/races";

describe("races — surcharges admin", () => {
	test("zénis de race et régén réglables, retour aux défauts sans surcharge", () => {
		setRaceTuning(
			new Map([
				["race.humain.zeni", "2"],
				["race.majin.game_zeni", "3"],
				["race.regen.xp", "500"],
				["race.regen.hours", "12"],
				["race.saiyan.zeni", "-1"],
			])
		);
		expect(applyZeniRace("humain", 100)).toBe(200);
		expect(applyZeniRace("majin", 100, true)).toBe(300);
		expect(applyZeniRace("saiyan", 100)).toBe(100);
		expect(regenTuning()).toEqual({ xp: 500, zeni: 200, ms: 12 * 60 * 60_000 });
		setRaceTuning(new Map());
		expect(applyZeniRace("humain", 100)).toBe(125);
		expect(regenTuning().ms).toBe(REGEN_MS);
	});
});

describe("races — catalogue", () => {
	test("6 races définies et cohérentes", () => {
		expect(RACE_IDS.length).toBe(6);
		for (const id of RACE_IDS) {
			expect(RACES[id].id).toBe(id);
			expect(RACES[id].name.length).toBeGreaterThan(0);
		}
	});
	test("isRaceId / getRace", () => {
		expect(isRaceId("saiyan")).toBe(true);
		expect(isRaceId("mutant")).toBe(true);
		expect(isRaceId("kaioshin")).toBe(false);
		expect(isRaceId(null)).toBe(false);
		expect(getRace("saiyan")?.name).toBe("Saiyan");
		expect(getRace("majin")?.name).toBe("Majin");
		expect(getRace(null)).toBeNull();
	});
	test("chaque race a un roleId Discord distinct", () => {
		const ids = RACE_IDS.map((id) => RACES[id].roleId);
		expect(new Set(ids).size).toBe(RACE_IDS.length);
		for (const r of ids) expect(r).toMatch(/^\d{17,20}$/);
	});
});

describe("races — multiplicateurs XP", () => {
	const now = 1_000_000;
	test("sans race = 1", () => {
		expect(messageXpMultiplier(null, 0, now)).toBe(1);
		expect(voiceXpMultiplier(null, 0, now)).toBe(1);
	});
	test("Saiyan ×1.25 chat + vocal", () => {
		expect(messageXpMultiplier("saiyan", 0, now)).toBeCloseTo(1.25);
		expect(voiceXpMultiplier("saiyan", 0, now)).toBeCloseTo(1.25);
	});
	test("Mutant ×1.4 chat uniquement (puissance brute)", () => {
		expect(messageXpMultiplier("mutant", 0, now)).toBeCloseTo(1.4);
		expect(voiceXpMultiplier("mutant", 0, now)).toBe(1);
	});
	test("Cyborg boost vocal uniquement", () => {
		expect(messageXpMultiplier("cyborg", 0, now)).toBe(1);
		expect(voiceXpMultiplier("cyborg", 0, now)).toBeCloseTo(1.4);
	});
	test("Zenkai (Saiyan) actif applique ×ZENKAI_MULT", () => {
		const boostUntil = now + 1000;
		expect(messageXpMultiplier("saiyan", boostUntil, now)).toBeCloseTo(1.25 * ZENKAI_MULT);
		// fenêtre expirée → pas de bonus
		expect(messageXpMultiplier("saiyan", now - 1, now)).toBeCloseTo(1.25);
		// Mutant n'a pas Zenkai
		expect(messageXpMultiplier("mutant", boostUntil, now)).toBeCloseTo(1.4);
		// Namek n'a pas Zenkai
		expect(messageXpMultiplier("namek", boostUntil, now)).toBeCloseTo(1.1);
	});
});

describe("races — zéni", () => {
	test("Humain +25 % général", () => {
		expect(applyZeniRace("humain", 100)).toBe(125);
		expect(applyZeniRace("humain", 100, true)).toBe(125);
	});
	test("Majin +50 % sur les jeux uniquement", () => {
		expect(applyZeniRace("majin", 100)).toBe(100);
		expect(applyZeniRace("majin", 100, true)).toBe(150);
	});
	test("sans race / montant nul = inchangé", () => {
		expect(applyZeniRace(null, 100, true)).toBe(100);
		expect(applyZeniRace("humain", 0)).toBe(0);
	});
});

describe("races — flags", () => {
	test("hasZenkai / hasRegen", () => {
		expect(hasZenkai("saiyan")).toBe(true);
		expect(hasZenkai("mutant")).toBe(false);
		expect(hasZenkai("humain")).toBe(false);
		expect(hasRegen("namek")).toBe(true);
		expect(hasRegen("majin")).toBe(false);
	});
});
