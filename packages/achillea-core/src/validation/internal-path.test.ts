import { describe, expect, test } from "bun:test";

import { isSafeInternalPath } from "./index";

describe("isSafeInternalPath", () => {
	test("accepts only local paths", () => {
		expect(isSafeInternalPath("/achillea/ranked?mode=solo")).toBe(true);
		expect(isSafeInternalPath("//evil.example")).toBe(false);
		expect(isSafeInternalPath("/\\evil.example")).toBe(false);
		expect(isSafeInternalPath("https://evil.example")).toBe(false);
	});
});
