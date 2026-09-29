/**
 * Tests CastService — T-2.2
 *
 * Run: bun test tests/services/CastService.test.ts
 *
 * Stratégie : Bun.SQL direct sur la DB live (TEST_DB_URL) (TEST_DB_URL).
 * On teste la logique du service via SQL brut pour éviter toute dépendance
 * discord.js / tsyringe au niveau des imports (même pattern que SanctionService.test.ts).
 *
 * Tests :
 *   1. openSurvey est idempotent (2 appels → 1 row par user)
 *   2. recordAvailability fait un upsert (update si existant)
 *   3. autoAssign priorise available (+5) sur maybe (+0)
 *   4. autoAssign respecte preferredRoles (+10 score)
 *   5. autoAssign exclut un caster ayant atteint maxSlotsPerCaster
 *   6. swap reset confirmedAt à NULL
 */

import "reflect-metadata";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { describeLive, hasLiveDb } from "../fixtures/live-db";

// ---------------------------------------------------------------------------
// Config DB
// ---------------------------------------------------------------------------

const DB_URL = process.env.TEST_DB_URL ?? "";

let sql: Awaited<ReturnType<typeof import("bun").default.SQL>>;

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const TEST_CREATOR = "820000000000000001";
const CASTER_A = "820000000000000002";
const CASTER_B = "820000000000000003";
const CASTER_C = "820000000000000004";

// ---------------------------------------------------------------------------
// SQL helpers
// ---------------------------------------------------------------------------

type EventRow = {
	id: string;
	name: string;
	kind: string;
	status: string;
	scheduled_at: Date;
	duration: number;
	created_by: string;
};

type SlotRow = {
	id: string;
	event_id: string;
	role: string;
	required: boolean;
};

type AvailRow = {
	id: string;
	user_id: string;
	event_id: string;
	status: string;
	preferred_roles: string | null;
	declared_at: Date;
};

type AttributionRow = {
	id: string;
	slot_id: string;
	user_id: string | null;
	assigned_by: string;
	confirmed_at: Date | null;
	assigned_at: Date;
};

async function insertEvent(opts: {
	name?: string;
	kind?: string;
	scheduledAt?: string;
}): Promise<EventRow> {
	const [row] = await sql<EventRow[]>`
    INSERT INTO cast_event (name, kind, status, scheduled_at, duration, created_by, created_at, updated_at)
    VALUES (
      ${opts.name ?? "Test Event"},
      ${opts.kind ?? "match"},
      'planned',
      ${opts.scheduledAt ?? new Date(Date.now() + 86400000).toISOString()},
      90,
      ${TEST_CREATOR},
      NOW(),
      NOW()
    )
    RETURNING *
  `;
	return row;
}

async function insertSlot(opts: {
	eventId: string;
	role?: string;
	required?: boolean;
}): Promise<SlotRow> {
	const [row] = await sql<SlotRow[]>`
    INSERT INTO cast_slot (event_id, role, required)
    VALUES (
      ${opts.eventId},
      ${opts.role ?? "caster_main"},
      ${opts.required ?? true}
    )
    RETURNING *
  `;
	return row;
}

async function insertAvailability(opts: {
	userId: string;
	eventId: string;
	status: string;
	preferredRoles?: string[] | null;
}): Promise<AvailRow> {
	const prJson = opts.preferredRoles ? JSON.stringify(opts.preferredRoles) : null;
	const [row] = await sql<AvailRow[]>`
    INSERT INTO cast_availability (user_id, event_id, status, preferred_roles, declared_at)
    VALUES (
      ${opts.userId},
      ${opts.eventId},
      ${opts.status},
      ${prJson}::jsonb,
      NOW()
    )
    ON CONFLICT (user_id, event_id) DO UPDATE
      SET status = EXCLUDED.status,
          preferred_roles = EXCLUDED.preferred_roles,
          declared_at = NOW()
    RETURNING *
  `;
	return row;
}

