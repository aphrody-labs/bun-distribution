import { describe, expect, test } from "bun:test";

import { phaseLobbiesAreFinished, shouldFinishTournament } from "@rosegriffon/achillea-core/tournaments";

describe("phase transition rules", () => {
	test("requires at least one terminal lobby and no unfinished lobby", () => {
		expect(phaseLobbiesAreFinished([])).toBe(false);
		expect(phaseLobbiesAreFinished(["Finished", "Forfeited"])).toBe(true);
		expect(phaseLobbiesAreFinished(["Finished", "Ongoing"])).toBe(false);
	});

	test("finishes only when no other phase remains active", () => {
		expect(
			shouldFinishTournament(
				[
					{ id: 1, status: "Completed" },
					{ id: 2, status: "Active" },
				],
				2,
			),
		).toBe(true);
		expect(
			shouldFinishTournament(
				[
					{ id: 1, status: "Active" },
					{ id: 2, status: "Active" },
				],
				2,
			),
		).toBe(false);
	});
});
