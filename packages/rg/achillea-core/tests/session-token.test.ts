import { describe, expect, test } from "bun:test";

import {
	ACHILLEA_AUTH_ISSUER,
	ACHILLEA_SESSION_AUDIENCE,
	verifyAchilleaSessionToken,
} from "@rosegriffon/achillea-core/auth";

const secret = "test-session-secret";

function base64url(value: string | ArrayBuffer): string {
	const bytes = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value);
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function token(exp = 2_000, tokenUse = "session") {
	const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
	const payload = base64url(JSON.stringify({
		id: "user-1",
		sub: "user-1",
		tokenUse,
		iss: ACHILLEA_AUTH_ISSUER,
		aud: ACHILLEA_SESSION_AUDIENCE,
		exp,
	}));
	const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
	const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${header}.${payload}`));
	return `${header}.${payload}.${base64url(signature)}`;
}

describe("purpose-bound Achillea session verifier", () => {
	test("accepts a valid signed session", async () => {
		const result = await verifyAchilleaSessionToken(await token(), secret, 1_000);
		expect(result).toMatchObject({ id: "user-1", expiresAt: 2_000 });
	});

	test("rejects tampering, expiry and missing purpose claims", async () => {
		const valid = await token();
		expect(await verifyAchilleaSessionToken(`${valid.slice(0, -1)}x`, secret, 1_000)).toBeNull();
		expect(await verifyAchilleaSessionToken(await token(999), secret, 1_000)).toBeNull();
		const legacy = await token(2_000, "legacy");
		expect(await verifyAchilleaSessionToken(legacy, secret, 1_000)).toBeNull();
	});
});
