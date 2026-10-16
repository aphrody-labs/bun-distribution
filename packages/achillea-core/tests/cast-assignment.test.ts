import { describe, expect, test } from "bun:test";

import {
	compareCastCandidates,
	scoreCastCandidate,
} from "@rosegriffon/achillea-core/casts";
import { CastAvailabilityStatus, CastSlotRole } from "@rosegriffon/achillea-types";

describe("cast assignment scoring", () => {
	test("prefers an explicit role and available status", () => {
		const score = scoreCastCandidate(
			{
				userId: "caster-a",
				status: CastAvailabilityStatus.Available,
				preferredRoles: [CastSlotRole.CasterMain],
				recentAssignments: 0,
				binomeBonus: 0,
			},
			CastSlotRole.CasterMain,
		);
		expect(score).toBe(15);
	});

	test("uses user id as deterministic tie-break", () => {
		const base = { status: CastAvailabilityStatus.Maybe, preferredRoles: [], recentAssignments: 0, binomeBonus: 0 } as const;
		expect(
			compareCastCandidates({ ...base, userId: "a" }, { ...base, userId: "b" }, CastSlotRole.CasterMain),
		).toBeLessThan(0);
	});
});
