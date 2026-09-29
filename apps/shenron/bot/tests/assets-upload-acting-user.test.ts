/**
 * W3-AUTH-06 / S7 (bot) — `/api/assets/upload` accepte en plus une signature
 * acting-user valide, pour le seul périmètre tierlist ; le Bearer admin reste
 * accepté pour tous les périmètres ; une requête non signée reste en 401.
 *
 * Les deux gardes de la route (`authorizeAssetUpload` puis
 * `assetUploadScopeDenied`) sont exercées avec le vrai `checkAdmin` et le vrai
 * vérificateur acting-user.
 */
import "./setup";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { ACTING_USER_TEST_VECTOR as V, signActingUser } from "@shenron/auth/acting-user";
import {
	ACTING_USER_UPLOAD_SUBDIRS,
	assetUploadScopeDenied,
	authorizeAssetUpload,
	checkAdmin,
	defaultCheckAdminDeps,
	type AssetUploadDeps,
} from "../src/api/auth";
import { verifyActingUser } from "../src/api/user-auth";
import { env } from "../src/lib/env";

const ADMIN_TOKEN = "admin-token-for-upload-tests-0123";
const saved = { API_ADMIN_TOKEN: env.API_ADMIN_TOKEN, API_USER_SECRET: env.API_USER_SECRET };

const uploadDeps: AssetUploadDeps = {
	checkAdmin: (req) =>
		checkAdmin(req, {
			...defaultCheckAdminDeps,
			betterAuthSession: async () => null,
			legacySession: async () => null,
		}),
	actingUser: (req) => verifyActingUser(req),
};

beforeEach(() => {
	(env as { API_ADMIN_TOKEN?: string }).API_ADMIN_TOKEN = ADMIN_TOKEN;
	(env as { API_USER_SECRET?: string }).API_USER_SECRET = V.secret;
	delete Bun.env.SHENRON_USER_SECRET;
});

afterEach(() => {
	(env as { API_ADMIN_TOKEN?: string }).API_ADMIN_TOKEN = saved.API_ADMIN_TOKEN;
	(env as { API_USER_SECRET?: string }).API_USER_SECRET = saved.API_USER_SECRET;
});

function uploadRequest(headers: Record<string, string>): Request {
	return new Request("http://localhost/api/assets/upload", { method: "POST", headers });
}

/** Décision complète de la route pour `subdir` : `null` = téléversement admis. */
async function routeDecision(req: Request, subdir: string): Promise<number | null> {
	const auth = await authorizeAssetUpload(req, uploadDeps);
	if (!auth.ok) return auth.response.status;
	return assetUploadScopeDenied(auth, subdir)?.status ?? null;
}

describe("S7 — /api/assets/upload", () => {
	it("le périmètre acting-user est la seule tierlist", () => {
		expect([...ACTING_USER_UPLOAD_SUBDIRS]).toEqual(["tierlists"]);
	});

	it("membre signé : admis pour tierlists", async () => {
		const req = uploadRequest(signActingUser({ secret: V.secret, discordId: V.discordId }));
		const auth = await authorizeAssetUpload(req, uploadDeps);
		expect(auth).toEqual({ ok: true, via: "acting-user", discordId: V.discordId });
		expect(await routeDecision(req, "tierlists")).toBeNull();
	});

	it("membre signé : refusé (403) pour tout autre périmètre", async () => {
		const req = uploadRequest(signActingUser({ secret: V.secret, discordId: V.discordId }));
		for (const subdir of ["", "personnages", "wiki", "tierlist"]) {
			expect(await routeDecision(req, subdir)).toBe(403);
		}
		const auth = await authorizeAssetUpload(req, uploadDeps);
		if (!auth.ok) throw new Error("acting-user attendu");
		expect(await assetUploadScopeDenied(auth, "personnages")?.json()).toEqual({
			error: "Périmètre de téléversement refusé.",
		});
	});

	it("Bearer admin inchangé : tous les périmètres", async () => {
		const req = uploadRequest({ authorization: `Bearer ${ADMIN_TOKEN}` });
		expect(await authorizeAssetUpload(req, uploadDeps)).toEqual({ ok: true, via: "admin" });
		for (const subdir of ["", "tierlists", "personnages"]) {
			expect(await routeDecision(req, subdir)).toBeNull();
		}
	});

	it("mauvais Bearer admin → 401 (signature absente)", async () => {
		expect(await routeDecision(uploadRequest({ authorization: "Bearer nope" }), "tierlists")).toBe(
			401
		);
	});

	it("requête non signée → 401", async () => {
		const res = await authorizeAssetUpload(uploadRequest({}), uploadDeps);
		expect(res.ok).toBe(false);
		if (res.ok) return;
		expect(res.response.status).toBe(401);
		expect(await res.response.json()).toEqual({ error: "Authorization requise." });
	});

	it("signature fausse ou périmée → 401", async () => {
		const forged = signActingUser({ secret: "x".repeat(40), discordId: V.discordId });
		expect(await routeDecision(uploadRequest(forged), "tierlists")).toBe(401);
		const stale = signActingUser({
			secret: V.secret,
			discordId: V.discordId,
			nowMs: Date.now() - 10 * 60 * 1000,
		});
		expect(await routeDecision(uploadRequest(stale), "tierlists")).toBe(401);
	});
});
