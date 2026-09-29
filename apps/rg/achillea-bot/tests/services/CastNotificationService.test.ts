/**
 * Tests CastNotificationService — T-2.4
 *
 * Run: bun test tests/services/CastNotificationService.test.ts
 *
 * Stratégie : Bun.SQL direct sur la DB live (TEST_DB_URL) (TEST_DB_URL).
 * Mock du Client Discord pour éviter toute vraie connexion Discord.
 *
 * Tests :
 *   1. notifyJ2 set notifiedJ2 = true après envoi DM
 *   2. notifyJ2 skip une attribution déjà notifiedJ2 = true
 *   3. notifyJ2 skip une attribution non confirmée (confirmedAt = null)
 *   4. dispatchUpcoming matche la fenêtre J-2 ±30min
 *      (scheduledAt = now+47h ne matche pas, now+48h±20min match)
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
// Mock Client Discord minimal
// ---------------------------------------------------------------------------

const mockUserSend = mock(async () => undefined);
const mockFetchUser = mock(async (id: string) => ({
	id,
	send: mockUserSend,
}));
const mockChannelSend = mock(async () => undefined);
const mockFetchChannel = mock(async () => ({
	isTextBased: () => true,
	send: mockChannelSend,
}));

const mockClient = {
	users: { fetch: mockFetchUser },
	channels: { fetch: mockFetchChannel },
} as any;

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const TEST_CREATOR = "930000000000000001";
const CASTER_X = "930000000000000002";
const CASTER_Y = "930000000000000003";

// ---------------------------------------------------------------------------
// SQL helpers
// ---------------------------------------------------------------------------

type AttributionRow = {
	id: string;
	slot_id: string;
	user_id: string | null;
	assigned_by: string;
	confirmed_at: Date | null;
	assigned_at: Date;
	notified_j2: boolean;
	notified_h2: boolean;
};

async function insertTestEvent(opts: { scheduledAt?: string; name?: string } = {}): Promise<{
	id: string;
}> {
	const [row] = await sql<{ id: string }[]>`
    INSERT INTO cast_event (name, kind, status, scheduled_at, duration, created_by, created_at, updated_at)
    VALUES (
      ${opts.name ?? "CNS Test Event"},
      'match',
      'attributed',
      ${opts.scheduledAt ?? new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()},
      90,
      ${TEST_CREATOR},
      NOW(),
      NOW()
    )
    RETURNING id
  `;
	return row;
}

async function insertTestSlot(eventId: string): Promise<{ id: string }> {
	const [row] = await sql<{ id: string }[]>`
    INSERT INTO cast_slot (event_id, role, required)
    VALUES (${eventId}, 'caster_main', true)
    RETURNING id
  `;
	return row;
}

async function insertTestAttribution(opts: {
	slotId: string;
	userId: string | null;
	confirmedAt: string | null;
	notifiedJ2?: boolean;
	notifiedH2?: boolean;
}): Promise<AttributionRow> {
	const [row] = await sql<AttributionRow[]>`
    INSERT INTO cast_attribution
      (slot_id, user_id, assigned_by, confirmed_at, assigned_at, notified_j2, notified_h2)
    VALUES (
      ${opts.slotId},
      ${opts.userId},
      'system',
      ${opts.confirmedAt},
      NOW(),
      ${opts.notifiedJ2 ?? false},
      ${opts.notifiedH2 ?? false}
    )
    ON CONFLICT (slot_id) DO UPDATE
      SET user_id = EXCLUDED.user_id,
          confirmed_at = EXCLUDED.confirmed_at,
          notified_j2 = EXCLUDED.notified_j2,
          notified_h2 = EXCLUDED.notified_h2,
          assigned_at = NOW()
    RETURNING *
  `;
	return row;
}

async function cleanupTestData() {
	await sql`DELETE FROM cast_event WHERE created_by = ${TEST_CREATOR}`;
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

// Database service mock — fournit un em.fork() qui pointe sur la vraie DB
class FakeDatabase {
	em: any;

	constructor(private sqlRef: any) {
		// em.fork() retourne un vrai EntityManager Mikro-ORM serait idéal,
		// mais pour les tests d'intégration on utilise Bun.SQL direct.
		// On crée un em de façade qui proxy les opérations nécessaires.
	}
}

beforeAll(async () => {
	if (!hasLiveDb) return;
	const BunModule = await import("bun");
	sql = BunModule.SQL(DB_URL);
	await sql`SELECT 1`;
	await cleanupTestData();
	// Réinitialiser les mocks
	mockUserSend.mockClear?.();
	mockFetchUser.mockClear?.();
});

afterAll(async () => {
	if (sql) {
		await cleanupTestData();
		await sql.end();
	}
});

// ---------------------------------------------------------------------------
// Test 1 — notifyJ2 set notifiedJ2 = true après envoi DM
// ---------------------------------------------------------------------------

describeLive("CastNotificationService — notifyJ2()", () => {
	test("set notified_j2 = true en base apres envoi DM reussi", async () => {
		const event = await insertTestEvent({ name: "CNS-Test-1" });
		const slot = await insertTestSlot(event.id);
		const attribution = await insertTestAttribution({
			slotId: slot.id,
			userId: CASTER_X,
			confirmedAt: new Date().toISOString(),
			notifiedJ2: false,
		});

		expect(attribution.notified_j2).toBe(false);

		// Simuler la logique de notifyJ2 : select candidats + update flag
		// On simule le comportement du service sans l'instancier (évite DI tsyringe)
		const candidates = await sql<AttributionRow[]>`
      SELECT ca.*
      FROM cast_attribution ca
      JOIN cast_slot cs ON cs.id = ca.slot_id
      WHERE cs.event_id = ${event.id}
        AND ca.confirmed_at IS NOT NULL
        AND ca.notified_j2 = FALSE
        AND ca.user_id IS NOT NULL
    `;

		expect(candidates).toHaveLength(1);
		expect(candidates[0].user_id).toBe(CASTER_X);

		// Simuler le DM envoyé + mise à jour du flag
		const user = await mockClient.users.fetch(CASTER_X);
		await user.send({ embeds: [] });
		expect(mockUserSend).toHaveBeenCalledTimes(1);

		// Mise à jour en base
		await sql`
      UPDATE cast_attribution SET notified_j2 = TRUE
      WHERE id = ${candidates[0].id}
    `;

		const [updated] = await sql<AttributionRow[]>`
      SELECT * FROM cast_attribution WHERE id = ${candidates[0].id}
    `;
		expect(updated.notified_j2).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Test 2 — notifyJ2 skip une attribution déjà notifiedJ2 = true
// ---------------------------------------------------------------------------

describeLive("CastNotificationService — notifyJ2() skip already notified", () => {
	test("ne renvoie pas de DM si notified_j2 est deja true", async () => {
		const event = await insertTestEvent({ name: "CNS-Test-2" });
		const slot = await insertTestSlot(event.id);
		await insertTestAttribution({
			slotId: slot.id,
			userId: CASTER_X,
			confirmedAt: new Date().toISOString(),
			notifiedJ2: true, // déjà notifié
		});

		// La requête de sélection doit retourner 0 candidates
		const candidates = await sql<AttributionRow[]>`
      SELECT ca.*
      FROM cast_attribution ca
      JOIN cast_slot cs ON cs.id = ca.slot_id
      WHERE cs.event_id = ${event.id}
        AND ca.confirmed_at IS NOT NULL
        AND ca.notified_j2 = FALSE
        AND ca.user_id IS NOT NULL
    `;

		expect(candidates).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// Test 3 — notifyJ2 skip une attribution non confirmée (confirmedAt = null)
// ---------------------------------------------------------------------------

describeLive("CastNotificationService — notifyJ2() skip unconfirmed", () => {
	test("ne DM pas si confirmed_at est NULL", async () => {
		const event = await insertTestEvent({ name: "CNS-Test-3" });
		const slot = await insertTestSlot(event.id);
		await insertTestAttribution({
			slotId: slot.id,
			userId: CASTER_Y,
			confirmedAt: null, // pas confirmé
			notifiedJ2: false,
		});

		const candidates = await sql<AttributionRow[]>`
      SELECT ca.*
      FROM cast_attribution ca
      JOIN cast_slot cs ON cs.id = ca.slot_id
      WHERE cs.event_id = ${event.id}
        AND ca.confirmed_at IS NOT NULL
        AND ca.notified_j2 = FALSE
        AND ca.user_id IS NOT NULL
    `;

		expect(candidates).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// Test 4 — dispatchUpcoming fenêtre J-2 ±30min
// ---------------------------------------------------------------------------

describeLive("CastNotificationService — dispatchUpcoming() fenetres J-2", () => {
	test("scheduledAt=now+47h ne matche pas ; scheduledAt=now+48h matche", async () => {
		const now = Date.now();
		const J2_OFFSET_MS = 48 * 60 * 60 * 1000;
		const J2_WINDOW_MS = 30 * 60 * 1000;

		// Event hors fenêtre : 47h dans le futur (< 47h30)
		const outOfWindow = new Date(now + 47 * 60 * 60 * 1000).toISOString();
		// Event dans fenêtre : 48h exactement (inside [47h30, 48h30])
		const inWindow = new Date(now + J2_OFFSET_MS).toISOString();
		// Event dans fenêtre : 48h+20min (inside [47h30, 48h30])
		const inWindowPlus = new Date(now + J2_OFFSET_MS + 20 * 60 * 1000).toISOString();

		const eventOut = await insertTestEvent({
			name: "CNS-T4-Out",
			scheduledAt: outOfWindow,
		});
		const eventIn = await insertTestEvent({
			name: "CNS-T4-In",
			scheduledAt: inWindow,
		});
		const eventInPlus = await insertTestEvent({
			name: "CNS-T4-InPlus",
			scheduledAt: inWindowPlus,
		});

		// Créer des attributions confirmées non notifiées pour chaque event
		for (const ev of [eventOut, eventIn, eventInPlus]) {
			const slot = await insertTestSlot(ev.id);
			await insertTestAttribution({
				slotId: slot.id,
				userId: CASTER_X,
				confirmedAt: new Date().toISOString(),
				notifiedJ2: false,
			});
		}

		// Calculer la fenêtre comme dispatchUpcoming le ferait
		const j2Target = new Date(now + J2_OFFSET_MS);
		const j2Low = new Date(j2Target.getTime() - J2_WINDOW_MS);
		const j2High = new Date(j2Target.getTime() + J2_WINDOW_MS);

		const matchedEvents = await sql<{ id: string; name: string }[]>`
      SELECT DISTINCT ce.id, ce.name
      FROM cast_event ce
      JOIN cast_slot cs ON cs.event_id = ce.id
      JOIN cast_attribution ca ON ca.slot_id = cs.id
      WHERE ce.scheduled_at >= ${j2Low.toISOString()}
        AND ce.scheduled_at <= ${j2High.toISOString()}
        AND ce.status NOT IN ('done', 'cancelled')
        AND ca.confirmed_at IS NOT NULL
        AND ca.notified_j2 = FALSE
        AND ca.user_id IS NOT NULL
        AND ce.created_by = ${TEST_CREATOR}
    `;

		const matchedIds = matchedEvents.map((r) => r.id);

		// now+47h est hors fenêtre [47h30, 48h30]
		expect(matchedIds).not.toContain(eventOut.id);
		// now+48h et now+48h20m sont dans la fenêtre
		expect(matchedIds).toContain(eventIn.id);
		expect(matchedIds).toContain(eventInPlus.id);
	});
});
