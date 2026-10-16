import { describe, expect, test } from "bun:test";

import {
	ClanMemberDistinction,
	ClanMemberRole,
	ClanState,
	EventTypeEnum,
	MatchMode,
	ParticipantStatus,
	ScoreReportPolicy,
	StageType,
	TeamSide,
	TournamentState,
	UserRole,
} from "@rosegriffon/achillea-types";
import { ClanState as DirectClanState } from "@rosegriffon/achillea-types/enums/clanState";

describe("@rosegriffon/achillea-types runtime contracts", () => {
	test("keeps the numeric enum values used by persisted contracts", () => {
		expect(ClanState).toMatchObject({ Creating: 0, PendingReview: 1, Approved: 2 });
		expect(ClanMemberRole).toMatchObject({ Trial: 0, Member: 1, SubCaptain: 2, Captain: 3 });
		expect(UserRole).toMatchObject({
			User: 0,
			Moderator: 1,
			Administrator: 2,
			SuperAdministrator: 3,
		});
		expect(MatchMode).toMatchObject({ ONE_VS_ONE: 2, TWO_VS_TWO: 4 });
		expect(TeamSide).toMatchObject({ TEAM_1: 1, TEAM_2: 2 });
	});

	test("keeps externally serialized string values stable", () => {
		expect(String(EventTypeEnum.TOURNAMENT)).toBe("TOURNAMENT");
		expect(String(TournamentState.PREREGISTERING)).toBe("Preregistering");
		expect(String(ParticipantStatus.DISQUALIFIED)).toBe("Disqualified");
		expect(String(ScoreReportPolicy.STAFF_ONLY)).toBe("staff_only");
		expect(String(StageType.double_elimination)).toBe("double_elimination");
		expect(String(ClanMemberDistinction.ContentCreator)).toBe("Créateur de contenu");
	});

	test("resolves the public enum subpath", () => {
		expect(DirectClanState).toBe(ClanState);
	});
});
