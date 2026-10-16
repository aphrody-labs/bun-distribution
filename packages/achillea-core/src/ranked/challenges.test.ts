import { beforeEach, describe, expect, test } from "bun:test";

import {
	activeChallengeCount,
	cancelChallenge,
	consumeChallenge,
	createChallenge,
	getChallenge,
	purgeExpiredChallenges,
} from "./challenges";

describe("ranked challenge store", () => {
	beforeEach(() => purgeExpiredChallenges(Number.MAX_SAFE_INTEGER));

	test("creates a readable, single-use challenge", () => {
		const challenge = createChallenge({
			fromUserId: "one",
			fromDisplayName: "One",
			fromAvatar: "",
			fromElo: 1000,
			mode: 2,
			ranked: true,
		});

		expect(challenge.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
		expect(getChallenge(challenge.code)).toEqual(challenge);
		expect(consumeChallenge(challenge.code)).toEqual(challenge);
		expect(getChallenge(challenge.code)).toBeNull();
	});

	test("can cancel an outstanding challenge", () => {
		const challenge = createChallenge({
			fromUserId: "one",
			fromDisplayName: "One",
			fromAvatar: "",
			fromElo: 1000,
			mode: 4,
			ranked: false,
			toUserId: "two",
		});

		cancelChallenge(challenge.code);
		expect(activeChallengeCount()).toBe(0);
		expect(getChallenge(challenge.code)).toBeNull();
	});
});
