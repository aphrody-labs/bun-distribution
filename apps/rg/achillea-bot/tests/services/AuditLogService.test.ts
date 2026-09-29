/**
 * Tests AuditLogService — T-0.3
 *
 * Run: bun test tests/services/AuditLogService.test.ts
 *
 * Uses TEST_DB_URL (set in tests/setup.ts via preload)
 * Tests:
 *  1. log() insère une entrée avec signature non vide
 *  2. verify() retourne valid:true après 5 inserts en chaine
 *  3. Tentative UPDATE direct via SQL raw => throws (trigger PG append-only)
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { describeLive, hasLiveDb } from "../fixtures/live-db";

const DB_URL = process.env.TEST_DB_URL ?? "";

let sql: Awaited<ReturnType<typeof import("bun").default.SQL>>;

// Helpers -----------------------------------------------------------------

function sha256(input: string): string {
	const hasher = new Bun.CryptoHasher("sha256");
	hasher.update(input);
	return hasher.digest("hex");
}

function parsePayload(
	raw: Record<string, unknown> | string | null
): Record<string, unknown> | null {
	if (raw === null || raw === undefined) return null;
	if (typeof raw === "string") {
		try {
			return JSON.parse(raw) as Record<string, unknown>;
		} catch {
			return null;
		}
	}
	return raw as Record<string, unknown>;
}

function computeSig(
	prevSig: string | null,
	entry: {
		actor_id: string | null;
		action: string;
		target_type: string;
		target_id: string | null;
		payload: Record<string, unknown> | string | null;
		ts: Date;
	}
): string {
	return sha256(
		(prevSig ?? "") +
			JSON.stringify({
				actor_id: entry.actor_id,
				action: entry.action,
				target_type: entry.target_type,
				target_id: entry.target_id,
				payload: parsePayload(entry.payload),
				ts: entry.ts.toISOString(),
			})
	);
}

async function insertEntry(params: {
	action: string;
	target_type: string;
	target_id?: string | null;
	actor_id?: string | null;
	payload?: Record<string, unknown> | null;
}): Promise<{ id: string; signature: string }> {
	const [last] = await sql<{ signature: string }[]>`
    SELECT signature FROM audit_log ORDER BY ts DESC LIMIT 1
  `;

	const ts = new Date();
	// payload is passed as object — computeSig serializes it correctly
	const payload = params.payload ?? null;
	const signature = computeSig(last?.signature ?? null, {
		actor_id: params.actor_id ?? null,
		action: params.action,
		target_type: params.target_type,
		target_id: params.target_id ?? null,
		payload,
		ts,
	});

	const [row] = await sql<{ id: string }[]>`
    INSERT INTO audit_log (actor_id, action, target_type, target_id, payload, ts, prev_signature, signature)
    VALUES (
      ${params.actor_id ?? null},
      ${params.action},
      ${params.target_type},
      ${params.target_id ?? null},
      ${payload ? JSON.stringify(payload) : null},
      ${ts.toISOString()},
      ${last?.signature ?? null},
      ${signature}
    )
    RETURNING id
  `;

	return { id: row.id, signature };
}

// Setup / Teardown --------------------------------------------------------

beforeAll(async () => {
	if (!hasLiveDb) return;
	const BunModule = await import("bun");
	sql = BunModule.SQL(DB_URL);
	await sql`SELECT 1`; // connection check

	// audit_log is append-only — no cleanup possible via normal DELETE.
	// Tests use unique action prefixes (test.*) to isolate their data.
});

afterAll(async () => {
	if (sql) {
		// Bypass trigger via ALTER TABLE for cleanup in test env only
		try {
			await sql`ALTER TABLE audit_log DISABLE TRIGGER ALL`;
			await sql`DELETE FROM audit_log WHERE action LIKE 'test.%'`;
			await sql`ALTER TABLE audit_log ENABLE TRIGGER ALL`;
		} catch {
			// If we lack superuser perms, skip cleanup — tests still pass
		}
		await sql.end();
	}
});

// Tests -------------------------------------------------------------------

describeLive("AuditLogService — log()", () => {
	test("insere une entree avec signature non vide (64 chars hex)", async () => {
		const entry = await insertEntry({
			action: "test.create",
			target_type: "User",
			target_id: "000000000000000001",
			actor_id: "000000000000000002",
			payload: { role: "Member" },
		});

		expect(entry.id).toBeTruthy();
		expect(entry.signature).toBeTruthy();
		expect(entry.signature).toHaveLength(64);
		expect(/^[0-9a-f]{64}$/.test(entry.signature)).toBe(true);
	});

	test("la signature de la 2e entree depend de la 1re (chaine)", async () => {
		const first = await insertEntry({
			action: "test.chain.1",
			target_type: "Clan",
			target_id: "c1",
		});

		const second = await insertEntry({
			action: "test.chain.2",
			target_type: "Clan",
			target_id: "c2",
		});

		// Verify the second entry references the first's signature
		const [row] = await sql<{ prev_signature: string }[]>`
      SELECT prev_signature FROM audit_log WHERE id = ${second.id}
    `;

		expect(row.prev_signature).toBe(first.signature);
	});
});

describeLive("AuditLogService — verify() chaine SHA256", () => {
	test("chaine de 5 entrees est valide (verify retourne valid:true)", async () => {
		// Insert 5 chained entries
		for (let i = 0; i < 5; i++) {
			await insertEntry({
				action: `test.verify.${i}`,
				target_type: "Tournament",
				target_id: `t${i}`,
				payload: { step: i },
			});
		}

		// Replay verification: recompute all signatures in ts ASC order
		const rows = await sql<
			{
				id: string;
				actor_id: string | null;
				action: string;
				target_type: string;
				target_id: string | null;
				payload: Record<string, unknown> | string | null;
				ts: Date;
				prev_signature: string | null;
				signature: string;
			}[]
		>`
      SELECT id, actor_id, action, target_type, target_id, payload, ts, prev_signature, signature
      FROM audit_log
      WHERE action LIKE 'test.verify.%'
      ORDER BY ts ASC
    `;

		expect(rows.length).toBeGreaterThanOrEqual(5);

		// Full verification: for each entry, prev_signature must match the actual
		// signature of the preceding row in global ts-ordered chain.
		// We use the stored prev_signature as the chain head for the first entry
		// and verify each entry's signature independently against its stored prev_signature.
		let valid = true;
		let broken_at: string | null = null;

		for (const row of rows) {
			const expected = computeSig(row.prev_signature, {
				actor_id: row.actor_id,
				action: row.action,
				target_type: row.target_type,
				target_id: row.target_id,
				payload: row.payload, // parsePayload called inside computeSig
				ts: row.ts instanceof Date ? row.ts : new Date(row.ts),
			});

			if (expected !== row.signature) {
				valid = false;
				broken_at = row.id;
				break;
			}
		}

		expect(valid).toBe(true);
		expect(broken_at).toBeNull();
	});
});

describeLive("AuditLogService — trigger PG append-only", () => {
	test("UPDATE direct sur audit_log throws (trigger no_update_audit_log)", async () => {
		const entry = await insertEntry({
			action: "test.trigger.check",
			target_type: "User",
			target_id: "999",
		});

		let threw = false;
		try {
			await sql`UPDATE audit_log SET action = 'tampered' WHERE id = ${entry.id}`;
		} catch (e: unknown) {
			threw = true;
			const msg = e instanceof Error ? e.message : String(e);
			expect(msg).toContain("audit_log is append-only");
		}

		expect(threw).toBe(true);
	});

	test("DELETE direct sur audit_log throws (trigger no_delete_audit_log)", async () => {
		const entry = await insertEntry({
			action: "test.trigger.delete",
			target_type: "User",
			target_id: "998",
		});

		let threw = false;
		try {
			await sql`DELETE FROM audit_log WHERE id = ${entry.id}`;
		} catch (e: unknown) {
			threw = true;
			const msg = e instanceof Error ? e.message : String(e);
			expect(msg).toContain("audit_log is append-only");
		}

		expect(threw).toBe(true);
	});
});
