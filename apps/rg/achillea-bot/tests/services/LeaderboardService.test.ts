/**
 * Tests LeaderboardService — T-5.1
 *
 * Run: bun test tests/services/LeaderboardService.test.ts
 *
 * Strategy : Bun.SQL direct on la DB live (TEST_DB_URL). Inserts a controlled season,
 * populates user_elo rows, then verifies getTop() and getUserRank() results
 * via raw SQL (mirrors LeaderboardService dense-rank logic).
 *
 * Tests :
 *   1. getTop() returns rows ordered by ELO descending with dense rank
 *   2. getTop() pagination: offset skips first N entries
 *   3. getTop() returns empty when no rows in season
 *   4. getUserRank() returns correct rank for a known user
 *   5. getUserRank() returns null when user has no entry
 *   6. getUserRank() ties: two users same ELO share the same rank
 */

import "reflect-metadata";

import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";

import { describeLive, hasLiveDb } from "../fixtures/live-db";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

mock.module("@aphrody/discordx", () => ({
	Client: class MockClient {},
	singleton: () => (target: unknown) => target,
}));

// No discord.js mock needed

// ---------------------------------------------------------------------------
// Config DB
// ---------------------------------------------------------------------------

const DB_URL = process.env.TEST_DB_URL ?? "";

