import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";

import {
	ACHILLEA_AUTH_ISSUER,
	ACHILLEA_SESSION_AUDIENCE,
	ACHILLEA_SESSION_COOKIE_NAME,
	ACHILLEA_REALTIME_AUDIENCE,
	signAchilleaRealtimeToken,
	signAchilleaSessionToken,
} from "./achillea-session";

describe("signAchilleaSessionToken", () => {
	test("produces the purpose-bound JWT accepted by Achillea services", () => {
		const token = signAchilleaSessionToken({ id: "42", username: "Mark", avatar: "hash" }, "test-shared-secret", 100);
		const [header, body, signature] = token.split(".");
		const expectedSignature = createHmac("sha256", "test-shared-secret")
			.update(`${header}.${body}`)
			.digest("base64url");
		const payload = JSON.parse(Buffer.from(body!, "base64url").toString("utf8"));

		expect(signature).toBe(expectedSignature);
		expect(JSON.parse(Buffer.from(header!, "base64url").toString("utf8"))).toEqual({ alg: "HS256", typ: "JWT" });
		expect(payload.iss).toBe(ACHILLEA_AUTH_ISSUER);
		expect(payload.aud).toBe(ACHILLEA_SESSION_AUDIENCE);
		expect(payload).toMatchObject({ id: "42", sub: "42", tokenUse: "session", exp: 100 + 30 * 24 * 60 * 60 });
		expect(ACHILLEA_SESSION_COOKIE_NAME).toBe("token");
	});
});

describe("signAchilleaRealtimeToken", () => {
	test("uses the distinct short-lived realtime audience", () => {
		const token = signAchilleaRealtimeToken({ id: "42", username: "Mark" }, "test-shared-secret", 100);
		const [, body] = token.split(".");
		const payload = JSON.parse(Buffer.from(body!, "base64url").toString("utf8"));
		expect(payload).toMatchObject({ id: "42", sub: "42", tokenUse: "realtime", aud: ACHILLEA_REALTIME_AUDIENCE, exp: 400 });
	});
});
