import "reflect-metadata";
import { describe, expect, test } from "bun:test";

import { ClanMemberDistinction } from "@/utils/enums";
import {
	checkClanMemberLimitExceeded,
	normalizeClanMemberLimits,
} from "@/utils/functions/clanLimits";

describe("clanLimits", () => {
	test("normalizeClanMemberLimits — défauts 30 joueurs / 7 staff", () => {
		expect(normalizeClanMemberLimits({})).toEqual({ playerLimit: 30, staffLimit: 7 });
	});

	test("normalizeClanMemberLimits — borne les valeurs hors plage", () => {
		expect(normalizeClanMemberLimits({ playerLimit: 999, staffLimit: -3 })).toEqual({
			playerLimit: 100,
			staffLimit: 1,
		});
	});

	test("checkClanMemberLimitExceeded — bloque à la limite joueurs", () => {
		const limits = { playerLimit: 30, staffLimit: 7 };
		expect(
			checkClanMemberLimitExceeded({ players: 30, staff: 2 }, limits, [
				ClanMemberDistinction.Player,
			])
		).toBe("player");
	});

	test("checkClanMemberLimitExceeded — bloque à la limite staff", () => {
		const limits = { playerLimit: 30, staffLimit: 7 };
		expect(
			checkClanMemberLimitExceeded({ players: 10, staff: 7 }, limits, [ClanMemberDistinction.Staff])
		).toBe("staff");
	});

	test("checkClanMemberLimitExceeded — ignore les distinctions hors joueur/staff", () => {
		const limits = { playerLimit: 30, staffLimit: 7 };
		expect(
			checkClanMemberLimitExceeded({ players: 30, staff: 7 }, limits, [
				ClanMemberDistinction.Artist,
			])
		).toBeNull();
	});
});
