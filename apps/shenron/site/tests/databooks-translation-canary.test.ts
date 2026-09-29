import { describe, expect, test } from "bun:test";
import { validateTranslationCanary } from "../src/lib/databooks-translation-canary";

const proof = { candidates: 10, accepted: 10, rejected: 0, conflicts: 0, corruptAfterAudit: 0, rollbackAttempted: 10, rollbackRestored: 10 };

describe("translation canary gate", () => {
	test("opens only with a complete rollback proof", () => {
		expect(validateTranslationCanary(proof)).toEqual({ ok: true, reason: "canary accepted and rollback proven" });
	});
	test("fails closed on partial sample, corruption, conflict or incomplete rollback", () => {
		for (const evidence of [
			{ ...proof, candidates: 9, accepted: 9, rollbackAttempted: 9, rollbackRestored: 9 },
			{ ...proof, corruptAfterAudit: 1 },
			{ ...proof, conflicts: 1, accepted: 9 },
			{ ...proof, rollbackRestored: 9 },
		]) expect(validateTranslationCanary(evidence).ok).toBe(false);
	});
});
