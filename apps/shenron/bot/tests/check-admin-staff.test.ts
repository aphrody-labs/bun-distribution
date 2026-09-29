import "./setup";
import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { container } from "tsyringe";
import { ADMIN_FORBIDDEN_MESSAGE, checkAdmin, type CheckAdminDeps } from "../src/api/auth";
import {
	SESSION_SECRET_FALLBACK_WARNING,
	createSession,
	resetSessionSecretFallbackWarning,
	verifySession,
} from "../src/api/session";
import { discordIdForBaUser, isBotStaff } from "../src/api/staff-check";
import { botAuthBaseUrl, buildBotAuthOptions, refuseNonStaffSession } from "../src/lib/better-auth";
import { DatabaseService } from "../src/db/index";
import { baAccount, baUser } from "../src/db/schema";
import { env } from "../src/lib/env";
import { logger } from "../src/lib/logger";

const ADMIN_TOKEN = "admin-token-for-tests-0123456789";
const STAFF = "222222222222222222";
const OUTSIDER = "333333333333333333";

function deps(overrides: Partial<CheckAdminDeps> = {}): CheckAdminDeps {
	return {
		adminToken: () => ADMIN_TOKEN,
		betterAuthSession: async () => null,
		discordIdForBaUser: async () => null,
		legacySession: async () => null,
		isStaff: (id) => id === STAFF,
		...overrides,
	};
}

function req(headers: Record<string, string> = {}): Request {
	return new Request("http://localhost/api/admin/x", { headers });
}

describe("checkAdmin — S1 staff policy", () => {
	it("unset API_ADMIN_TOKEN -> 503", async () => {
		const res = await checkAdmin(req(), deps({ adminToken: () => undefined }));
		expect(res?.status).toBe(503);
	});

	it("right Bearer -> allowed", async () => {
		expect(await checkAdmin(req({ authorization: `Bearer ${ADMIN_TOKEN}` }), deps())).toBeNull();
	});

	it("wrong Bearer -> final 401 even with a valid staff session", async () => {
		const res = await checkAdmin(
			req({ authorization: "Bearer nope" }),
			deps({
				betterAuthSession: async () => ({ user: { id: "ba-staff" } }),
				discordIdForBaUser: async () => STAFF,
				legacySession: async () => ({ source: "token" }),
			})
		);
		expect(res?.status).toBe(401);
	});

	it("lowercase `bearer` falls through to the session checks as today", async () => {
		const allowed = await checkAdmin(
			req({ authorization: `bearer ${ADMIN_TOKEN}` }),
			deps({ legacySession: async () => ({ source: "token" }) })
		);
		expect(allowed).toBeNull();
		const denied = await checkAdmin(req({ authorization: `bearer ${ADMIN_TOKEN}` }), deps());
		expect(denied?.status).toBe(401);
	});

	it("staff Better Auth session -> allowed", async () => {
		const res = await checkAdmin(
			req(),
			deps({
				betterAuthSession: async () => ({ user: { id: "ba-staff" } }),
				discordIdForBaUser: async (id) => (id === "ba-staff" ? STAFF : null),
			})
		);
		expect(res).toBeNull();
	});

	it("de-whitelisted Better Auth session -> 403", async () => {
		const res = await checkAdmin(
			req(),
			deps({
				betterAuthSession: async () => ({ user: { id: "ba-out" } }),
				discordIdForBaUser: async () => OUTSIDER,
			})
		);
		expect(res?.status).toBe(403);
		expect(await res?.json()).toEqual({ error: ADMIN_FORBIDDEN_MESSAGE });
	});

	it("Better Auth session without a Discord account -> 403", async () => {
		const res = await checkAdmin(
			req(),
			deps({ betterAuthSession: async () => ({ user: { id: "ba-none" } }) })
		);
		expect(res?.status).toBe(403);
	});

	it("ba_account read failure fails closed -> 403", async () => {
		const res = await checkAdmin(
			req(),
			deps({
				betterAuthSession: async () => ({ user: { id: "ba-x" } }),
				discordIdForBaUser: async () => {
					throw new Error("db down");
				},
			})
		);
		expect(res?.status).toBe(403);
	});

	it("legacy discord session not staff -> 403; staff -> allowed", async () => {
		const out = await checkAdmin(
			req(),
			deps({ legacySession: async () => ({ source: "discord", userId: OUTSIDER }) })
		);
		expect(out?.status).toBe(403);
		const ok = await checkAdmin(
			req(),
			deps({ legacySession: async () => ({ source: "discord", userId: STAFF }) })
		);
		expect(ok).toBeNull();
	});

	it("legacy token session -> allowed unchanged", async () => {
		expect(
			await checkAdmin(req(), deps({ legacySession: async () => ({ source: "token" }) }))
		).toBeNull();
	});

	it("no credentials -> 401", async () => {
		expect((await checkAdmin(req(), deps()))?.status).toBe(401);
	});
});

