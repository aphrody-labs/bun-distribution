/**
 * W3-AUTH-04 — le vérificateur acting-user du bot (`api/user-auth.ts`, façade
 * de `@shenron/auth/acting-user`) accepte le vecteur partagé
 * `ACTING_USER_TEST_VECTOR` produit par le signataire du site, et lit le secret
 * via `ENV_ALIASES.actingUserSecret` (SHENRON_USER_SECRET puis API_USER_SECRET).
 */
import "./setup";
import { afterEach, describe, expect, it } from "bun:test";
import {
	ACTING_USER_HEADERS,
	ACTING_USER_TEST_VECTOR as V,
	signActingUser,
} from "@shenron/auth/acting-user";
import { actingUserSecret, verifyActingUser } from "../src/api/user-auth";
import { env } from "../src/lib/env";

const saved = {
	API_USER_SECRET: env.API_USER_SECRET,
	SHENRON_USER_SECRET: Bun.env.SHENRON_USER_SECRET,
};

afterEach(() => {
	(env as { API_USER_SECRET?: string }).API_USER_SECRET = saved.API_USER_SECRET;
	if (saved.SHENRON_USER_SECRET === undefined) delete Bun.env.SHENRON_USER_SECRET;
	else Bun.env.SHENRON_USER_SECRET = saved.SHENRON_USER_SECRET;
});

function vectorRequest(overrides: Partial<Record<"user" | "ts" | "sig", string>> = {}): Request {
	return new Request("http://localhost/api/economy/balance", {
		headers: {
			[ACTING_USER_HEADERS.user]: overrides.user ?? V.discordId,
			[ACTING_USER_HEADERS.ts]: overrides.ts ?? V.ts,
			[ACTING_USER_HEADERS.sig]: overrides.sig ?? V.sig,
		},
	});
}

describe("acting-user — vecteur partagé site → bot", () => {
	it("accepte ACTING_USER_TEST_VECTOR avec API_USER_SECRET", () => {
		delete Bun.env.SHENRON_USER_SECRET;
		(env as { API_USER_SECRET?: string }).API_USER_SECRET = V.secret;
		expect(actingUserSecret()).toBe(V.secret);
		expect(verifyActingUser(vectorRequest(), Number(V.ts))).toBe(V.discordId);
		// Signature en majuscules : le bot compare en minuscules, comme avant.
		expect(verifyActingUser(vectorRequest({ sig: V.sig.toUpperCase() }), Number(V.ts))).toBe(
			V.discordId
		);
	});

	it("SHENRON_USER_SECRET (nom canonique) passe avant API_USER_SECRET", () => {
		Bun.env.SHENRON_USER_SECRET = V.secret;
		(env as { API_USER_SECRET?: string }).API_USER_SECRET = "x".repeat(40);
		expect(actingUserSecret()).toBe(V.secret);
		expect(verifyActingUser(vectorRequest(), Number(V.ts))).toBe(V.discordId);
	});

	it("signature produite par le signataire du site acceptée à l'instant courant", () => {
		delete Bun.env.SHENRON_USER_SECRET;
		(env as { API_USER_SECRET?: string }).API_USER_SECRET = V.secret;
		const headers = signActingUser({ secret: V.secret, discordId: V.discordId });
		expect(verifyActingUser(new Request("http://localhost/x", { headers }))).toBe(V.discordId);
	});

	it("refuse horloge décalée, identifiant invalide, signature fausse ou secret absent", () => {
		delete Bun.env.SHENRON_USER_SECRET;
		(env as { API_USER_SECRET?: string }).API_USER_SECRET = V.secret;
		const sixMinutes = 6 * 60 * 1000;
		expect(verifyActingUser(vectorRequest(), Number(V.ts) + sixMinutes)).toBeNull();
		expect(verifyActingUser(vectorRequest({ user: "abc" }), Number(V.ts))).toBeNull();
		expect(verifyActingUser(vectorRequest({ sig: "0".repeat(64) }), Number(V.ts))).toBeNull();
		expect(verifyActingUser(new Request("http://localhost/x"), Number(V.ts))).toBeNull();
		(env as { API_USER_SECRET?: string }).API_USER_SECRET = undefined;
		expect(verifyActingUser(vectorRequest(), Number(V.ts))).toBeNull();
	});
});
