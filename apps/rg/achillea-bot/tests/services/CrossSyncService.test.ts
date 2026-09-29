/**
 * Tests CrossSyncService — T-1.5
 *
 * Run: bun test tests/services/CrossSyncService.test.ts
 *
 * Strategie : isolation totale, pas de DB, pas de Redis.
 * - fetch mocke via globalThis.fetch
 * - CrossSyncService instancie directement (sans DI)
 * - Logger non resolu intentionnellement (le service tolere son absence)
 *
 * Tests :
 *   1. verifySignature — roundtrip HMAC sign + verify
 *   2. verifySignature — rejet signature incorrecte
 *   3. verifySignature — rejet timestamp trop ancien (> 5 min)
 *   4. pushSanction — filtre ban-only : ne pousse PAS un warn
 *   5. pushSanction — filtre ban-only : pousse un ban
 *   6. pushSanction — retry sur HTTP 500, succes au 3e essai
 *   7. pushSanction — anti-boucle : skip si evidence[0].from est defini
 */

import "reflect-metadata";

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

// tsyringe imports are no longer mocked globally to avoid conflicts with other tests.

// CrossSyncService does a dynamic import("@/services/Logger") in log().
// Mock it so that dynamic path also fails silently (resolveDependency throws).
mock.module("@/services/Logger", () => ({
	Logger: class {
		log() {}
	},
}));

// dependency module is not mocked to avoid breaking container resolutions in other tests.

// ---------------------------------------------------------------------------
// Imports post-mock
// ---------------------------------------------------------------------------

import { CrossSyncService } from "../../src/services/CrossSyncService";
import { SanctionType } from "../../src/utils/enums/sanctionType";

// ---------------------------------------------------------------------------
// HMAC helper (mirrors CrossSyncService internal logic)
// ---------------------------------------------------------------------------

async function makeHmac(timestamp: string, body: string, secret: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"]
	);
	const data = new TextEncoder().encode(`${timestamp}.${body}`);
	const sig = await crypto.subtle.sign("HMAC", key, data);
	return Array.from(new Uint8Array(sig))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

// ---------------------------------------------------------------------------
// Sanction factory
// ---------------------------------------------------------------------------

