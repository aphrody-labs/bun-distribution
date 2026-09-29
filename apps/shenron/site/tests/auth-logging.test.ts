/**
 * Journalisation de Better Auth — pas de jeton de session dans les logs.
 *
 * Constat du 2026-08-21 sur la production : `logger: { level: "debug" }` et
 * `debugLogs: true` faisaient écrire à Better Auth, dans le journal systemd, le
 * JETON DE SESSION EN CLAIR de chaque visiteur connecté — 343 jetons, 343
 * e-mails et 686 couples IP/user-agent sur 24 heures.
 *
 * Deux niveaux : les presets de `@shenron/auth/options` (unitaires), puis le
 * câblage de `src/lib/auth.ts` via `buildAuthOptions` / `authDatabaseConfig`,
 * construits avec des dépendances factices (aucune connexion PostgreSQL).
 */
import { describe, expect, mock, test } from "bun:test";
import { SESSION_COOKIE_CACHE, drizzleDebugLogs, loggingOptions } from "@shenron/auth/options";

const fakeEnv = {
	NODE_ENV: "production" as const,
	BETTER_AUTH_URL: "https://dragonballfr.com/\n",
	BETTER_AUTH_SECRET: "test-better-auth-secret-0123456789abcdef",
	DISCORD_CLIENT_ID: "123456789012345678",
	DISCORD_CLIENT_SECRET: "test-discord-client-secret",
	OAUTH_ALLOWED_USERS: [] as string[],
};

mock.module("server-only", () => ({}));
mock.module("../src/lib/env", () => ({ env: fakeEnv }));
mock.module("../src/lib/db", () => ({ db: {} }));
mock.module("../src/lib/account-data", () => ({ purgeAccountData: async () => {} }));
mock.module("../src/lib/current-user-cache", () => ({ invalidateCurrentUser: () => {} }));

const { authDatabaseConfig, buildAuthOptions } = await import("../src/lib/auth");

function options(nodeEnv: "production" | "development" | "test") {
	return buildAuthOptions({
		env: { ...fakeEnv, NODE_ENV: nodeEnv },
		// oxlint-disable-next-line no-explicit-any -- dépendance factice, jamais interrogée
		db: {} as any,
		purgeAccountData: async () => {},
		invalidateCurrentUser: () => {},
	});
}

describe("presets @shenron/auth/options", () => {
	test("niveau de log : warn en production, debug ailleurs", () => {
		expect(loggingOptions("production")).toEqual({ logger: { level: "warn" } });
		expect(loggingOptions("development")).toEqual({ logger: { level: "debug" } });
		expect(loggingOptions(undefined)).toEqual({ logger: { level: "debug" } });
	});

	test("logs de l'adaptateur Drizzle coupés en production seulement", () => {
		expect(drizzleDebugLogs("production")).toBe(false);
		expect(drizzleDebugLogs("development")).toBe(true);
		expect(drizzleDebugLogs("test")).toBe(true);
	});

	test("cache de cookie de session : 300 s", () => {
		expect(SESSION_COOKIE_CACHE).toEqual({ enabled: true, maxAge: 300 });
	});
});

describe("câblage de src/lib/auth.ts", () => {
	test("le niveau de log suit NODE_ENV (jamais debug en production)", () => {
		expect(options("production").logger).toEqual({ level: "warn" });
		expect(options("development").logger).toEqual({ level: "debug" });
	});

	test("debugLogs de l'adaptateur suit NODE_ENV (jamais true en production)", () => {
		expect(authDatabaseConfig("production").debugLogs).toBe(false);
		expect(authDatabaseConfig("development").debugLogs).toBe(true);
		expect(authDatabaseConfig("production").provider).toBe("pg");
	});

	test("cache de session, cookies sécurisés et URL normalisée", () => {
		const prod = options("production");
		expect(prod.session.cookieCache).toEqual({ enabled: true, maxAge: 300 });
		expect(prod.advanced.useSecureCookies).toBe(true);
		expect(options("development").advanced.useSecureCookies).toBe(false);
		expect(prod.baseURL.fallback).toBe("https://dragonballfr.com");
	});

	test("fournisseur Discord : consent, portées dédoublonnées, e-mail de substitution", () => {
		const discord = options("production").socialProviders.discord;
		expect(discord.prompt).toBe("consent");
		expect(discord.scope).toEqual(["guilds", "guilds.members.read"]);
		expect(discord.mapProfileToUser({ id: "42", email: null } as never)).toEqual({
			email: "42@discord.placeholder.local",
		});
	});
});
