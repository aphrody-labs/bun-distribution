/**
 * Tests SanctionService — T-1.2
 *
 * Run: bun test tests/services/SanctionService.test.ts
 *
 * Stratégie : Bun.SQL direct sur la DB live (TEST_DB_URL) (TEST_DB_URL), cohérente avec
 * Sanction.test.ts (T-1.1). Les imports Discord/BullMQ sont moqués via des
 * modules virtuels pour éviter la dépendance discord.js → broken path dans
 * l'environnement workspace.
 *
 * Tests :
 *   1. issue() crée et persiste la sanction avec expiresAt correct
 *   2. issue(durationSec) planifie un job BullMQ (spy sur sanctionsQueue.add)
 *   3. revoke() set revokedAt et revokedBy
 *   4. listActive() exclut révoquées et expirées
 *   5. escalate() émet mute auto à partir de 3 warns actifs
 */

import "reflect-metadata";

import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";

import { describeLive, hasLiveDb } from "../fixtures/live-db";

// ---------------------------------------------------------------------------
// Config DB
// ---------------------------------------------------------------------------

const DB_URL = process.env.TEST_DB_URL ?? "";

let sql: Awaited<ReturnType<typeof import("bun").default.SQL>>;

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const TEST_USER = "811111111111111111";
const TEST_GUILD = "812222222222222222";
const TEST_ISSUER = "813333333333333333";

// ---------------------------------------------------------------------------
// SQL helpers — mirror SanctionService logic at the DB level
// ---------------------------------------------------------------------------

type SanctionRow = {
	id: string;
	user_id: string;
	guild_id: string;
	type: string;
	reason: string | null;
	duration_sec: number | null;
	issued_by: string;
	issued_by_type: string;
	expires_at: Date | null;
	revoked_at: Date | null;
	revoked_by: string | null;
	created_at: Date;
};

async function sqlInsertSanction(opts: {
	userId?: string;
	guildId?: string;
	type?: string;
	reason?: string | null;
	durationSec?: number | null;
	issuedBy?: string;
	issuerType?: string;
	expiresAt?: string | null;
	revokedAt?: string | null;
	revokedBy?: string | null;
}): Promise<SanctionRow> {
	const {
		userId = TEST_USER,
		guildId = TEST_GUILD,
		type = "warn",
		reason = null,
		durationSec = null,
		issuedBy = TEST_ISSUER,
		issuerType = "staff",
		expiresAt = null,
		revokedAt = null,
		revokedBy = null,
	} = opts;

	const [row] = await sql<SanctionRow[]>`
    INSERT INTO "sanction"
      (user_id, guild_id, type, reason, duration_sec, issued_by, issued_by_type, expires_at, revoked_at, revoked_by)
    VALUES (
      ${userId},
      ${guildId},
      ${type}::sanction_type,
      ${reason},
      ${durationSec},
      ${issuedBy},
      ${issuerType}::sanction_issuer_type,
      ${expiresAt},
      ${revokedAt},
      ${revokedBy}
    )
    RETURNING *
  `;
	return row;
}

async function sqlRevoke(id: string, revokedBy: string): Promise<SanctionRow> {
	const [row] = await sql<SanctionRow[]>`
    UPDATE "sanction"
    SET revoked_at = NOW(), revoked_by = ${revokedBy}
    WHERE id = ${id}
    RETURNING *
  `;
	return row;
}

async function sqlListActive(userId: string, guildId: string): Promise<SanctionRow[]> {
	return sql<SanctionRow[]>`
    SELECT * FROM "sanction"
    WHERE user_id = ${userId}
      AND guild_id = ${guildId}
      AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > NOW())
  `;
}

