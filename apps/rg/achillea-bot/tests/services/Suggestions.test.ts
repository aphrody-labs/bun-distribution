/**
 * Tests Suggestions — Postgres fuzzy search SQL integration validation
 *
 * Run: bun test tests/services/Suggestions.test.ts
 */

import "reflect-metadata";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { describeLive, hasLiveDb } from "../fixtures/live-db";

const DB_URL = process.env.TEST_DB_URL ?? "";

let sql: Awaited<ReturnType<typeof import("bun").default.SQL>>;

describeLive("Suggestions (PostgreSQL fuzzy search integration)", () => {
	const testUserIds = ["999999999999999991", "999999999999999992", "999999999999999993"];
	let testClanIds: number[] = [];
	let testBlacklistId: number | null = null;

	beforeAll(async () => {
		if (!hasLiveDb) return;

		const BunModule = await import("bun");
		sql = BunModule.SQL(DB_URL);

		// Ensure pg_trgm extension is active on postgres dev database
		await sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`;

		// Clear previous leftovers
		await sql`DELETE FROM "user" WHERE id IN (${testUserIds[0]}, ${testUserIds[1]}, ${testUserIds[2]})`;
		await sql`DELETE FROM "clan" WHERE name IN ('Antigravity Team', 'Rose Griffon')`;
		await sql`DELETE FROM "blacklist" WHERE reason = 'test suggestions hacker'`;

		// Insert test clans
		const clans = await sql<{ id: number }[]>`
			INSERT INTO "clan" (
				name, shortened_name, normalized_short_name, normalized_name, founders, role_id,
				clan_avatar_url, clan_biography, state, channel_id, clan_emoji_id, languages,
				origin, is_hidden, is_disbanded, auto_accept_members, clan_fame, is_recruiting,
				is_inactive, under_member_limit, created_at, updated_at
			)
			VALUES
				(
					'Antigravity Team', 'AG', 'ag', 'ANTIGRAVITY TEAM', ARRAY['999999999999999991'], '999999999999999901',
					'http://avatar1', 'bio1', 1, '999999999999999911', '999999999999999921', ARRAY['fr'],
					'fr', false, false, false, 0, true, false, false, NOW(), NOW()
				),
				(
					'Rose Griffon', 'RG', 'rg', 'ROSE GRIFFON', ARRAY['999999999999999991'], '999999999999999902',
					'http://avatar2', 'bio2', 1, '999999999999999912', '999999999999999922', ARRAY['fr'],
					'fr', false, false, false, 0, true, false, false, NOW(), NOW()
				)
			RETURNING id
		`;
		testClanIds = clans.map((c) => c.id);

		// Insert test blacklist
		const [blacklist] = await sql<{ id: number }[]>`
			INSERT INTO "blacklist" (reason, created_at, updated_at)
			VALUES ('test suggestions hacker', NOW(), NOW())
			RETURNING id
		`;
		testBlacklistId = blacklist.id;

		// Insert test users
		await sql`
			INSERT INTO "user" (id, display_name, normalized_display_name, username, role, last_interact, created_at, updated_at, blacklist_id)
			VALUES
				(${testUserIds[0]}, 'Achillea Tester', 'achillea tester', 'achillea_dev_test_user_1', 0, NOW(), NOW(), NOW(), NULL),
				(${testUserIds[1]}, 'Antigravity Coder', 'antigravity coder', 'achillea_dev_test_user_2', 0, NOW(), NOW(), NOW(), NULL),
				(${testUserIds[2]}, 'Blacklisted Hacker', 'blacklisted hacker', 'achillea_dev_test_user_3', 0, NOW(), NOW(), NOW(), ${testBlacklistId})
		`;
	});

	afterAll(async () => {
		if (sql) {
			await sql`DELETE FROM "user" WHERE id IN (${testUserIds[0]}, ${testUserIds[1]}, ${testUserIds[2]})`;
			if (testBlacklistId !== null) {
				await sql`DELETE FROM "blacklist" WHERE id = ${testBlacklistId}`;
			}
			if (testClanIds.length > 0) {
				await sql`DELETE FROM "clan" WHERE id IN (${testClanIds[0]}, ${testClanIds[1]})`;
			}
			await sql.end();
		}
	});

	test("PgSQL similarity operator (%) and function match clans fuzzily", async () => {
		const term = "antigravit"; // fuzzy search term

		// Query mirroring Suggestions.searchClans() SQL translation
		const results = await sql<{ label: string; sim: number }[]>`
			SELECT name AS label,
				GREATEST(
					similarity(name, ${term}),
					similarity(shortened_name, ${term}),
					similarity(normalized_short_name, ${term})
				) AS sim
			FROM clan
			WHERE (name % ${term} OR shortened_name % ${term} OR normalized_short_name % ${term})
			ORDER BY sim DESC
			LIMIT 5
		`;

		expect(results.length).toBeGreaterThanOrEqual(1);
		expect(results[0].label).toBe("Antigravity Team");
		expect(results[0].sim).toBeGreaterThan(0.3); // High similarity score
	});

	test("PgSQL similarity matches clans by initials / shortened name", async () => {
		const term = "ag";

		const results = await sql<{ label: string; sim: number }[]>`
			SELECT name AS label,
				GREATEST(
					similarity(name, ${term}),
					similarity(shortened_name, ${term}),
					similarity(normalized_short_name, ${term})
				) AS sim
			FROM clan
			WHERE (name % ${term} OR shortened_name % ${term} OR normalized_short_name % ${term})
			ORDER BY sim DESC
			LIMIT 5
		`;

		expect(results.length).toBeGreaterThanOrEqual(1);
		expect(results[0].label).toBe("Antigravity Team");
	});

	test("PgSQL user_view query matches players fuzzily and respects blacklist filter", async () => {
		const term = "achillea";

		// Query mirroring Suggestions.searchPlayers() SQL query
		const results = await sql<{ displayName: string; sim: number }[]>`
			SELECT
				"displayName",
				GREATEST(
					similarity(username, ${term}),
					similarity("displayName", ${term}),
					similarity("normalizedDisplayName", ${term})
				) AS sim
			FROM user_view
			WHERE
				(username % ${term} OR "displayName" % ${term} OR "normalizedDisplayName" % ${term})
				AND NOT "isBlacklisted"
			ORDER BY sim DESC
			LIMIT 5
		`;

		expect(results.length).toBeGreaterThanOrEqual(1);
		expect(results.some((r) => r.displayName === "Achillea Tester")).toBe(true);
	});

	test("PgSQL user_view excludes blacklisted users", async () => {
		const term = "hacker";

		const results = await sql<{ displayName: string; sim: number }[]>`
			SELECT
				"displayName"
			FROM user_view
			WHERE
				(username % ${term} OR "displayName" % ${term} OR "normalizedDisplayName" % ${term})
				AND NOT "isBlacklisted"
		`;

		const containsBlacklisted = results.some((r) => r.displayName === "Blacklisted Hacker");
		expect(containsBlacklisted).toBe(false);
	});
});
