/**
 * Tests unitaires — store en mémoire des défis ranked partageables
 * (`@rosegriffon/achillea-core/ranked`).
 * Couvre : création + code unique, lecture (preview), consommation à usage unique, ciblage
 * (toUserId), expiration (TTL), annulation.
 */

import { describe, expect, test } from "bun:test";

import {
	activeChallengeCount,
	cancelChallenge,
	consumeChallenge,
	createChallenge,
	getChallenge,
	purgeExpiredChallenges,
} from "@rosegriffon/achillea-core";

function base(overrides: Partial<Parameters<typeof createChallenge>[0]> = {}) {
	return createChallenge({
		fromUserId: "inviter",
		fromDisplayName: "Inviteur",
		fromAvatar: "",
		fromElo: 1000,
		mode: 2,
		ranked: true,
		...overrides,
	});
}

describe("createChallenge", () => {
	test("génère un code de 8 caractères dans l'alphabet lisible", () => {
		const ch = base();
		expect(ch.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
		expect(ch.toUserId).toBeNull();
		expect(ch.expiresAt).toBeGreaterThan(ch.createdAt);
		cancelChallenge(ch.code);
	});

	test("deux défis ont des codes distincts", () => {
		const a = base();
		const b = base();
		expect(a.code).not.toBe(b.code);
		cancelChallenge(a.code);
		cancelChallenge(b.code);
	});

	test("conserve toUserId pour un défi ciblé (revanche)", () => {
		const ch = base({ toUserId: "cible" });
		expect(ch.toUserId).toBe("cible");
		cancelChallenge(ch.code);
	});
});

describe("getChallenge — lecture sans consommer", () => {
	test("retourne le défi puis le laisse disponible", () => {
		const ch = base();
		expect(getChallenge(ch.code)?.code).toBe(ch.code);
		// Toujours là après une lecture.
		expect(getChallenge(ch.code)?.code).toBe(ch.code);
		cancelChallenge(ch.code);
	});

	test("code inconnu → null", () => {
		expect(getChallenge("ZZZZZZZZ")).toBeNull();
	});
});

describe("consumeChallenge — usage unique", () => {
	test("retourne le défi puis le supprime (2e consommation → null)", () => {
		const ch = base();
		expect(consumeChallenge(ch.code)?.code).toBe(ch.code);
		expect(consumeChallenge(ch.code)).toBeNull();
		expect(getChallenge(ch.code)).toBeNull();
	});
});

describe("expiration (TTL)", () => {
	test("un défi expiré n'est plus lisible et est purgé", () => {
		const ch = base();
		// Force l'expiration dans le passé.
		ch.expiresAt = Date.now() - 1;
		expect(getChallenge(ch.code)).toBeNull();
		expect(consumeChallenge(ch.code)).toBeNull();
	});

	test("purgeExpiredChallenges retire bien les expirés", () => {
		const ch = base();
		ch.expiresAt = Date.now() - 1;
		purgeExpiredChallenges();
		expect(getChallenge(ch.code)).toBeNull();
	});
});

describe("activeChallengeCount + cancelChallenge", () => {
	test("compte les défis actifs et l'annulation décrémente", () => {
		const before = activeChallengeCount();
		const ch = base();
		expect(activeChallengeCount()).toBe(before + 1);
		cancelChallenge(ch.code);
		expect(activeChallengeCount()).toBe(before);
	});
});
