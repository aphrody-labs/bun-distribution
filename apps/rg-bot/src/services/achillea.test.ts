import { describe, expect, test } from "bun:test";

import { estScanne, GuildeAchillea, IdentifiantDiscord } from "./achillea";

const unscannedGuild = {
	id: "123456789012345678",
	name: null,
	icon: null,
	banner: null,
	owner_id: null,
	member_count: null,
	presence_count: null,
	features: null,
	premium_tier: null,
	verification_level: null,
	description: null,
	scanned_at: null,
};

describe("Achillea bot compatibility facade", () => {
	test("keeps the historical schema exports", () => {
		expect(IdentifiantDiscord.safeParse("123456789012345678").success).toBe(true);
		expect(GuildeAchillea.parse(unscannedGuild).member_count).toBeNull();
	});

	test("keeps the historical scan predicate", () => {
		expect(estScanne(GuildeAchillea.parse(unscannedGuild))).toBe(false);
		expect(
			estScanne(
				GuildeAchillea.parse({
					...unscannedGuild,
					name: "Achillea",
					scanned_at: "2026-09-07T00:00:00.000Z",
				})
			)
		).toBe(true);
	});
});
