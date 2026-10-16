import { describe, expect, test } from "bun:test";

import { verifyAdminBearerToken } from "@rosegriffon/achillea-core/auth";

describe("portable admin bearer token", () => {
	test("accepts only an exact configured secret", () => {
		expect(verifyAdminBearerToken("secret", "secret")).toBe(true);
		expect(verifyAdminBearerToken("SECRET", "secret")).toBe(false);
		expect(verifyAdminBearerToken("secret-extra", "secret")).toBe(false);
		expect(verifyAdminBearerToken(undefined, "secret")).toBe(false);
	});
});
