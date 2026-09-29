/**
 * Contrat de confidentialité de l'espace compte.
 *
 * `account-data.ts` et la route d'export ouvrent PostgreSQL à l'import : comme
 * les autres tests de garde du dépôt, on vérifie leur source. Les crochets
 * Better Auth de `src/lib/auth.ts`, eux, sont exécutés pour de vrai à travers
 * `buildAuthOptions` avec des dépendances factices (aucune suppression réelle).
 */
import { describe, expect, mock, test } from "bun:test";
import { APIError } from "better-auth/api";

const accountData = await Bun.file(new URL("../src/lib/account-data.ts", import.meta.url)).text();
const exportRoute = await Bun.file(
	new URL("../src/app/api/account/export/route.ts", import.meta.url)
).text();

const fakeEnv = {
	NODE_ENV: "test" as const,
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

const { buildAuthOptions } = await import("../src/lib/auth");

/** Base factice : `select … limit()` renvoie `rows`. */
function fakeDb(rows: unknown[]) {
	const chain = {
		select: () => chain,
		from: () => chain,
		innerJoin: () => chain,
		where: () => chain,
		limit: async () => rows,
	};
	return chain;
}

function build(rows: unknown[] = []) {
	const purged: unknown[] = [];
	const invalidated: string[] = [];
	const options = buildAuthOptions({
		env: fakeEnv,
		// oxlint-disable-next-line no-explicit-any -- chaîne Drizzle factice
		db: fakeDb(rows) as any,
		purgeAccountData: async (input) => {
			purged.push(input);
		},
		invalidateCurrentUser: (id) => {
			invalidated.push(id);
		},
	});
	return { options, purged, invalidated };
}

describe("archive personnelle", () => {
	test("refuse un visiteur anonyme avant de lire les données", () => {
		const gate = exportRoute.indexOf("if (!me?.user)");
		const read = exportRoute.indexOf("readAccountData({");
		expect(gate).toBeGreaterThan(-1);
		expect(read).toBeGreaterThan(gate);
		expect(exportRoute).toContain('"Cache-Control": "private, no-store"');
		expect(exportRoute).toContain('"X-Content-Type-Options": "nosniff"');
	});

	test("n'exporte aucun secret d'authentification", () => {
		expect(accountData).not.toMatch(/baAccount|baSession|accessToken|refreshToken|idToken/);
		expect(accountData).toContain("emailVerified: baUser.emailVerified");
		expect(accountData).toContain("activity: events");
		expect(accountData).toContain("community:");
	});
});

describe("suppression du compte", () => {
	test("efface les données personnelles et anonymise l'historique conservé", () => {
		for (const table of [
			"siteEvents",
			"userPreferences",
			"tierlistVotes",
			"siteRatings",
			"editorDrafts",
		]) {
			expect(accountData).toMatch(new RegExp(`tx\\s*\\.delete\\(${table}\\)`));
		}
		for (const table of ["siteReports", "wikiContributions", "wikiRevisions", "users"]) {
			expect(accountData).toMatch(new RegExp(`\\.update\\(${table}\\)`));
		}
		expect(accountData).toContain('username: "Compte supprimé"');
		expect(accountData).toContain("authorDiscordId: null");
		expect(accountData).toContain("userAgent: null");
	});

	test("la purge est branchée après la suppression Better Auth", async () => {
		const { options, purged } = build([{ appUserId: "app-1", discordId: "123456789012345678" }]);
		expect(options.user.deleteUser.enabled).toBe(true);
		await options.user.deleteUser.beforeDelete({ id: "ba-1" });
		expect(purged).toEqual([]);
		await options.user.deleteUser.afterDelete({ id: "ba-1" });
		expect(purged).toEqual([
			{ authUserId: "ba-1", appUserId: "app-1", discordId: "123456789012345678" },
		]);
		// L'entrée mémorisée est consommée : une seconde suppression ne repurge pas.
		await options.user.deleteUser.afterDelete({ id: "ba-1" });
		expect(purged).toHaveLength(1);
	});

	test("sans compte métier lié, aucune purge", async () => {
		const { options, purged } = build([]);
		await options.user.deleteUser.beforeDelete({ id: "ba-2" });
		await options.user.deleteUser.afterDelete({ id: "ba-2" });
		expect(purged).toEqual([]);
	});

	test("les mutations de profil sont validées côté serveur", async () => {
		const { options, invalidated } = build();
		const before = options.databaseHooks.user.update.before;
		await expect(before({ name: "a" })).rejects.toBeInstanceOf(APIError);
		await expect(before({ name: "x".repeat(49) })).rejects.toBeInstanceOf(APIError);
		await expect(before({ name: "Goku", image: "http://cdn.test/a.png" })).rejects.toBeInstanceOf(
			APIError
		);
		await expect(before({ name: "Goku", image: "pas une url" })).rejects.toBeInstanceOf(APIError);
		expect(await before({ name: "  Vegeta  ", image: "https://cdn.test/a.png" })).toEqual({
			data: { name: "Vegeta", image: "https://cdn.test/a.png" },
		});
		await options.databaseHooks.user.update.after({ id: "ba-3" });
		expect(invalidated).toEqual(["ba-3"]);
	});
});
