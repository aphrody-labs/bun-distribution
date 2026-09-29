/**
 * Unit tests for buildSeedingPayload —
 * seed N must land at index N-1 (not array-order after orderBy seed ASC).
 */
import { describe, expect, test } from "bun:test";

import { buildSeedingPayload } from "@/utils/functions/buildSeedingPayload";

describe("buildSeedingPayload", () => {
	test("place les seeds aux bons index (seed 1 → slot 0)", () => {
		const payload = buildSeedingPayload(4, [
			{ seed: 1, bracketParticipantId: 101 },
			{ seed: 2, bracketParticipantId: 102 },
			{ seed: 3, bracketParticipantId: 103 },
			{ seed: 4, bracketParticipantId: 104 },
		]);
		expect(payload).toEqual([101, 102, 103, 104]);
	});

	test("honore des seeds non contiguës (seed 1 et 4 seulement)", () => {
		const payload = buildSeedingPayload(4, [
			{ seed: 4, bracketParticipantId: 104 },
			{ seed: 1, bracketParticipantId: 101 },
		]);
		expect(payload[0]).toBe(101);
		expect(payload[3]).toBe(104);
		expect(payload[1]).toBeNull();
		expect(payload[2]).toBeNull();
	});

	test("remplit les slots vides avec les non-seedés (ordre d'entrée)", () => {
		const payload = buildSeedingPayload(4, [
			{ seed: 1, bracketParticipantId: 101 },
			{ seed: null, bracketParticipantId: 201 },
			{ seed: 3, bracketParticipantId: 103 },
			{ seed: null, bracketParticipantId: 202 },
		]);
		// seed 1 → [0], seed 3 → [2], unseeded fill [1] puis [3]
		expect(payload).toEqual([101, 201, 103, 202]);
	});

	test("ignore les participants sans bracketParticipantId", () => {
		const payload = buildSeedingPayload(2, [
			{ seed: 1, bracketParticipantId: null },
			{ seed: 2, bracketParticipantId: 102 },
		]);
		expect(payload[0]).toBeNull();
		expect(payload[1]).toBe(102);
	});

	test("ne se laisse pas tromper par un orderBy seed ASC + nulls first", () => {
		// Repro du bug : orderBy seed ASC mettait nulls en tête, puis
		// participants[i] → seed 1 se retrouvait en slot 2.
		const asSortedBySeedAscNullsFirst = [
			{ seed: null, bracketParticipantId: 201 },
			{ seed: null, bracketParticipantId: 202 },
			{ seed: 1, bracketParticipantId: 101 },
			{ seed: 2, bracketParticipantId: 102 },
		];
		const payload = buildSeedingPayload(4, asSortedBySeedAscNullsFirst);
		expect(payload[0]).toBe(101); // seed 1
		expect(payload[1]).toBe(102); // seed 2
		expect(payload[2]).toBe(201); // unseeded fill
		expect(payload[3]).toBe(202);
	});

	test("seed hors taille → traité comme non-seedé", () => {
		const payload = buildSeedingPayload(2, [
			{ seed: 99, bracketParticipantId: 199 },
			{ seed: 1, bracketParticipantId: 101 },
		]);
		expect(payload[0]).toBe(101);
		expect(payload[1]).toBe(199);
	});
});