describe("staff-check", () => {
	it("isBotStaff follows isUserAllowed (OWNER_ID is staff)", () => {
		expect(isBotStaff(env.OWNER_ID)).toBe(true);
		expect(isBotStaff(OUTSIDER)).toBe(false);
		expect(isBotStaff(null)).toBe(false);
		expect(isBotStaff("")).toBe(false);
	});

	it("discordIdForBaUser reads ba_account provider discord", async () => {
		const db = container.resolve(DatabaseService).db;
		const now = new Date();
		await db.insert(baUser).values([
			{ id: "ba-s1-a", name: "a", email: "a-s1@test.local", createdAt: now, updatedAt: now },
			{ id: "ba-s1-b", name: "b", email: "b-s1@test.local", createdAt: now, updatedAt: now },
		]);
		await db.insert(baAccount).values([
			{
				id: "acc-s1-a",
				userId: "ba-s1-a",
				accountId: STAFF,
				providerId: "discord",
				createdAt: now,
				updatedAt: now,
			},
			{
				id: "acc-s1-b",
				userId: "ba-s1-b",
				accountId: "gh-1",
				providerId: "github",
				createdAt: now,
				updatedAt: now,
			},
		]);
		expect(await discordIdForBaUser("ba-s1-a", db)).toBe(STAFF);
		expect(await discordIdForBaUser("ba-s1-b", db)).toBeNull();
		expect(await discordIdForBaUser("ba-missing", db)).toBeNull();
	});
});

describe("S1b — session.create.before", () => {
	it("refuses a non-staff Discord account and lets staff through", async () => {
		const gate = { discordIdForBaUser: async (id: string) => (id === "s" ? STAFF : OUTSIDER) };
		expect(
			await refuseNonStaffSession({ userId: "s" }, { ...gate, isStaff: (id) => id === STAFF })
		).toBe(undefined);
		expect(
			await refuseNonStaffSession({ userId: "o" }, { ...gate, isStaff: (id) => id === STAFF })
		).toBe(false);
		expect(
			await refuseNonStaffSession(
				{ userId: "e" },
				{
					discordIdForBaUser: async () => {
						throw new Error("boom");
					},
					isStaff: (id) => id === STAFF,
				}
			)
		).toBe(false);
	});
});

