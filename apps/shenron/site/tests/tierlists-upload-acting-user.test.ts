/**
 * S7 côté site (docs/STACK.md §2.2) : le téléversement de tierlist part signé au
 * nom du membre (`x-acting-*`), jamais avec le jeton maître admin ; le proxy
 * `/api/bot-user/*` émet, à horloge fixée, des en-têtes octet pour octet
 * identiques à l'ancien signataire local.
 *
 * Aucun secret réel : le secret est celui du vecteur partagé
 * `ACTING_USER_TEST_VECTOR`, que le vérificateur du bot accepte tel quel.
 */
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import {
	ACTING_USER_TEST_VECTOR,
	verifyActingUser,
} from "@shenron/auth/acting-user";

const VECTOR = ACTING_USER_TEST_VECTOR;
const FIXED_NOW = Number(VECTOR.ts);
const ADMIN_TOKEN = "test-admin-master-token-0123456789";

let currentUser: { user: { id: string; roleAdmin: boolean }; discordId: string } | null = null;
let userSecret: string | undefined = VECTOR.secret;

mock.module("server-only", () => ({}));
mock.module("@/lib/session", () => ({ getCurrentUser: async () => currentUser }));
mock.module("@/lib/config", () => ({ API_URL: "http://bot.test" }));
mock.module("@/lib/env", () => ({
	env: {
		get SHENRON_USER_SECRET() {
			return userSecret;
		},
		SHENRON_ADMIN_TOKEN: ADMIN_TOKEN,
	},
}));

interface Captured {
	url: string;
	method: string;
	headers: Headers;
	rawHeaders: HeadersInit | undefined;
	body: BodyInit | null | undefined;
}
const calls: Captured[] = [];
let upstream: () => Response = () => Response.json({ path: "./assets/wiki/tierlists/x.png" });

const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
	calls.push({
		url: String(input),
		method: init?.method ?? "GET",
		headers: new Headers(init?.headers),
		rawHeaders: init?.headers,
		body: init?.body,
	});
	return upstream();
}) as typeof fetch;

const realNow = Date.now;
Date.now = () => FIXED_NOW;

const upload = await import("../src/app/api/tierlists/upload/route");
const botUser = await import("../src/app/api/bot-user/[...path]/route");

afterAll(() => {
	globalThis.fetch = originalFetch;
	Date.now = realNow;
});

beforeEach(() => {
	calls.length = 0;
	userSecret = VECTOR.secret;
	currentUser = { user: { id: "user-member", roleAdmin: false }, discordId: VECTOR.discordId };
	upstream = () => Response.json({ path: "./assets/wiki/tierlists/x.png" });
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

function uploadRequest(): Request {
	const form = new FormData();
	form.append("file", new File([PNG], "mine.png", { type: "application/octet-stream" }));
	return new Request("http://test/api/tierlists/upload", { method: "POST", body: form });
}

describe("tierlists/upload : acting-user (S7)", () => {
	test("relaie au bot avec les en-têtes x-acting-* du membre et sans jeton admin", async () => {
		const res = await upload.POST(uploadRequest());
		expect(res.status).toBe(201);
		expect(await res.json()).toEqual({ path: "./assets/wiki/tierlists/x.png" });

		expect(calls).toHaveLength(1);
		const call = calls[0]!;
		expect(call.url).toBe("http://bot.test/api/assets/upload");
		expect(call.method).toBe("POST");
		// Aucun Authorization (ni jeton maître, ni autre) ne part vers le bot.
		expect(call.headers.get("authorization")).toBeNull();
		expect(JSON.stringify(call.rawHeaders)).not.toContain(ADMIN_TOKEN);
		// Sémantique du vecteur partagé : mêmes id, ts et signature.
		expect(call.headers.get("x-acting-user")).toBe(VECTOR.discordId);
		expect(call.headers.get("x-acting-ts")).toBe(VECTOR.ts);
		expect(call.headers.get("x-acting-sig")).toBe(VECTOR.sig);
		// Le vérificateur du bot accepte la signature.
		expect(verifyActingUser(call.headers, { secret: VECTOR.secret, nowMs: FIXED_NOW })).toEqual({
			ok: true,
			discordId: VECTOR.discordId,
		});
		// Périmètre dédié : le bot borne l'acting-user à `tierlists`.
		const body = call.body as FormData;
		expect(body.get("subdir")).toBe("tierlists");
		const file = body.get("file") as File;
		expect(file.type).toBe("image/png");
	});

	test("anonyme : 401 sans appel au bot", async () => {
		currentUser = null;
		const res = await upload.POST(uploadRequest());
		expect(res.status).toBe(401);
		expect(calls).toHaveLength(0);
	});

	test("secret acting-user absent : 503, jamais de repli sur le jeton maître", async () => {
		userSecret = undefined;
		const res = await upload.POST(uploadRequest());
		expect(res.status).toBe(503);
		expect(await res.json()).toEqual({
			error: "Upload indisponible (SHENRON_USER_SECRET non configuré).",
		});
		expect(calls).toHaveLength(0);
	});

	test("session sans identifiant Discord : 403 sans appel au bot", async () => {
		currentUser = { user: { id: "user-member", roleAdmin: false }, discordId: "" };
		const res = await upload.POST(uploadRequest());
		expect(res.status).toBe(403);
		expect(calls).toHaveLength(0);
	});

	test("erreur du bot propagée telle quelle", async () => {
		upstream = () => Response.json({ error: "scope refusé" }, { status: 403 });
		const res = await upload.POST(uploadRequest());
		expect(res.status).toBe(403);
		expect(await res.json()).toEqual({ error: "scope refusé" });
	});
});

describe("bot-user proxy : en-têtes inchangés à horloge fixée", () => {
	/** Ancien signataire local, recopié à l'identique pour la comparaison. */
	function legacyHeaders(discordId: string, secret: string): Record<string, string> {
		const ts = String(Date.now());
		const sig = createHmac("sha256", secret).update(`${discordId}:${ts}`).digest("hex");
		return {
			"content-type": "application/json",
			accept: "application/json",
			"x-acting-user": discordId,
			"x-acting-ts": ts,
			"x-acting-sig": sig,
		};
	}

	test("GET /api/bot-user/me/profile : en-têtes octet pour octet identiques", async () => {
		upstream = () => Response.json({ ok: true });
		const req = new NextRequest("http://test/api/bot-user/me/profile?x=1");
		const res = await botUser.GET(req, { params: Promise.resolve({ path: ["me", "profile"] }) });
		expect(res.status).toBe(200);
		expect(calls).toHaveLength(1);
		const call = calls[0]!;
		expect(call.url).toBe("http://bot.test/api/me/profile?x=1");
		// Objet d'en-têtes brut : mêmes clés, même ordre, mêmes valeurs.
		expect(JSON.stringify(call.rawHeaders)).toBe(
			JSON.stringify(legacyHeaders(VECTOR.discordId, VECTOR.secret))
		);
		expect(call.headers.get("x-acting-sig")).toBe(VECTOR.sig);
	});

	test("sans session : 401 sans appel au bot", async () => {
		currentUser = null;
		const req = new NextRequest("http://test/api/bot-user/me");
		const res = await botUser.GET(req, { params: Promise.resolve({ path: ["me"] }) });
		expect(res.status).toBe(401);
		expect(calls).toHaveLength(0);
	});
});
