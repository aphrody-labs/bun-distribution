import { describe, expect, test } from "bun:test";

import { safeRequestPath } from "../../src/api/security/request-log";

describe("request log redaction", () => {
	test("drops query parameters so OAuth codes and tokens never reach logs", () => {
		expect(safeRequestPath("/api/auth/callback?code=secret-code&state=secret-state")).toBe(
			"/api/auth/callback"
		);
		expect(safeRequestPath("https://example.test/path?token=secret")).toBe("/path");
	});
});