describe("S10 — SESSION_SECRET fallback warning", () => {
	const saved = { SESSION_SECRET: env.SESSION_SECRET, API_ADMIN_TOKEN: env.API_ADMIN_TOKEN };
	let warnSpy: ReturnType<typeof spyOn>;

	beforeEach(() => {
		resetSessionSecretFallbackWarning();
		warnSpy = spyOn(logger, "warn");
	});
	afterEach(() => {
		warnSpy.mockRestore();
		(env as { SESSION_SECRET?: string }).SESSION_SECRET = saved.SESSION_SECRET;
		(env as { API_ADMIN_TOKEN?: string }).API_ADMIN_TOKEN = saved.API_ADMIN_TOKEN;
	});

	it("warns once, without any secret value, and old cookies still verify", async () => {
		(env as { SESSION_SECRET?: string }).SESSION_SECRET = undefined;
		(env as { API_ADMIN_TOKEN?: string }).API_ADMIN_TOKEN = ADMIN_TOKEN;
		const cookie = await createSession();
		const again = await createSession();
		const payload = await verifySession(cookie);
		expect(payload?.source).toBe("token");
		expect(await verifySession(again)).not.toBeNull();

		const calls = warnSpy.mock.calls.filter((c) => c[0] === SESSION_SECRET_FALLBACK_WARNING);
		expect(calls).toHaveLength(1);
		for (const call of warnSpy.mock.calls) {
			expect(JSON.stringify(call)).not.toContain(ADMIN_TOKEN);
		}
	});

	it("no warning when SESSION_SECRET is set", async () => {
		(env as { SESSION_SECRET?: string }).SESSION_SECRET = "s".repeat(40);
		(env as { API_ADMIN_TOKEN?: string }).API_ADMIN_TOKEN = ADMIN_TOKEN;
		expect(await verifySession(await createSession())).not.toBeNull();
		expect(warnSpy.mock.calls.filter((c) => c[0] === SESSION_SECRET_FALLBACK_WARNING)).toHaveLength(
			0
		);
	});
});

describe("B10 — options Better Auth du bot", () => {
	const options = buildBotAuthOptions({
		db: {},
		secret: "s".repeat(40),
		discordClientId: "123456789012345678",
		discordClientSecret: "discord-client-secret-for-tests",
		baseURL: "https://bot.dragonballfr.com",
		nodeEnv: "production",
	});

	it("fournisseur Discord : consent, portées dédoublonnées, e-mail de substitution", () => {
		const discord = options.socialProviders.discord;
		expect(discord.prompt).toBe("consent");
		expect(discord.scope).toEqual(["guilds", "guilds.members.read"]);
		expect(discord.mapProfileToUser({ id: STAFF, email: null } as never)).toEqual({
			email: `${STAFF}@discord.placeholder.local`,
		});
		expect(discord.mapProfileToUser({ id: STAFF, email: "a@b.c" } as never)).toEqual({
			email: "a@b.c",
		});
	});

	it("chemin partagé, préfixe de cookie inchangé, cache 300 s, crochet S1b", () => {
		expect(options.basePath).toBe("/api/auth");
		expect(options.advanced.cookiePrefix).toBe("shenron_ba");
		expect(options.advanced.useSecureCookies).toBe(true);
		expect(options.session.cookieCache).toEqual({ enabled: true, maxAge: 300 });
		expect(typeof options.databaseHooks.session.create.before).toBe("function");
	});

	it("URL de base normalisée", () => {
		expect(
			botAuthBaseUrl({
				BETTER_AUTH_URL: "https://bot.dragonballfr.com/\n",
				OAUTH_REDIRECT_URI: undefined,
			})
		).toBe("https://bot.dragonballfr.com");
		expect(
			botAuthBaseUrl({
				BETTER_AUTH_URL: undefined,
				OAUTH_REDIRECT_URI: "https://bot.example.test/auth/callback",
			})
		).toBe("https://bot.example.test");
		expect(botAuthBaseUrl({ BETTER_AUTH_URL: undefined, OAUTH_REDIRECT_URI: undefined })).toBe(
			"https://bot.dragonballfr.com"
		);
	});

	it("le crochet de création de compte refuse un Discord hors politique staff", async () => {
		const before = options.databaseHooks.account.create.before;
		await expect(before({ providerId: "discord", accountId: OUTSIDER })).rejects.toThrow();
		await expect(
			before({ providerId: "discord", accountId: env.OWNER_ID })
		).resolves.toBeUndefined();
		await expect(before({ providerId: "github", accountId: OUTSIDER })).resolves.toBeUndefined();
	});
});
