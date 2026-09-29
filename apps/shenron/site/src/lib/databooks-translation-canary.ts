export interface CanaryEvidence {
	candidates: number;
	accepted: number;
	rejected: number;
	conflicts: number;
	corruptAfterAudit: number;
	rollbackAttempted: number;
	rollbackRestored: number;
}

export type CanaryVerdict =
	| { ok: true; reason: "canary accepted and rollback proven" }
	| { ok: false; reason: string };

/** Fail-closed gate used before any translation wave may leave canary mode. */
export function validateTranslationCanary(e: CanaryEvidence): CanaryVerdict {
	if (e.candidates < 10) return { ok: false, reason: "canary requires at least 10 candidates" };
	if (e.accepted !== e.candidates || e.rejected !== 0 || e.conflicts !== 0)
		return { ok: false, reason: "not every canary candidate was deposited cleanly" };
	if (e.corruptAfterAudit !== 0) return { ok: false, reason: "post-deposit audit found corruption" };
	if (e.rollbackAttempted !== e.candidates || e.rollbackRestored !== e.candidates)
		return { ok: false, reason: "rollback was not proven for every candidate" };
	return { ok: true, reason: "canary accepted and rollback proven" };
}
