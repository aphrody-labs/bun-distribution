/**
 * W3-AUTH-04 — même table que `packages/shenron/auth/test/guards.test.ts` (« bot
 * checkAdmin table », W2-AUTH-04), rejouée à travers le vrai `checkAdmin` du
 * bot : l'ordre 503 → Bearer (préfixe exact, mauvais jeton final) → session
 * Better Auth (staff requis, S1) → cookie hérité → 401, et les corps
 * historiques des réponses.
 */
import "./setup";
import { describe, expect, it } from "bun:test";
import {
	ADMIN_FORBIDDEN_MESSAGE,
	authorizeAdmin,
	checkAdmin,
	constantTimeEqual,
	type CheckAdminDeps,
} from "../src/api/auth";

const STAFF_ID = "200000000000000001";
const OTHER_ID = "200000000000000002";
const ADMIN_TOKEN = "bot-admin-token-0123456789";

interface World {
	adminToken?: string;
	baUser?: string;
	discordOf?: Record<string, string>;
	legacy?: { source: "token" | "discord"; userId?: string };
	lookupFails?: boolean;
}

function deps(world: World): CheckAdminDeps {
	return {
		adminToken: () => world.adminToken,
		betterAuthSession: async () => (world.baUser ? { user: { id: world.baUser } } : null),
		discordIdForBaUser: async (id) => {
			if (world.lookupFails) throw new Error("db down");
			return world.discordOf?.[id] ?? null;
		},
		legacySession: async () => world.legacy ?? null,
		isStaff: (id) => id === STAFF_ID,
	};
}

const req = (headers: Record<string, string> = {}) =>
	new Request("https://api.example.test/api/admin", { headers });

async function status(world: World, headers: Record<string, string> = {}) {
	const res = await checkAdmin(req(headers), deps(world));
	return res ? { status: res.status, body: await res.json() } : null;
}

describe("checkAdmin — ordre des stratégies (table W2-AUTH-04)", () => {
	const configured: World = { adminToken: ADMIN_TOKEN };

	it("jeton non configuré → 503 même avec une session staff", async () => {
		expect(await status({ baUser: "u", discordOf: { u: STAFF_ID } })).toEqual({
			status: 503,
			body: { error: "API_ADMIN_TOKEN non configuré côté bot — route admin désactivée." },
		});
	});

	it("bon Bearer → admin", async () => {
		expect(await status(configured, { authorization: `Bearer ${ADMIN_TOKEN}` })).toBeNull();
		const decision = await authorizeAdmin(
			req({ authorization: `Bearer ${ADMIN_TOKEN}` }),
			deps(configured)
		);
		expect(decision).toEqual({ ok: true, principal: { kind: "admin-token", via: "bearer" } });
	});

	it("mauvais Bearer (casse exacte) → 401 final même avec une session staff", async () => {
		const world: World = {
			...configured,
			baUser: "u",
			discordOf: { u: STAFF_ID },
			legacy: { source: "token" },
		};
		expect(await status(world, { authorization: "Bearer wrong" })).toEqual({
			status: 401,
			body: { error: "Token invalide." },
		});
		expect(await status(world, { authorization: `Bearer ${ADMIN_TOKEN}x` })).toEqual({
			status: 401,
			body: { error: "Token invalide." },
		});
	});

	it("schéma en minuscules : pas un Bearer pour le bot, on retombe sur la session", async () => {
		expect(
			await status(
				{ ...configured, legacy: { source: "token" } },
				{ authorization: `bearer ${ADMIN_TOKEN}` }
			)
		).toBeNull();
		expect(await status(configured, { authorization: `bearer ${ADMIN_TOKEN}` })).toEqual({
			status: 401,
			body: { error: "Authorization requise." },
		});
	});

	it("session Better Auth staff → ok", async () => {
		expect(await status({ ...configured, baUser: "u", discordOf: { u: STAFF_ID } })).toBeNull();
		const decision = await authorizeAdmin(
			req(),
			deps({ ...configured, baUser: "u", discordOf: { u: STAFF_ID } })
		);
		expect(decision.ok && decision.principal).toEqual({
			kind: "user",
			userId: "u",
			discordId: STAFF_ID,
			staff: true,
			via: "better-auth",
		});
	});

	it("session Better Auth non staff → 403, sans compte Discord → 403", async () => {
		const forbidden = { status: 403, body: { error: ADMIN_FORBIDDEN_MESSAGE } };
		expect(await status({ ...configured, baUser: "u", discordOf: { u: OTHER_ID } })).toEqual(
			forbidden
		);
		expect(await status({ ...configured, baUser: "u" })).toEqual(forbidden);
	});

	it("échec de lecture du compte → 403 (fail closed)", async () => {
		expect(await status({ ...configured, baUser: "u", lookupFails: true })).toEqual({
			status: 403,
			body: { error: ADMIN_FORBIDDEN_MESSAGE },
		});
	});

	it("la session Better Auth passe avant le cookie hérité", async () => {
		expect(
			await status({
				...configured,
				baUser: "u",
				discordOf: { u: OTHER_ID },
				legacy: { source: "token" },
			})
		).toEqual({ status: 403, body: { error: ADMIN_FORBIDDEN_MESSAGE } });
	});

	it("cookie hérité source=token → ok", async () => {
		expect(await status({ ...configured, legacy: { source: "token" } })).toBeNull();
	});

	it("cookie hérité source=discord : staff → ok, non staff → 403", async () => {
		expect(
			await status({ ...configured, legacy: { source: "discord", userId: STAFF_ID } })
		).toBeNull();
		expect(
			await status({ ...configured, legacy: { source: "discord", userId: OTHER_ID } })
		).toEqual({ status: 403, body: { error: ADMIN_FORBIDDEN_MESSAGE } });
		expect(await status({ ...configured, legacy: { source: "discord" } })).toEqual({
			status: 403,
			body: { error: ADMIN_FORBIDDEN_MESSAGE },
		});
	});

	it("rien → 401", async () => {
		expect(await status(configured)).toEqual({
			status: 401,
			body: { error: "Authorization requise." },
		});
	});
});

describe("constantTimeEqual", () => {
	it("égalité stricte, longueurs différentes refusées", () => {
		expect(constantTimeEqual(ADMIN_TOKEN, ADMIN_TOKEN)).toBe(true);
		expect(constantTimeEqual(ADMIN_TOKEN, `${ADMIN_TOKEN}x`)).toBe(false);
		expect(constantTimeEqual("", "")).toBe(true);
		expect(constantTimeEqual("a", "b")).toBe(false);
	});
});