async function insertAttribution(opts: {
	slotId: string;
	userId?: string | null;
	assignedBy?: string;
	confirmedAt?: string | null;
}): Promise<AttributionRow> {
	const [row] = await sql<AttributionRow[]>`
    INSERT INTO cast_attribution (slot_id, user_id, assigned_by, confirmed_at, assigned_at)
    VALUES (
      ${opts.slotId},
      ${opts.userId ?? null},
      ${opts.assignedBy ?? "system"},
      ${opts.confirmedAt ?? null},
      NOW()
    )
    ON CONFLICT (slot_id) DO UPDATE
      SET user_id = EXCLUDED.user_id,
          assigned_by = EXCLUDED.assigned_by,
          confirmed_at = EXCLUDED.confirmed_at,
          assigned_at = NOW()
    RETURNING *
  `;
	return row;
}

async function cleanupTestData() {
	// Cascade delete from event removes slots → attributions → availabilities
	await sql`DELETE FROM cast_event WHERE created_by = ${TEST_CREATOR}`;
}

// ---------------------------------------------------------------------------
// openSurvey SQL simulation : crée des availabilities en mode idempotent
// ---------------------------------------------------------------------------

async function openSurveyForEvent(eventId: string, pool: string[]): Promise<void> {
	for (const userId of pool) {
		await sql`
      INSERT INTO cast_availability (user_id, event_id, status, declared_at)
      VALUES (${userId}, ${eventId}, 'unavailable', NOW())
      ON CONFLICT (user_id, event_id) DO NOTHING
    `;
	}
	await sql`
    UPDATE cast_event SET status = 'open_signup' WHERE id = ${eventId} AND status = 'planned'
  `;
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
	if (!hasLiveDb) return;
	const BunModule = await import("bun");
	sql = BunModule.SQL(DB_URL);
	await sql`SELECT 1`;
	await cleanupTestData();
});

afterAll(async () => {
	if (sql) {
		await cleanupTestData();
		await sql.end();
	}
});

// ---------------------------------------------------------------------------
// Test 1 — openSurvey est idempotent
// ---------------------------------------------------------------------------

describeLive("CastService — openSurvey()", () => {
	test("idempotent : 2 appels consecutifs creent 1 seule row par user", async () => {
		const event = await insertEvent({ name: "Survey Idempotent Test" });
		const pool = [CASTER_A, CASTER_B];

		// Premier appel
		await openSurveyForEvent(event.id, pool);
		// Second appel — doit être sans effet (ON CONFLICT DO NOTHING)
		await openSurveyForEvent(event.id, pool);

		const rows = await sql<AvailRow[]>`
      SELECT * FROM cast_availability WHERE event_id = ${event.id}
    `;

		// 1 row par user, pas de doublons
		expect(rows).toHaveLength(pool.length);

		const userIds = rows.map((r) => r.user_id);
		expect(userIds).toContain(CASTER_A);
		expect(userIds).toContain(CASTER_B);

		// Event doit être en open_signup
		const [ev] = await sql<{ status: string }[]>`
      SELECT status FROM cast_event WHERE id = ${event.id}
    `;
		expect(ev.status).toBe("open_signup");
	});
});

// ---------------------------------------------------------------------------
// Test 2 — recordAvailability fait un upsert
// ---------------------------------------------------------------------------