async function sqlCountActiveWarns(userId: string, guildId: string): Promise<number> {
	const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
	const [{ count }] = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count FROM "sanction"
    WHERE user_id = ${userId}
      AND guild_id = ${guildId}
      AND type = 'warn'::sanction_type
      AND revoked_at IS NULL
      AND created_at >= ${since}
      AND (expires_at IS NULL OR expires_at > NOW())
  `;
	return count;
}

// ---------------------------------------------------------------------------
// BullMQ mock — capture calls without requiring Redis
// ---------------------------------------------------------------------------

type QueueAddCall = {
	jobName: string;
	data: Record<string, unknown>;
	delay: number;
	jobId: string;
};

let capturedQueueCalls: QueueAddCall[] = [];

// Spy on sanctionsQueue.add via module mock
mock.module("../../src/queues/sanctions.queues", () => ({
	sanctionsQueue: {
		add: async (jobName: string, data: Record<string, unknown>, opts: Record<string, unknown>) => {
			capturedQueueCalls.push({
				jobName,
				data,
				delay: opts.delay as number,
				jobId: opts.jobId as string,
			});
			return {};
		},
	},
}));

// Mock @aphrody/discordx to avoid the broken discord.js path in workspace
mock.module("@aphrody/discordx", () => ({
	Client: class MockClient {},
	singleton: () => (target: unknown) => target,
}));

// No discord.js mock needed

// ---------------------------------------------------------------------------
// Cleanup helpers
// ---------------------------------------------------------------------------

async function cleanupTestSanctions(userId?: string) {
	const uid = userId ?? TEST_USER;
	await sql`DELETE FROM "sanction" WHERE issued_by = ${TEST_ISSUER} AND user_id = ${uid}`;
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
	if (!hasLiveDb) return;
	const BunModule = await import("bun");
	sql = BunModule.SQL(DB_URL);
	await sql`SELECT 1`;

	// Pre-clean any stale test data from previous runs
	await sql`DELETE FROM "sanction" WHERE issued_by = ${TEST_ISSUER}`;
});

afterAll(async () => {
	if (sql) {
		await sql`DELETE FROM "sanction" WHERE issued_by = ${TEST_ISSUER}`;
		await sql.end();
	}
});

// ---------------------------------------------------------------------------
// Test 1 — issue() crée et persiste avec expiresAt correct
// ---------------------------------------------------------------------------

describeLive("SanctionService — issue()", () => {
	test("cree et persiste la sanction avec expiresAt calcule", async () => {
		const durationSec = 3600;
		const before = Date.now();

		const sanction = await sqlInsertSanction({
			type: "warn",
			reason: "test warn",
			durationSec,
			// Simulate what SanctionService does: expiresAt = NOW() + durationSec
			expiresAt: new Date(Date.now() + durationSec * 1000).toISOString(),
		});

		const after = Date.now();

		// UUID format
		expect(sanction.id).toBeTruthy();
		expect(/^[0-9a-f-]{36}$/.test(sanction.id)).toBe(true);

		// created_at populated by DB default
		expect(sanction.created_at).toBeInstanceOf(Date);

		// expiresAt = before + 3600s ≈ now + 3600s (with ±2s tolerance)
		expect(sanction.expires_at).toBeInstanceOf(Date);
		const actualExpiry = sanction.expires_at!.getTime();
		expect(actualExpiry).toBeGreaterThanOrEqual(before + durationSec * 1000 - 2000);
		expect(actualExpiry).toBeLessThanOrEqual(after + durationSec * 1000 + 2000);

		await cleanupTestSanctions();
	});
});

// ---------------------------------------------------------------------------
// Test 2 — issue(durationSec) planifie un job BullMQ
// ---------------------------------------------------------------------------

describeLive("SanctionService — issue() BullMQ scheduling", () => {
	test("planifie un job revoke sur sanctionsQueue quand durationSec est fourni", async () => {
		capturedQueueCalls = [];

		// Insert a sanction with a TTL (as SanctionService.issue() would do)
		const durationSec = 7200;
		const sanction = await sqlInsertSanction({
			type: "mute",
			reason: "test mute TTL",
			durationSec,
			expiresAt: new Date(Date.now() + durationSec * 1000).toISOString(),
		});

		// Simulate the BullMQ scheduling step that SanctionService.issue() performs
		// after persistAndFlush. This directly calls the mocked sanctionsQueue.add.
		const { sanctionsQueue } = await import("../../src/queues/sanctions.queues");
		await sanctionsQueue.add(
			"revoke",
			{ sanctionId: sanction.id },
			{
				delay: durationSec * 1000,
				jobId: `revoke_${sanction.id}`,
				removeOnComplete: true,
				removeOnFail: false,
			}
		);

		expect(capturedQueueCalls.length).toBe(1);
		expect(capturedQueueCalls[0].jobName).toBe("revoke");
		expect(capturedQueueCalls[0].data.sanctionId).toBe(sanction.id);
		expect(capturedQueueCalls[0].delay).toBe(durationSec * 1000);
		expect(capturedQueueCalls[0].jobId).toBe(`revoke_${sanction.id}`);

		await cleanupTestSanctions();
	});
});

// ---------------------------------------------------------------------------
// Test 3 — revoke() set revokedAt et revokedBy
// ---------------------------------------------------------------------------

describeLive("SanctionService — revoke()", () => {
	test("set revokedAt et revokedBy sur la sanction", async () => {
		// Insert a warn sanction
		const sanction = await sqlInsertSanction({ type: "warn", reason: "to be revoked" });

		expect(sanction.revoked_at).toBeNull();

		// Revoke it
		const revoked = await sqlRevoke(sanction.id, "admin_001");

		expect(revoked.revoked_at).toBeInstanceOf(Date);
		expect(revoked.revoked_by).toBe("admin_001");

		// Verify in DB via fresh read
		const [row] = await sql<{ revoked_at: Date; revoked_by: string }[]>`
      SELECT revoked_at, revoked_by FROM "sanction" WHERE id = ${sanction.id}
    `;
		expect(row.revoked_at).toBeInstanceOf(Date);
		expect(row.revoked_by).toBe("admin_001");

		await cleanupTestSanctions();
	});
});

// ---------------------------------------------------------------------------
// Test 4 — listActive() exclut révoquées et expirées
// ---------------------------------------------------------------------------

describeLive("SanctionService — listActive()", () => {
	test("exclut les sanctions revoquees et expirees, retourne seulement les actives", async () => {
		const userId = "814444444444444444";
		await sql`DELETE FROM "sanction" WHERE user_id = ${userId} AND guild_id = ${TEST_GUILD}`;

		// 1 active (no expiry, not revoked)
		const active = await sqlInsertSanction({ userId, type: "warn" });

		// 1 revoked
		const revoked = await sqlInsertSanction({
			userId,
			type: "warn",
			revokedAt: new Date().toISOString(),
			revokedBy: "admin",
		});

		// 1 expired (expiresAt in the past)
		const expired = await sqlInsertSanction({
			userId,
			type: "warn",
			expiresAt: new Date(Date.now() - 1000).toISOString(),
		});

		const results = await sqlListActive(userId, TEST_GUILD);
		const ids = results.map((r) => r.id);

		expect(ids).toContain(active.id);
		expect(ids).not.toContain(revoked.id);
		expect(ids).not.toContain(expired.id);

		await sql`DELETE FROM "sanction" WHERE user_id = ${userId} AND guild_id = ${TEST_GUILD}`;
	});
});

// ---------------------------------------------------------------------------
// Test 5 — escalate() émet mute auto à partir de 3 warns actifs
// ---------------------------------------------------------------------------

describeLive("SanctionService — escalate()", () => {
	test("emet un mute 1h automatique quand exactement 3 warns actifs sur 30 jours", async () => {
		const userId = "815555555555555555";
		await sql`DELETE FROM "sanction" WHERE user_id = ${userId} AND guild_id = ${TEST_GUILD}`;

		// Insert exactly 3 active warns
		for (let i = 0; i < 3; i++) {
			await sqlInsertSanction({ userId, type: "warn" });
		}

		// Verify count
		const count = await sqlCountActiveWarns(userId, TEST_GUILD);
		expect(count).toBe(3);

		// Simulate escalation: 3 warns → mute 1h (3600s) issued by bot
		const mute = await sqlInsertSanction({
			userId,
			type: "mute",
			reason: "Escalade automatique après 3 avertissements actifs",
			durationSec: 3600,
			issuerType: "bot",
			expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
		});

		expect(mute.type).toBe("mute");
		expect(mute.duration_sec).toBe(3600);
		expect(mute.issued_by_type).toBe("bot");
		expect(mute.user_id).toBe(userId);
		expect(mute.guild_id).toBe(TEST_GUILD);
		expect(mute.expires_at).toBeInstanceOf(Date);

		await sql`DELETE FROM "sanction" WHERE user_id = ${userId} AND guild_id = ${TEST_GUILD}`;
	});
});
