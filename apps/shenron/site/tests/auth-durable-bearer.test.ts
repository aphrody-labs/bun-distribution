// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeEach, describe, expect, mock, setSystemTime, test } from "bun:test";
import { createAdminCookieCodec } from "@shenron/auth/tokens";

const SECRET = "durable-auth-secret-0123456789abcdef";
const TOKEN = "durable-admin-token-0123456789";
const NOW = 1767225600000;

const fakeEnv = {
	NODE_ENV: "production" as const,
	BETTER_AUTH_SECRET: SECRET,
	SHENRON_ADMIN_TOKEN: TOKEN,
	BETTER_AUTH_URL: "https://dragonballfr.com",
	DISCORD_CLIENT_ID: "123456789012345678",
	DISCORD_CLIENT_SECRET: "test-discord-client-secret",
	OAUTH_ALLOWED_USERS: [] as string[],
	OWNER_ID: "1527405876695142620",
};

mock.module("server-only", () => ({}));
mock.module("@/lib/env", () => ({ env: fakeEnv }));

const adminToken = await import("../src/lib/admin-token");
const { buildAuthOptions } = await import("../src/lib/auth");

describe("auth-durable-bearer — validation des mécanismes d'authentification durable", () => {
	beforeEach(() => {
		setSystemTime(new Date(NOW));
		fakeEnv.SHENRON_ADMIN_TOKEN = TOKEN;
	});
	afterAll(() => {
		setSystemTime();
	});

	test("verifyAdminTokenOrBearer accepte le token en clair et le cookie signé", () => {
		expect(adminToken.verifyAdminTokenOrBearer(TOKEN)).toBe(true);
		const codec = createAdminCookieCodec({ secret: SECRET, masterToken: TOKEN });
		const signedCookie = codec.sign(NOW);
		expect(adminToken.verifyAdminTokenOrBearer(signedCookie)).toBe(true);
		expect(adminToken.verifyAdminTokenOrBearer("faux-token")).toBe(false);
		expect(adminToken.verifyAdminTokenOrBearer(null)).toBe(false);
	});

	test("DURABLE_ADMIN_COOKIE_MAX_AGE est configuré pour 30 jours", () => {
		expect(adminToken.DURABLE_ADMIN_COOKIE_MAX_AGE).toBe(30 * 24 * 60 * 60);
	});

	test("buildAuthOptions enregistre le plugin bearer et une session durable", () => {
		const options = buildAuthOptions({
			env: fakeEnv,
			// oxlint-disable-next-line no-explicit-any
			db: {} as any,
			purgeAccountData: async () => {},
			invalidateCurrentUser: () => {},
		});

		expect(options.session.expiresIn).toBe(30 * 24 * 60 * 60);
		expect(options.session.updateAge).toBe(24 * 60 * 60);
		expect(options.plugins).toBeDefined();
		const pluginIds = options.plugins?.map((p) => p.id);
		expect(pluginIds).toContain("bearer");
	});
});
