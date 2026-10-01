import { describe, expect, it } from "bun:test";
import type { Kysely } from "kysely";
import type { Database } from "@rosegriffon/db/schema";
import { LeaderboardService } from "../src/api/modules/achillea/leaderboard/service";

describe("ranked profile read", () => {
	it("returns an unranked profile without writing user_elo", async () => {
		const queried: string[] = [];
		const query = (table: string) => {
			const builder = {
				select: () => builder,
				selectAll: () => builder,
				where: () => builder,
				orderBy: () => builder,
				executeTakeFirst: async () => table === "season"
					? { id: "current-season", config: { baseRating: 100 } }
					: table === "user_elo" ? undefined : { total: 0 },
				execute: async () => [],
			};
			return builder;
		};
		const db = {
			selectFrom: (table: string) => {
				queried.push(table);
				return query(table);
			},
			insertInto: () => { throw new Error("GET profile must not write"); },
		} as unknown as Kysely<Database>;

		const profile = await LeaderboardService.findProfile(db, "discord-user", 2);
		expect(profile).toMatchObject({
			userId: "discord-user", mode: 2, seasonId: "current-season",
			elo: 100, peakRating: 100, gamesPlayed: 0,
			globalRank: null, totalPlayers: 0, tier: null,
		});
		expect(queried).toContain("user_elo");
	});
});
