import { describe, expect, it } from "bun:test";
import { projectPublicIdentity, uniqueLinkedPublicProfile } from "../src/api/modules/achillea/users/public-profile";

describe("Achillea public profile projection", () => {
	it("uses the claimed RG identity and bio for a linked player", () => {
		expect(projectPublicIdentity(
			{ id: "rg-id", username: "rose", avatar_url: "https://example.com/rg.png", bio: null },
			{ username: "old-discord", avatar: "https://example.com/old.png", bio: "old bio" },
		)).toEqual({ username: "rose", rgProfileUsername: "rose", avatar: "https://example.com/rg.png", bio: null });
	});

	it("keeps a Discord-only player's existing profile", () => {
		expect(projectPublicIdentity(null, { username: "discord", avatar: null, bio: "game bio" }))
			.toEqual({ username: "discord", avatar: null, bio: "game bio" });
	});

	it("does not select an arbitrary profile for an ambiguous Discord link", () => {
		const first = { id: "one", username: "one", avatar_url: null, bio: null };
		const second = { id: "two", username: "two", avatar_url: null, bio: null };
		expect(uniqueLinkedPublicProfile([first])).toEqual(first);
		expect(uniqueLinkedPublicProfile([first, second])).toBeNull();
	});
});
