/**
 * Discord avatar fallback: the default avatar a member gets when their stored
 * custom avatar hash has gone stale (Discord answers 404 once they change it).
 */
import { describe, expect, test } from "bun:test";
import {
	discordDefaultAvatarIndex,
	discordDefaultAvatarUrl,
	discordUserIdFromAvatarUrl,
} from "../src/lib/discord-avatar";

describe("discordDefaultAvatarIndex", () => {
	test("uses (id >> 22) % 6 computed in BigInt", () => {
		// Snowflakes exceed Number.MAX_SAFE_INTEGER: a Number computation drifts.
		const id = "1012004621708968017";
		expect(discordDefaultAvatarIndex(id)).toBe(Number((BigInt(id) >> 22n) % 6n));
		expect(discordDefaultAvatarIndex("837661881137102890")).toBe(
			Number((837661881137102890n >> 22n) % 6n)
		);
	});

	test("stays within the six default avatars", () => {
		for (const id of ["175928847299117063", "1121933449268318290", "1488985657492901930"]) {
			const index = discordDefaultAvatarIndex(id);
			expect(index).toBeGreaterThanOrEqual(0);
			expect(index).toBeLessThanOrEqual(5);
		}
	});

	test("rejects anything that is not a snowflake", () => {
		expect(discordDefaultAvatarIndex(null)).toBeNull();
		expect(discordDefaultAvatarIndex("")).toBeNull();
		expect(discordDefaultAvatarIndex("user_abc123")).toBeNull();
		expect(discordDefaultAvatarIndex("42")).toBeNull();
	});
});

describe("discordDefaultAvatarUrl", () => {
	test("points at the Discord embed avatar", () => {
		const id = "1177739856307298485";
		expect(discordDefaultAvatarUrl(id)).toBe(
			`https://cdn.discordapp.com/embed/avatars/${Number((BigInt(id) >> 22n) % 6n)}.png`
		);
		expect(discordDefaultAvatarUrl("not-an-id")).toBeNull();
	});
});

describe("discordUserIdFromAvatarUrl", () => {
	test("reads the user id of a custom avatar URL", () => {
		expect(
			discordUserIdFromAvatarUrl(
				"https://cdn.discordapp.com/avatars/1323725494184841256/e513fc3fc4d288299f396ce3da5cbcd6.png"
			)
		).toBe("1323725494184841256");
		expect(
			discordUserIdFromAvatarUrl(
				"https://cdn.discordapp.com/avatars/837661881137102890/a_b982b4aeb1a55c1aa78d11c3d25caa6a.gif?size=128"
			)
		).toBe("837661881137102890");
	});

	test("reads the user id of a per-guild avatar URL", () => {
		expect(
			discordUserIdFromAvatarUrl(
				"https://cdn.discordapp.com/guilds/1012004621708968017/users/1121933449268318290/avatars/abc.png"
			)
		).toBe("1121933449268318290");
	});

	test("ignores non-Discord and default-avatar URLs", () => {
		expect(discordUserIdFromAvatarUrl("https://cdn.discordapp.com/embed/avatars/3.png")).toBeNull();
		expect(discordUserIdFromAvatarUrl("https://example.com/avatars/1323725494184841256/x.png")).toBeNull();
		expect(discordUserIdFromAvatarUrl("./assets/wiki/avatar.png")).toBeNull();
		expect(discordUserIdFromAvatarUrl(null)).toBeNull();
	});
});
