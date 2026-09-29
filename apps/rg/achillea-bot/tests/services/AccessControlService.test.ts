/**
 * Tests AccessControlService — T-0.2
 *
 * Run: bun test tests/services/AccessControlService.test.ts
 *
 * Tests purement unitaires — pas de DB, pas de DI.
 * Utilise buildAbilityFor (fonction pure, aucune dépendance DB/DI).
 */

import "reflect-metadata";

import { describe, expect, test } from "bun:test";

import { buildAbilityFor } from "../../src/utils/functions/buildAbility";
import { AchilleaRole } from "../../src/utils/enums/achilleaRole";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AccessControlService — member", () => {
	test("member ne peut pas moderate Sanction", () => {
		const ability = buildAbilityFor(AchilleaRole.member);
		expect(ability.can("moderate", "Sanction")).toBe(false);
	});

	test("member peut view User", () => {
		const ability = buildAbilityFor(AchilleaRole.member);
		expect(ability.can("view", "User")).toBe(true);
	});
});

describe("AccessControlService — staff", () => {
	test("staff peut moderate Sanction", () => {
		const ability = buildAbilityFor(AchilleaRole.staff);
		expect(ability.can("moderate", "Sanction")).toBe(true);
	});

	test("staff ne peut pas manage Tournament", () => {
		const ability = buildAbilityFor(AchilleaRole.staff);
		expect(ability.can("manage", "Tournament")).toBe(false);
	});
});

describe("AccessControlService — admin", () => {
	test("admin manage Sanction", () => {
		const ability = buildAbilityFor(AchilleaRole.admin);
		expect(ability.can("manage", "Sanction")).toBe(true);
	});

	test("admin manage Tournament", () => {
		const ability = buildAbilityFor(AchilleaRole.admin);
		expect(ability.can("manage", "Tournament")).toBe(true);
	});
});

describe("AccessControlService — owner", () => {
	test("owner peut tout (manage all)", () => {
		const ability = buildAbilityFor(AchilleaRole.owner);
		expect(ability.can("manage", "all")).toBe(true);
		expect(ability.can("manage", "Sanction")).toBe(true);
		expect(ability.can("manage", "Tournament")).toBe(true);
		expect(ability.can("manage", "User")).toBe(true);
		expect(ability.can("moderate", "Sanction")).toBe(true);
		expect(ability.can("cast", "CastEvent")).toBe(true);
	});
});