function makeSanction(
	overrides: { type?: SanctionType; evidence?: Record<string, unknown>[] | null } = {}
) {
	return {
		id: "test-uuid-0001",
		userId: "811111111111111111",
		guildId: "812222222222222222",
		type: SanctionType.Ban,
		reason: "test reason",
		durationSec: null,
		expiresAt: null,
		issuedBy: "813333333333333333",
		createdAt: new Date("2026-04-25T12:00:00Z"),
		evidence: null,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Env / fetch isolation
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;
let savedTargets: string | undefined;

beforeEach(() => {
	savedTargets = process.env.ACHILLEA_CROSS_SYNC_TARGETS;
	delete process.env.ACHILLEA_CROSS_SYNC_TARGETS;
});

afterEach(() => {
	if (savedTargets !== undefined) {
		process.env.ACHILLEA_CROSS_SYNC_TARGETS = savedTargets;
	} else {
		delete process.env.ACHILLEA_CROSS_SYNC_TARGETS;
	}
	globalThis.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// Test 1 — verifySignature roundtrip
// ---------------------------------------------------------------------------

describe("CrossSyncService — verifySignature", () => {
	test("valide une signature HMAC correcte (roundtrip)", async () => {
		const svc = new CrossSyncService();
		const secret = "super-secret-key";
		const body = JSON.stringify({ hello: "world" });
		const timestamp = String(Date.now());
		const signature = await makeHmac(timestamp, body, secret);

		const result = await svc.verifySignature(timestamp, body, signature, secret);
		expect(result).toBe(true);
	});

	// Test 2
	test("rejette une signature incorrecte", async () => {
		const svc = new CrossSyncService();
		const secret = "super-secret-key";
		const body = JSON.stringify({ hello: "world" });
		const timestamp = String(Date.now());

		const result = await svc.verifySignature(timestamp, body, "deadbeef".repeat(8), secret);
		expect(result).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Test 3 — rejet timestamp trop ancien
// ---------------------------------------------------------------------------

describe("CrossSyncService — verifySignature drift", () => {
	test("rejette un timestamp plus ancien que 5 minutes", async () => {
		const svc = new CrossSyncService();
		const secret = "key";
		const body = "{}";
		const oldTs = String(Date.now() - 6 * 60 * 1000);
		const sig = await makeHmac(oldTs, body, secret);

		const result = await svc.verifySignature(oldTs, body, sig, secret);
		expect(result).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Tests 4 & 5 — pushSanction filtre policy ban-only
// ---------------------------------------------------------------------------

describe("CrossSyncService — pushSanction policy=ban-only", () => {
	test("ne fait pas de fetch pour un warn avec policy=ban-only", async () => {
		process.env.ACHILLEA_CROSS_SYNC_TARGETS = JSON.stringify([
			{ url: "https://example.com/moderation/sync", secret: "s", policy: "ban-only" },
		]);

		const calls: string[] = [];
		globalThis.fetch = (async (url: unknown) => {
			calls.push(url as string);
			return new Response(JSON.stringify({ ok: true }), { status: 200 });
		}) as typeof fetch;

		const svc = new CrossSyncService();
		await svc.pushSanction(makeSanction({ type: SanctionType.Warn }) as any, "create");

		expect(calls.length).toBe(0);
	});

	test("fait un fetch pour un ban avec policy=ban-only", async () => {
		process.env.ACHILLEA_CROSS_SYNC_TARGETS = JSON.stringify([
			{ url: "https://example.com/moderation/sync", secret: "s", policy: "ban-only" },
		]);

		const calls: string[] = [];
		globalThis.fetch = (async (url: unknown) => {
			calls.push(url as string);
			return new Response(JSON.stringify({ ok: true }), { status: 200 });
		}) as typeof fetch;

		const svc = new CrossSyncService();
		await svc.pushSanction(makeSanction({ type: SanctionType.Ban }) as any, "create");

		expect(calls.length).toBe(1);
		expect(calls[0]).toBe("https://example.com/moderation/sync");
	});
});

// ---------------------------------------------------------------------------
// Test 6 — retry sur HTTP 500
// ---------------------------------------------------------------------------

describe("CrossSyncService — retry sur 5xx", () => {
	test("retente 3 fois et reussit au 3e appel", async () => {
		process.env.ACHILLEA_CROSS_SYNC_TARGETS = JSON.stringify([
			{ url: "https://example.com/moderation/sync", secret: "s", policy: "all" },
		]);

		let callCount = 0;
		globalThis.fetch = (async () => {
			callCount++;
			if (callCount < 3) {
				return new Response("error", { status: 500 });
			}
			return new Response(JSON.stringify({ ok: true }), { status: 200 });
		}) as typeof fetch;

		const svc = new CrossSyncService();
		await svc.pushSanction(makeSanction({ type: SanctionType.Ban }) as any, "create");

		expect(callCount).toBe(3);
	});
});

// ---------------------------------------------------------------------------
// Test 7 — anti-boucle
// ---------------------------------------------------------------------------

describe("CrossSyncService — anti-boucle", () => {
	test("ne propage pas une sanction recue (evidence[0].from defini)", async () => {
		process.env.ACHILLEA_CROSS_SYNC_TARGETS = JSON.stringify([
			{ url: "https://example.com/moderation/sync", secret: "s", policy: "all" },
		]);

		const calls: string[] = [];
		globalThis.fetch = (async (url: unknown) => {
			calls.push(url as string);
			return new Response(JSON.stringify({ ok: true }), { status: 200 });
		}) as typeof fetch;

		const svc = new CrossSyncService();
		const sanction = makeSanction({
			type: SanctionType.Ban,
			evidence: [{ from: "other-bot", source_guild: "999" }],
		});
		await svc.pushSanction(sanction as any, "create");

		expect(calls.length).toBe(0);
	});
});