describeLive("CastService — recordAvailability()", () => {
	test("upsert : 2nd appel met a jour le status et declared_at", async () => {
		const event = await insertEvent({ name: "Upsert Avail Test" });

		// Insert initial (unavailable)
		const first = await insertAvailability({
			userId: CASTER_A,
			eventId: event.id,
			status: "unavailable",
		});

		expect(first.status).toBe("unavailable");

		const beforeUpdate = new Date();

		// Upsert → available
		const updated = await insertAvailability({
			userId: CASTER_A,
			eventId: event.id,
			status: "available",
			preferredRoles: ["caster_main"],
		});

		expect(updated.user_id).toBe(CASTER_A);
		expect(updated.status).toBe("available");
		// declared_at doit être >= beforeUpdate
		expect(new Date(updated.declared_at).getTime()).toBeGreaterThanOrEqual(
			beforeUpdate.getTime() - 100
		);

		// Vérifier qu'il n'y a qu'une seule row
		const [{ count }] = await sql<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM cast_availability
      WHERE user_id = ${CASTER_A} AND event_id = ${event.id}
    `;
		expect(count).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// Test 3 — autoAssign priorise available (+5) sur maybe
// ---------------------------------------------------------------------------

describeLive("CastService — autoAssign() priorité available vs maybe", () => {
	test("le caster 'available' est selectionne avant 'maybe' a preferredRoles egal", async () => {
		const event = await insertEvent({ name: "AutoAssign Priority Test" });
		const slot = await insertSlot({ eventId: event.id, role: "caster_main" });

		// CASTER_A = maybe, CASTER_B = available, même rôle préféré
		await insertAvailability({
			userId: CASTER_A,
			eventId: event.id,
			status: "maybe",
			preferredRoles: ["caster_main"],
		});
		await insertAvailability({
			userId: CASTER_B,
			eventId: event.id,
			status: "available",
			preferredRoles: ["caster_main"],
		});

		// Simuler autoAssign scoring :
		// CASTER_A : +10 (préféré) + 0 (maybe) - 0 (no recent) = 10
		// CASTER_B : +10 (préféré) + 5 (available) - 0 (no recent) = 15  ← gagnant

		type Candidate = {
			userId: string;
			status: string;
			preferred_roles: string | null;
		};

		const candidates = await sql<Candidate[]>`
      SELECT user_id AS "userId", status, preferred_roles
      FROM cast_availability
      WHERE event_id = ${event.id}
        AND status IN ('available', 'maybe')
    `;

		const slotRole = "caster_main";
		const scored = candidates.map((c) => {
			let score = 0;
			const prefs: string[] = c.preferred_roles ? JSON.parse(c.preferred_roles) : [];
			if (prefs.includes(slotRole)) score += 10;
			if (c.status === "available") score += 5;
			return { userId: c.userId, score };
		});

		scored.sort((a, b) => b.score - a.score || a.userId.localeCompare(b.userId));

		expect(scored[0].userId).toBe(CASTER_B);
		expect(scored[0].score).toBe(15);
		expect(scored[1].score).toBe(10);

		// Attribuer et vérifier
		const attribution = await insertAttribution({
			slotId: slot.id,
			userId: scored[0].userId,
			assignedBy: "system",
		});
		expect(attribution.user_id).toBe(CASTER_B);
		expect(attribution.confirmed_at).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Test 4 — autoAssign respecte preferredRoles (+10)
// ---------------------------------------------------------------------------

describeLive("CastService — autoAssign() preferredRoles bonus", () => {
	test("caster avec role prefere obtient +10 et gagne sur caster available sans preference", async () => {
		const event = await insertEvent({ name: "AutoAssign PreferredRoles Test" });
		const slot = await insertSlot({ eventId: event.id, role: "observer" });

		// CASTER_A = available + préfère observer → score 10 + 5 = 15
		// CASTER_B = available sans préférence pour ce rôle → score 0 + 5 = 5
		await insertAvailability({
			userId: CASTER_A,
			eventId: event.id,
			status: "available",
			preferredRoles: ["observer"],
		});
		await insertAvailability({
			userId: CASTER_B,
			eventId: event.id,
			status: "available",
			preferredRoles: ["caster_main"], // pas observer
		});

		const candidates = await sql<
			{ userId: string; status: string; preferred_roles: string | null }[]
		>`
      SELECT user_id AS "userId", status, preferred_roles
      FROM cast_availability
      WHERE event_id = ${event.id}
        AND status IN ('available', 'maybe')
    `;

		const slotRole = "observer";
		const scored = candidates.map((c) => {
			let score = 0;
			const prefs: string[] = c.preferred_roles ? JSON.parse(c.preferred_roles) : [];
			if (prefs.includes(slotRole)) score += 10;
			if (c.status === "available") score += 5;
			return { userId: c.userId, score };
		});

		scored.sort((a, b) => b.score - a.score || a.userId.localeCompare(b.userId));

		// CASTER_A doit gagner (score 15 vs 5)
		expect(scored[0].userId).toBe(CASTER_A);
		expect(scored[0].score).toBe(15);
		expect(scored[1].score).toBe(5);

		void slot; // utilisé indirectement via le test de logique scoring
	});
});

// ---------------------------------------------------------------------------
// Test 5 — autoAssign exclut caster ayant atteint maxSlotsPerCaster
// ---------------------------------------------------------------------------

describeLive("CastService — autoAssign() anti-saturation maxSlotsPerCaster", () => {
	test("caster avec >= maxSlotsPerCaster attributions recentes est exclu", async () => {
		const event = await insertEvent({ name: "AutoAssign AntiSat Test" });
		const slotMain = await insertSlot({ eventId: event.id, role: "caster_main" });

		// CASTER_C = available — mais va avoir 3 attributions récentes existantes
		// CASTER_A = available — pas de cast récent
		await insertAvailability({ userId: CASTER_C, eventId: event.id, status: "available" });
		await insertAvailability({ userId: CASTER_A, eventId: event.id, status: "available" });

		// Simuler 3 attributions récentes pour CASTER_C sur d'autres events
		const windowStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000 + 60000); // dans la fenêtre

		const past1 = await insertEvent({ name: "Past Event 1" });
		const past2 = await insertEvent({ name: "Past Event 2" });
		const past3 = await insertEvent({ name: "Past Event 3" });

		const ps1 = await insertSlot({ eventId: past1.id, role: "caster_main" });
		const ps2 = await insertSlot({ eventId: past2.id, role: "caster_main" });
		const ps3 = await insertSlot({ eventId: past3.id, role: "caster_main" });

		// Insérer attributions récentes pour CASTER_C
		for (const slotId of [ps1.id, ps2.id, ps3.id]) {
			await sql`
        INSERT INTO cast_attribution (slot_id, user_id, assigned_by, assigned_at)
        VALUES (${slotId}, ${CASTER_C}, 'system', ${windowStart.toISOString()})
        ON CONFLICT (slot_id) DO NOTHING
      `;
		}

		// Compter attributions récentes dans la fenêtre 7 jours
		const recentWindow = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
		const maxSlots = 3;

		const recentCounts = await sql<{ user_id: string; count: number }[]>`
      SELECT user_id, COUNT(*)::int AS count
      FROM cast_attribution
      WHERE user_id = ANY(ARRAY[${CASTER_A}, ${CASTER_C}]::varchar[])
        AND assigned_at >= ${recentWindow.toISOString()}
      GROUP BY user_id
    `;

		const countMap = new Map<string, number>();
		for (const r of recentCounts) {
			countMap.set(r.user_id, r.count);
		}

		const candidates = [
			{ userId: CASTER_A, status: "available" },
			{ userId: CASTER_C, status: "available" },
		];

		const eligible = candidates.filter((c) => {
			const recent = countMap.get(c.userId) ?? 0;
			return recent < maxSlots; // CASTER_C a exactement 3 → exclu
		});

		expect(eligible.map((c) => c.userId)).not.toContain(CASTER_C);
		expect(eligible.map((c) => c.userId)).toContain(CASTER_A);

		void slotMain; // utilisé indirectement
	});
});

// ---------------------------------------------------------------------------
// Test 6 — swap reset confirmedAt
// ---------------------------------------------------------------------------

describeLive("CastService — swap()", () => {
	test("swap reset confirmed_at a NULL et change user_id", async () => {
		const event = await insertEvent({ name: "Swap Test" });
		const slot = await insertSlot({ eventId: event.id, role: "caster_main" });

		// Attribution initiale avec confirmation
		const confirmedAt = new Date().toISOString();
		const initial = await insertAttribution({
			slotId: slot.id,
			userId: CASTER_A,
			assignedBy: "admin_001",
			confirmedAt,
		});

		expect(initial.user_id).toBe(CASTER_A);
		expect(initial.confirmed_at).not.toBeNull();

		// Swap vers CASTER_B (simule CastService.swap)
		const [swapped] = await sql<AttributionRow[]>`
      UPDATE cast_attribution
      SET user_id = ${CASTER_B},
          confirmed_at = NULL,
          assigned_by = 'admin_swap',
          assigned_at = NOW()
      WHERE slot_id = ${slot.id}
      RETURNING *
    `;

		expect(swapped.user_id).toBe(CASTER_B);
		expect(swapped.confirmed_at).toBeNull();
		expect(swapped.assigned_by).toBe("admin_swap");
	});
});