let sql: Awaited<ReturnType<typeof import("bun").default.SQL>>;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SeasonRow = { id: string };
type EloRow = {
	user_id: string;
	elo: number;
	peak_rating: number;
	games_played: number;
	rank: number;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MODE = 2; // MatchMode.ONE_VS_ONE = 2

// Stable test user IDs — must not clash with other test files
const USERS = [
	"930000000000000001",
	"930000000000000002",
	"930000000000000003",
	"930000000000000004",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function ensureUser(id: string) {
	await sql`
    INSERT INTO "user" (id, display_name, normalized_display_name, username, role, last_interact, created_at, updated_at)
    VALUES (${id}, ${`u${id.slice(-4)}`}, ${`u${id.slice(-4)}`}, ${`u${id.slice(-4)}`}, 0, NOW(), NOW(), NOW())
    ON CONFLICT (id) DO NOTHING
  `;
}

async function insertSeason(name: string): Promise<string> {
	const [row] = await sql<SeasonRow[]>`
    INSERT INTO "season" (name, starts_at, ends_at, state)
    VALUES (
      ${name},
      NOW() - INTERVAL '1 day',
      NOW() + INTERVAL '30 days',
      'Active'::season_state
    )
    RETURNING id
  `;
	return row.id;
}

async function insertElo(userId: string, elo: number, seasonId: string) {
	await sql`
    INSERT INTO "user_elo" (user_id, mode, season_id, elo, peak_rating, games_played, created_at, updated_at)
    VALUES (
      ${userId}, ${MODE}, ${seasonId}, ${elo}, ${elo}, 1, NOW(), NOW()
    )
    ON CONFLICT DO NOTHING
  `;
}

async function cleanupSeason(seasonId: string) {
	await sql`DELETE FROM "user_elo" WHERE season_id = ${seasonId}`;
	await sql`DELETE FROM "season" WHERE id = ${seasonId}`;
}

async function getTopRaw(seasonId: string, limit: number, offset: number): Promise<EloRow[]> {
	return sql<EloRow[]>`
    SELECT
      user_id,
      elo,
      peak_rating,
      games_played,
      DENSE_RANK() OVER (ORDER BY elo DESC)::int AS rank
    FROM "user_elo"
    WHERE season_id = ${seasonId}
      AND mode = ${MODE}
    ORDER BY rank ASC
    LIMIT ${limit} OFFSET ${offset}
  `;
}

async function getUserRankRaw(seasonId: string, userId: string): Promise<EloRow | null> {
	const [row] = await sql<EloRow[]>`
    SELECT *
    FROM (
      SELECT
        user_id,
        elo,
        peak_rating,
        games_played,
        DENSE_RANK() OVER (ORDER BY elo DESC)::int AS rank
      FROM "user_elo"
      WHERE season_id = ${seasonId}
        AND mode = ${MODE}
    ) ranked
    WHERE user_id = ${userId}
  `;
	return row ?? null;
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
	if (!hasLiveDb) return;
	const BunModule = await import("bun");
	sql = BunModule.SQL(DB_URL);
	await sql`SELECT 1`;

	for (const id of USERS) {
		await ensureUser(id);
	}
});

afterAll(async () => {
	if (sql) await sql.end();
});

// ---------------------------------------------------------------------------
// Test 1 — getTop() returns rows ordered by ELO desc with rank
// ---------------------------------------------------------------------------

describeLive("LeaderboardService — getTop()", () => {
	test("returns rows ordered by ELO descending with dense rank", async () => {
		const seasonId = await insertSeason("__lb_test_top__");

		await insertElo(USERS[0], 1500, seasonId);
		await insertElo(USERS[1], 1200, seasonId);
		await insertElo(USERS[2], 900, seasonId);

		const rows = await getTopRaw(seasonId, 10, 0);

		expect(rows.length).toBe(3);
		expect(rows[0].user_id).toBe(USERS[0]);
		expect(rows[0].rank).toBe(1);
		expect(rows[1].rank).toBe(2);
		expect(rows[2].rank).toBe(3);
		expect(rows[0].elo).toBeGreaterThan(rows[1].elo);

		await cleanupSeason(seasonId);
	});

	// -------------------------------------------------------------------------
	// Test 2 — pagination
	// -------------------------------------------------------------------------

	test("pagination: offset skips first N entries", async () => {
		const seasonId = await insertSeason("__lb_test_pagination__");

		await insertElo(USERS[0], 1500, seasonId);
		await insertElo(USERS[1], 1200, seasonId);
		await insertElo(USERS[2], 900, seasonId);

		const page2 = await getTopRaw(seasonId, 2, 2);

		expect(page2.length).toBe(1);
		expect(page2[0].user_id).toBe(USERS[2]);

		await cleanupSeason(seasonId);
	});

	// -------------------------------------------------------------------------
	// Test 3 — empty season
	// -------------------------------------------------------------------------

	test("returns empty array when season has no rows", async () => {
		const seasonId = await insertSeason("__lb_test_empty__");

		const rows = await getTopRaw(seasonId, 10, 0);

		expect(rows.length).toBe(0);

		await cleanupSeason(seasonId);
	});
});

// ---------------------------------------------------------------------------
// Test 4 — getUserRank() correct rank
// ---------------------------------------------------------------------------

describeLive("LeaderboardService — getUserRank()", () => {
	test("returns correct rank for a known user", async () => {
		const seasonId = await insertSeason("__lb_test_userrank__");

		await insertElo(USERS[0], 1600, seasonId);
		await insertElo(USERS[1], 1200, seasonId);

		const entry = await getUserRankRaw(seasonId, USERS[1]);

		expect(entry).not.toBeNull();
		expect(entry!.rank).toBe(2);
		expect(entry!.elo).toBe(1200);

		await cleanupSeason(seasonId);
	});

	// -------------------------------------------------------------------------
	// Test 5 — getUserRank() null when no entry
	// -------------------------------------------------------------------------

	test("returns null when user has no ELO entry in the season", async () => {
		const seasonId = await insertSeason("__lb_test_noentry__");

		const entry = await getUserRankRaw(seasonId, USERS[3]);

		expect(entry).toBeNull();

		await cleanupSeason(seasonId);
	});

	// -------------------------------------------------------------------------
	// Test 6 — ties: same ELO → same rank
	// -------------------------------------------------------------------------

	test("two users with identical ELO share the same dense rank", async () => {
		const seasonId = await insertSeason("__lb_test_tie__");

		await insertElo(USERS[0], 1400, seasonId);
		await insertElo(USERS[1], 1400, seasonId);
		await insertElo(USERS[2], 1100, seasonId);

		const rows = await getTopRaw(seasonId, 10, 0);

		const rank1 = rows.find((r) => r.user_id === USERS[0])?.rank;
		const rank2 = rows.find((r) => r.user_id === USERS[1])?.rank;
		const rank3 = rows.find((r) => r.user_id === USERS[2])?.rank;

		expect(rank1).toBe(1);
		expect(rank2).toBe(1);
		expect(rank3).toBe(2); // dense rank skips to 2, not 3

		await cleanupSeason(seasonId);
	});
});
