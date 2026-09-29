/**
 * Tests entités Cast — T-2.1
 *
 * Run: bun test tests/entities/Cast.test.ts
 *
 * Utilise Bun.SQL vers la DB live (TEST_DB_URL) (TEST_DB_URL défini dans tests/setup.ts).
 * Tests:
 *   1. Insert CastEvent + CastSlot — relation OK (event_id présent)
 *   2. CastAvailability UNIQUE (userId, eventId) — violation rejetée par PG
 *   3. CastAttribution UNIQUE (slotId) — violation rejetée par PG
 *   4. Defrayment fields nullable — insert sans valeur de défraiement OK
 *   5. Cascade delete event → slot → attribution
 *   6. preferredRoles JSONB roundtrip avec array de rôles
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { describeLive, hasLiveDb } from "../fixtures/live-db";

const DB_URL = process.env.TEST_DB_URL ?? "";

let sql: Awaited<ReturnType<typeof import("bun").default.SQL>>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function insertEvent(
	overrides: Partial<{
		name: string;
		kind: string;
		scheduled_at: string;
		duration: number;
		status: string;
		created_by: string;
	}> = {}
): Promise<{ id: string }> {
	const [row] = await sql<{ id: string }[]>`
    INSERT INTO cast_event (name, kind, scheduled_at, duration, status, created_by)
    VALUES (
      ${overrides.name ?? "Test Event"},
      ${overrides.kind ?? "match"},
      ${overrides.scheduled_at ?? "2026-06-01T14:00:00Z"},
      ${overrides.duration ?? 90},
      ${overrides.status ?? "planned"},
      ${overrides.created_by ?? "111111111111111111"}
    )
    RETURNING id
  `;
	return row;
}

async function insertSlot(
	eventId: string,
	overrides: Partial<{
		role: string;
		required: boolean;
		defrayment_amount: string | null;
		defrayment_currency: string | null;
		defrayment_reason: string | null;
	}> = {}
): Promise<{ id: string }> {
	const [row] = await sql<{ id: string }[]>`
    INSERT INTO cast_slot (event_id, role, required, defrayment_amount, defrayment_currency, defrayment_reason)
    VALUES (
      ${eventId}::uuid,
      ${overrides.role ?? "caster_main"},
      ${overrides.required ?? true},
      ${overrides.defrayment_amount ?? null},
      ${overrides.defrayment_currency ?? null},
      ${overrides.defrayment_reason ?? null}
    )
    RETURNING id
  `;
	return row;
}

async function insertAvailability(userId: string, eventId: string): Promise<{ id: string }> {
	const [row] = await sql<{ id: string }[]>`
    INSERT INTO cast_availability (user_id, event_id, status)
    VALUES (${userId}, ${eventId}::uuid, 'available')
    RETURNING id
  `;
	return row;
}

async function insertAttribution(
	slotId: string,
	userId: string | null,
	assignedBy: string
): Promise<{ id: string }> {
	const [row] = await sql<{ id: string }[]>`
    INSERT INTO cast_attribution (slot_id, user_id, assigned_by)
    VALUES (${slotId}::uuid, ${userId}, ${assignedBy})
    RETURNING id
  `;
	return row;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
	if (!hasLiveDb) return;
	const Bun = await import("bun");
	sql = Bun.SQL(DB_URL);
	await sql`SELECT 1`;
	// Nettoyage préventif des données de test
	await sql`DELETE FROM cast_event WHERE created_by = '111111111111111111'`;
});

afterAll(async () => {
	if (!sql) return;
	// Nettoyage post-test
	await sql`DELETE FROM cast_event WHERE created_by = '111111111111111111'`;
	await sql.end();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describeLive("Cast — modèle T-2.1", () => {
	test("1. Insert CastEvent + CastSlot — relation event_id présent", async () => {
		const event = await insertEvent({ name: "Grand Final Cast" });
		expect(event.id).toMatch(/^[0-9a-f-]{36}$/);

		const slot = await insertSlot(event.id, { role: "caster_main" });
		expect(slot.id).toMatch(/^[0-9a-f-]{36}$/);

		// Vérifier que le slot référence bien l'event
		const [row] = await sql<{ event_id: string; role: string }[]>`
      SELECT event_id::text, role FROM cast_slot WHERE id = ${slot.id}::uuid
    `;
		expect(row.event_id).toBe(event.id);
		expect(row.role).toBe("caster_main");
	});

	test("2. CastAvailability UNIQUE (userId, eventId) — double insert rejeté", async () => {
		const event = await insertEvent({ name: "Event Unique Test" });
		const userId = "222222222222222222";

		await insertAvailability(userId, event.id);

		await expect(insertAvailability(userId, event.id)).rejects.toThrow();
	});

	test("3. CastAttribution UNIQUE (slotId) — double attribution rejetée", async () => {
		const event = await insertEvent({ name: "Event Attribution Test" });
		const slot = await insertSlot(event.id);

		await insertAttribution(slot.id, "333333333333333333", "444444444444444444");

		await expect(
			insertAttribution(slot.id, "555555555555555555", "444444444444444444")
		).rejects.toThrow();
	});

	test("4. Defrayment fields nullable — insert sans défraiement OK", async () => {
		const event = await insertEvent({ name: "Event No Defray" });

		// Toutes les colonnes defrayment* sont NULL
		const [row] = await sql<
			{
				defrayment_amount: string | null;
				defrayment_currency: string | null;
				defrayment_reason: string | null;
			}[]
		>`
      INSERT INTO cast_slot (event_id, role)
      VALUES (${event.id}::uuid, 'observer')
      RETURNING defrayment_amount, defrayment_currency, defrayment_reason
    `;
		expect(row.defrayment_amount).toBeNull();
		expect(row.defrayment_currency).toBeNull();
		expect(row.defrayment_reason).toBeNull();
	});

	test("5. Cascade delete event → slot → attribution", async () => {
		const event = await insertEvent({ name: "Event Cascade Test" });
		const slot = await insertSlot(event.id);
		const attr = await insertAttribution(slot.id, "666666666666666666", "777777777777777777");

		// Vérifier que les 3 existent
		const [ev] = await sql<{ exists: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM cast_event WHERE id = ${event.id}::uuid) as exists
    `;
		expect(ev.exists).toBe(true);

		// Supprimer l'event — doit cascader sur slot puis attribution
		await sql`DELETE FROM cast_event WHERE id = ${event.id}::uuid`;

		const [slotCheck] = await sql<{ exists: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM cast_slot WHERE id = ${slot.id}::uuid) as exists
    `;
		expect(slotCheck.exists).toBe(false);

		const [attrCheck] = await sql<{ exists: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM cast_attribution WHERE id = ${attr.id}::uuid) as exists
    `;
		expect(attrCheck.exists).toBe(false);
	});

	test("6. preferredRoles JSONB roundtrip avec array de rôles", async () => {
		const event = await insertEvent({ name: "Event JSONB Test" });
		const userId = "888888888888888888";
		const roles = ["caster_main", "caster_secondary", "observer"];

		const [row] = await sql<{ preferred_roles: unknown }[]>`
      INSERT INTO cast_availability (user_id, event_id, status, preferred_roles)
      VALUES (${userId}, ${event.id}::uuid, 'maybe', ${JSON.stringify(roles)}::jsonb)
      RETURNING preferred_roles
    `;

		// PG retourne le JSONB déjà désérialisé par le driver Bun
		const parsed: string[] =
			typeof row.preferred_roles === "string"
				? JSON.parse(row.preferred_roles)
				: (row.preferred_roles as string[]);

		expect(parsed).toHaveLength(3);
		expect(parsed[0]).toBe("caster_main");
		expect(parsed[1]).toBe("caster_secondary");
		expect(parsed[2]).toBe("observer");
	});
});
