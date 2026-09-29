import { describe, expect, test } from "bun:test";

import { redactSensitive, safeLogValue } from "../../src/api/security/log-redaction";

describe("log redaction", () => {
	test("redacts bearer, Supabase, JWT, Discord and query-string credentials", () => {
		const raw = [
			"Bearer abc.def-123",
			"sb_secret_examplecredential",
			"eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature",
			"aaaaaaaaaaaaaaaaaaaaaa.bbbbbb.cccccccccccccccccccccccc",
			"/callback?code=oauth-code&token=session-token",
		].join(" ");
		const redacted = redactSensitive(raw);

		expect(redacted).not.toContain("abc.def-123");
		expect(redacted).not.toContain("examplecredential");
		expect(redacted).not.toContain("oauth-code");
		expect(redacted).not.toContain("session-token");
	});

	test("serializes errors without logging their stack", () => {
		const error = new Error("request failed with Bearer private-token");
		const safe = safeLogValue(error);
		expect(safe).toBe("Error: request failed with Bearer [REDACTED]");
		expect(safe).not.toContain("log-redaction.test.ts");
	});
});
