import { describe, expect, test } from "bun:test";

import { socialProfileUsername } from "@rosegriffon/achillea-core/identity";

describe("social profile identity", () => {
	test("extracts a path username without throwing on malformed input", () => {
		expect(socialProfileUsername("https://twitch.tv/achillea/")).toBe("achillea");
		expect(socialProfileUsername("not a url")).toBe("");
	});
});
