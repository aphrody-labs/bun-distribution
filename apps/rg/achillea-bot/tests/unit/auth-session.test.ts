import { describe, expect, test } from "bun:test";
import jwt from "jsonwebtoken";
import { signAchilleaRealtimeToken, signAchilleaSessionToken } from "@rosegriffon/auth/achillea-session";

import {
	AUTH_ISSUER,
	REALTIME_AUDIENCE,
	SESSION_AUDIENCE,
	sessionClearCookieOptions,
	sessionCookieOptions,
	verifyRealtimeToken,
	verifySessionToken,
} from "../../src/auth/session";

process.env.JWT_SECRET_KEY = "secret-de-test-unitaire-auth-centralisee";

describe("central auth session contract", () => {
	test("issues a purpose-bound web session", () => {
		const token = signAchilleaSessionToken({ id: "42", username: "Aphrodi" }, process.env.JWT_SECRET_KEY!);
		const decoded = jwt.decode(token) as jwt.JwtPayload & { tokenUse: string };
		expect(decoded.sub).toBe("42");
		expect(decoded.iss).toBe(AUTH_ISSUER);
		expect(decoded.aud).toBe(SESSION_AUDIENCE);
		expect(decoded.tokenUse).toBe("session");
		expect(verifySessionToken(token)).toEqual({
			id: "42",
			username: "Aphrodi",
			avatar: undefined,
			sim: undefined,
		});
		expect(() => verifyRealtimeToken(token)).toThrow("Invalid token use");
	});

	test("issues a short, purpose-bound realtime token", () => {
		const token = signAchilleaRealtimeToken({ id: "7", avatar: "hash" }, process.env.JWT_SECRET_KEY!);
		const decoded = jwt.decode(token) as jwt.JwtPayload & { tokenUse: string };
		expect(decoded.aud).toBe(REALTIME_AUDIENCE);
		expect(decoded.tokenUse).toBe("realtime");
		expect(verifyRealtimeToken(token).id).toBe("7");
		expect(() => verifySessionToken(token)).toThrow("Invalid token use");
		expect((decoded.exp ?? 0) - (decoded.iat ?? 0)).toBe(300);
	});

	test("rejects legacy signed cookies without a token purpose", () => {
		const legacy = jwt.sign({ id: "99" }, process.env.JWT_SECRET_KEY!, {
			algorithm: "HS256",
			expiresIn: "30d",
		});
		expect(() => verifySessionToken(legacy)).toThrow("Invalid token use");
	});

	test("rejects a purpose-bound token without expiry", () => {
		const token = jwt.sign({ id: "99", tokenUse: "session" }, process.env.JWT_SECRET_KEY!, {
			algorithm: "HS256",
			issuer: AUTH_ISSUER,
			audience: SESSION_AUDIENCE,
		});
		expect(() => verifySessionToken(token)).toThrow("Token expiry missing");
	});

	test("uses identical cookie scope when setting and clearing", () => {
		const set = sessionCookieOptions(true);
		const clear = sessionClearCookieOptions(true);
		expect(clear).toEqual({ httpOnly: true, secure: true, sameSite: "lax", path: "/" });
		expect(set.maxAge).toBeGreaterThan(0);
	});

	test("sets domain when SESSION_COOKIE_DOMAIN is configured", () => {
		process.env.SESSION_COOKIE_DOMAIN = ".rosegriffon.fr";
		try {
			const set = sessionCookieOptions(true);
			expect(set.domain).toBe(".rosegriffon.fr");
		} finally {
			delete process.env.SESSION_COOKIE_DOMAIN;
		}
	});
});
