/**
 * Tests du module pur lib/race-levels (échelles de transformations par race).
 */
import { describe, expect, test } from "bun:test";
import type { GuildMember } from "discord.js";
import {
	allRaceLevelRoleIds,
	hasRaceLadder,
	RACE_LEVEL_ROLES,
	levelOfRoleId,
	memberRaceId,
	raceLevelRoleIds,
} from "~/lib/race-levels";
import { RACES } from "~/lib/races";

/** Membre minimal pour memberRaceId (seul `roles.cache.has` est lu). */
function fakeMember(roleIds: string[]): GuildMember {
	const set = new Set(roleIds);
	return { roles: { cache: { has: (id: string) => set.has(id) } } } as unknown as GuildMember;
}

describe("race-levels — échelle Saiyan", () => {
	test("raceLevelRoleIds cumule jusqu'au niveau", () => {
		expect(raceLevelRoleIds("saiyan", 1)).toEqual(["1058910891124457482"]);
		expect(raceLevelRoleIds("saiyan", 3)).toHaveLength(3);
		expect(raceLevelRoleIds("saiyan", 10)).toHaveLength(10);
	});
	test("levelOfRoleId mappe le rôle vers son palier", () => {
		expect(levelOfRoleId(RACE_LEVEL_ROLES.saiyan[1]!)).toBe(1);
		expect(levelOfRoleId(RACE_LEVEL_ROLES.saiyan[10]!)).toBe(10);
		expect(levelOfRoleId("000000000000000000")).toBeNull();
	});
	test("toutes les transfos sont uniques (10 = Saiyan seul pour l'instant)", () => {
		expect(allRaceLevelRoleIds()).toHaveLength(10);
		expect(new Set(allRaceLevelRoleIds()).size).toBe(allRaceLevelRoleIds().length);
	});
});

describe("race-levels — races sans échelle", () => {
	test("une race non encore peuplée n'a aucun palier", () => {
		expect(raceLevelRoleIds("namek", 10)).toEqual([]);
		expect(raceLevelRoleIds("mutant", 10)).toEqual([]);
	});
	test("hasRaceLadder — true pour Saiyan (défaut), false pour les races vides", () => {
		expect(hasRaceLadder("saiyan")).toBe(true);
		expect(hasRaceLadder("namek")).toBe(false);
		expect(hasRaceLadder("mutant")).toBe(false);
	});
});

describe("race-levels — memberRaceId (dérivée du rôle de race)", () => {
	test("retourne la race dont le membre porte le rôle", () => {
		expect(memberRaceId(fakeMember([RACES.saiyan.roleId]))).toBe("saiyan");
		expect(memberRaceId(fakeMember([RACES.namek.roleId, "999"]))).toBe("namek");
	});
	test("null si aucun rôle de race", () => {
		expect(memberRaceId(fakeMember(["123", "456"]))).toBeNull();
	});
});
