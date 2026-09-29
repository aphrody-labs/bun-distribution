/**
 * Tests unitaires — helpers d'authentification & sécurité du ranked (logique pure).
 *
 * Couvre src/ranked/auth.ts : getCookie, verifyToken, authFromColyseus
 * (toutes les sources de token), ainsi que la regex anti open-redirect
 * utilisée dans src/api/controllers/auth.ts.
 *
 * Aucune dépendance DB / binding natif : on signe les JWT de test avec
 * jsonwebtoken et un secret posé dans process.env.JWT_SECRET_KEY.
 */

import { beforeAll, describe, expect, test } from "bun:test";
import jwt from "jsonwebtoken";
import { signAchilleaRealtimeToken, signAchilleaSessionToken } from "@rosegriffon/auth/achillea-session";

import { authFromColyseus, getCookie, verifyToken } from "../../src/ranked/auth";
import {
	AUTH_ISSUER,
	REALTIME_AUDIENCE,
} from "../../src/auth/session";

const TEST_SECRET = "secret-de-test-unitaire-ranked-auth";

// Pose la clé de signature avant le chargement des cas (verifyToken la lit à chaud).
beforeAll(() => {
	process.env.JWT_SECRET_KEY = TEST_SECRET;
});

// Fabrique un JWT HS256 valide signé avec le secret de test.
function signValid(payload: Record<string, unknown>, secret = TEST_SECRET): string {
	const identity = payload.id ?? payload.sub;
	return jwt.sign(
		{ ...payload, tokenUse: "realtime" },
		secret,
		{
			algorithm: "HS256",
			issuer: AUTH_ISSUER,
			audience: REALTIME_AUDIENCE,
			expiresIn: "5m",
			...(typeof payload.id === "string" ? { subject: identity } : {}),
		}
	);
}

describe("getCookie", () => {
	test("retourne null quand l'en-tête est null", () => {
		expect(getCookie(null, "token")).toBeNull();
	});

	test("retourne null quand l'en-tête est vide", () => {
		expect(getCookie("", "token")).toBeNull();
	});

	test("extrait un cookie présent seul", () => {
		expect(getCookie("token=abc123", "token")).toBe("abc123");
	});

	test("extrait le bon cookie parmi plusieurs (multi)", () => {
		const header = "theme=dark; token=xyz789; lang=fr";
		expect(getCookie(header, "token")).toBe("xyz789");
	});

	test("tolère les espaces autour des séparateurs", () => {
		expect(getCookie("  a=1 ;   token=ok  ", "token")).toBe("ok");
	});

	test("retourne null quand le cookie demandé est absent", () => {
		expect(getCookie("a=1; b=2", "token")).toBeNull();
	});

	test("décode les valeurs URL-encodées", () => {
		expect(getCookie("token=a%20b%3Dc", "token")).toBe("a b=c");
	});

	test("conserve les '=' internes à la valeur (JWT base64)", () => {
		const value = "header.payload.signature==";
		expect(getCookie(`token=${value}`, "token")).toBe(value);
	});
});
describe("verifyToken", () => {
	test("décode un JWT valide signé avec le secret de test", () => {
		const token = signValid({ id: "42", username: "Goenji", avatar: "hash" });
		const user = verifyToken(token);
		expect(user).toEqual({ id: "42", username: "Goenji", avatar: "hash" });
	});

	test("retombe sur `sub` quand `id` est absent", () => {
		const token = signValid({ sub: "99" });
		const user = verifyToken(token);
		expect(user.id).toBe("99");
		expect(user.username).toBeUndefined();
		expect(user.avatar).toBeUndefined();
	});

	test("rejette une signature invalide (mauvais secret)", () => {
		const token = signValid({ id: "1" }, "mauvais-secret");
		expect(() => verifyToken(token)).toThrow();
	});

	test("rejette un token sans id ni sub exploitable", () => {
		const token = signValid({ username: "anon" });
		expect(() => verifyToken(token)).toThrow("Token sans id");
	});

	test("rejette un JWT signé avec un algorithme non autorisé (none)", () => {
		// HS256 attendu ; un token 'none' (non signé) doit être refusé.
		const unsigned = jwt.sign({ id: "1" }, "", { algorithm: "none" });
		expect(() => verifyToken(unsigned)).toThrow();
	});

	test("ignore username/avatar non-string", () => {
		const token = signValid({ id: "7", username: 123, avatar: true });
		const user = verifyToken(token);
		expect(user).toEqual({ id: "7", username: undefined, avatar: undefined });
	});
});

describe("authFromColyseus", () => {
	const validToken = () => signValid({ id: "100", username: "Endou" });
	const validCookie = () => signAchilleaSessionToken({ id: "100", username: "Endou" }, TEST_SECRET);

	test("authentifie via context.token (source prioritaire)", () => {
		const user = authFromColyseus({}, { token: validToken() });
		expect(user?.id).toBe("100");
	});

	test("authentifie via cookie sur un objet Headers (transport Bun WS)", () => {
		const headers = new Headers();
		headers.set("cookie", `token=${validCookie()}`);
		const user = authFromColyseus({}, { headers });
		expect(user?.id).toBe("100");
	});

	test("authentifie via cookie sur un objet plain { cookie }", () => {
		const user = authFromColyseus({}, { headers: { cookie: `token=${validCookie()}` } });
		expect(user?.id).toBe("100");
	});

	test("authentifie via en-tête Authorization Bearer", () => {
		const headers = new Headers();
		headers.set("authorization", `Bearer ${validToken()}`);
		const user = authFromColyseus({}, { headers });
		expect(user?.id).toBe("100");
	});

	test("authentifie via options.token (dernier recours)", () => {
		const user = authFromColyseus({ token: validToken() }, {});
		expect(user?.id).toBe("100");
	});

	test("ignore un context.token invalide et bascule sur le cookie valide", () => {
		const headers = new Headers();
		headers.set("cookie", `token=${validCookie()}`);
		const user = authFromColyseus({}, { token: "jeton-pourri", headers });
		expect(user?.id).toBe("100");
	});

	test("renvoie null quand aucune source ne fournit de token", () => {
		expect(authFromColyseus({}, {})).toBeNull();
		expect(authFromColyseus(undefined, undefined)).toBeNull();
		expect(authFromColyseus({}, { headers: new Headers() })).toBeNull();
	});

	test("renvoie null quand toutes les sources sont invalides", () => {
		const headers = new Headers();
		headers.set("cookie", "token=cookie-invalide");
		headers.set("authorization", "Bearer auth-invalide");
		const user = authFromColyseus(
			{ token: "options-invalide" },
			{ token: "ctx-invalide", headers }
		);
		expect(user).toBeNull();
	});

	test("keeps web sessions in cookies and realtime tokens in handshakes", () => {
		const session = signAchilleaSessionToken({ id: "session-user" }, TEST_SECRET);
		const realtime = signAchilleaRealtimeToken({ id: "realtime-user" }, TEST_SECRET);
		expect(authFromColyseus({}, { headers: { cookie: `token=${session}` } })?.id).toBe(
			"session-user"
		);
		expect(authFromColyseus({}, { token: realtime })?.id).toBe("realtime-user");
		expect(authFromColyseus({}, { token: session })).toBeNull();
		expect(authFromColyseus({}, { headers: { cookie: `token=${realtime}` } })).toBeNull();
	});
});
