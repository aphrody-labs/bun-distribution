import { describe, expect, test } from "bun:test";

import {
	buildChallongeOAuthUrl,
	buildTwitchOAuthUrl,
	formatProviderOAuthState,
	parseProviderOAuthState,
} from "@rosegriffon/achillea-core/oauth";

describe("provider OAuth URL builders", () => {
	test("encodes Twitch callback and state", () => {
		const url = new URL(
			buildTwitchOAuthUrl({
				callbackUrl: "https://api.example.test/oauth/callback",
				clientId: "client&id",
				state: "discord:state with spaces",
			}),
		);
		expect(url.origin).toBe("https://id.twitch.tv");
		expect(url.searchParams.get("client_id")).toBe("client&id");
		expect(url.searchParams.get("redirect_uri")).toBe(
			"https://api.example.test/oauth/callback?provider=twitch",
		);
		expect(url.searchParams.get("state")).toBe("discord:state with spaces");
	});

	test("uses the Challonge provider scope", () => {
		const url = new URL(
			buildChallongeOAuthUrl({
				callbackUrl: "https://api.example.test/oauth/callback",
				clientId: "challonge-client",
				state: "discord:token",
			}),
		);
		expect(url.origin).toBe("https://api.challonge.com");
		expect(url.searchParams.get("scope")).toBe("me tournaments:read tournaments:write participants:write");
		expect(url.searchParams.get("redirect_uri")).toContain("provider=challonge");
	});

	test("parses only a Discord-bound provider state", () => {
		const token = "a".repeat(48);
		expect(formatProviderOAuthState("123456789012345678", token)).toBe(
			`123456789012345678:${token}`,
		);
		expect(parseProviderOAuthState(`123456789012345678:${token}`)).toEqual({
			discordId: "123456789012345678",
			token,
		});
		expect(parseProviderOAuthState(`123:${token}`)).toBeNull();
		expect(parseProviderOAuthState(`123456789012345678:${"z".repeat(48)}`)).toBeNull();
	});
});
