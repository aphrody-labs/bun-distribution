import { describe, expect, test } from "bun:test";

import { validateRulesetMetadata } from "@rosegriffon/achillea-core/rulesets";

describe("ruleset metadata", () => {
	test("accepts legacy and odd semver best-of values", () => {
		expect(validateRulesetMetadata({ name: "Astral", version: "1.2.3", defaultBo: 3 }).ok).toBe(true);
		expect(validateRulesetMetadata({ name: "Legacy", version: "legacy", defaultBo: 1 }).ok).toBe(true);
	});

	test("reports all invalid metadata fields", () => {
		const result = validateRulesetMetadata({ name: " ", version: "v1", defaultBo: 2 });
		expect(result.ok).toBe(false);
		expect(result.errors).toHaveLength(3);
	});
});
