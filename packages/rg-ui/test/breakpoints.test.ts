import { describe, expect, test } from "bun:test";

import { BREAKPOINTS, breakpointForWidth } from "../src/hooks/use-mobile";

describe("classes de fenêtre Material 3", () => {
	test("expose les quatre bornes canoniques", () => {
		expect(BREAKPOINTS).toEqual({
			MEDIUM: 600,
			EXPANDED: 840,
			LARGE: 1200,
			EXTRA_LARGE: 1600,
		});
	});

	test.each([
		[0, "compact"],
		[599, "compact"],
		[600, "medium"],
		[839, "medium"],
		[840, "expanded"],
		[1199, "expanded"],
		[1200, "large"],
		[1599, "large"],
		[1600, "extra-large"],
		[2560, "extra-large"],
	] as const)("classe %d px comme %s", (width, expected) => {
		expect(breakpointForWidth(width)).toBe(expected);
	});
});
