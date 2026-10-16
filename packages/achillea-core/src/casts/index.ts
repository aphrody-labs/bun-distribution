/**
 * Règles de diffusion (cast) — complétude d'une checklist, disponibilité,
 * éligibilité d'un caster à un poste.
 */

import {
	CastAvailabilityStatus,
	CastEventStatus,
	CastSlotRole,
	type CastAvailability,
	type CastEventDetail,
	type ChecklistItem,
} from "@rosegriffon/achillea-types";

/** Postes sans lesquels une diffusion ne peut pas partir en direct. */
export const ESSENTIAL_SLOT_ROLES: readonly CastSlotRole[] = [
	CastSlotRole.CasterMain,
	CastSlotRole.Producer,
];

export interface CastReadiness {
	/** Postes requis pourvus ET confirmés / total des postes requis. */
	requiredFilled: number;
	requiredTotal: number;
	/** Tous postes confondus. */
	filled: number;
	total: number;
	/** Postes essentiels manquants — bloquent le passage en direct. */
	missingEssential: CastSlotRole[];
	/** Part de postes requis pourvus, dans `[0, 1]`. */
	ratio: number;
	ready: boolean;
}

/** Un poste est pourvu quand il a un attributaire qui a confirmé. */
export function isSlotSettled(item: ChecklistItem): boolean {
	return item.casterId !== null && item.confirmed;
}

/** État de préparation d'une diffusion, à partir de sa checklist. */
export function castReadiness(checklist: readonly ChecklistItem[]): CastReadiness {
	const required = checklist.filter((item) => item.slot.required);
	const requiredFilled = required.filter(isSlotSettled).length;
	const filled = checklist.filter(isSlotSettled).length;

	const missingEssential = ESSENTIAL_SLOT_ROLES.filter((role) => {
		const items = checklist.filter((item) => item.slot.role === role);
		return items.length > 0 && !items.some(isSlotSettled);
	});

	const requiredTotal = required.length;
	return {
		requiredFilled,
		requiredTotal,
		filled,
		total: checklist.length,
		missingEssential,
		ratio: requiredTotal === 0 ? 1 : requiredFilled / requiredTotal,
		ready: requiredFilled === requiredTotal && missingEssential.length === 0,
	};
}

/** `true` si la diffusion peut passer en direct. */
export function canGoLive(detail: CastEventDetail): boolean {
	if (detail.event.status === CastEventStatus.Cancelled) return false;
	if (detail.event.status === CastEventStatus.Done) return false;
	return castReadiness(detail.checklist).ready;
}

/** Transitions de statut autorisées — toute autre est refusée côté API. */
export const CAST_STATUS_TRANSITIONS: Readonly<Record<CastEventStatus, readonly CastEventStatus[]>> =
	{
		[CastEventStatus.Planned]: [CastEventStatus.OpenSignup, CastEventStatus.Cancelled],
		[CastEventStatus.OpenSignup]: [CastEventStatus.Attributed, CastEventStatus.Cancelled],
		[CastEventStatus.Attributed]: [
			CastEventStatus.Live,
			CastEventStatus.OpenSignup,
			CastEventStatus.Cancelled,
		],
		[CastEventStatus.Live]: [CastEventStatus.Done, CastEventStatus.Cancelled],
		[CastEventStatus.Done]: [],
		[CastEventStatus.Cancelled]: [],
	};

export function canTransitionCastStatus(from: CastEventStatus, to: CastEventStatus): boolean {
	return CAST_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Score de disponibilité, pour trier les candidats à un poste. */
export function availabilityWeight(status: CastAvailabilityStatus): number {
	switch (status) {
		case CastAvailabilityStatus.Available:
			return 2;
		case CastAvailabilityStatus.Maybe:
			return 1;
		default:
			return 0;
	}
}

export interface CastCandidateScoreInput {
	userId: string;
	status: CastAvailabilityStatus;
	preferredRoles: readonly CastSlotRole[] | null | undefined;
	recentAssignments: number;
	binomeBonus: number;
}

/** Deterministic score used by automatic cast assignment. */
export function scoreCastCandidate(
	candidate: CastCandidateScoreInput,
	slotRole: CastSlotRole,
): number {
	const preferred = candidate.preferredRoles?.includes(slotRole) ? 10 : 0;
	const availability = candidate.status === CastAvailabilityStatus.Available ? 5 : 0;
	return preferred + availability - candidate.recentAssignments * 3 + candidate.binomeBonus;
}

/** Stable ordering for equally eligible caster candidates. */
export function compareCastCandidates(
	a: CastCandidateScoreInput,
	b: CastCandidateScoreInput,
	slotRole: CastSlotRole,
): number {
	return (
		scoreCastCandidate(b, slotRole) - scoreCastCandidate(a, slotRole) ||
		a.userId.localeCompare(b.userId)
	);
}

/**
 * Candidats à un poste, du plus disponible au moins disponible.
 * Un caster qui a explicitement exclu le rôle n'est jamais proposé.
 */
export function rankCandidatesForRole(
	availabilities: readonly CastAvailability[],
	role: CastSlotRole
): CastAvailability[] {
	return availabilities
		.filter((a) => a.status !== CastAvailabilityStatus.Unavailable)
		.filter((a) => a.preferredRoles === null || a.preferredRoles.includes(role))
		.slice()
		.sort((a, b) => {
			const weight = availabilityWeight(b.status) - availabilityWeight(a.status);
			if (weight !== 0) return weight;
			// À disponibilité égale, celui qui s'est déclaré en premier passe devant.
			return Date.parse(a.declaredAt) - Date.parse(b.declaredAt);
		});
}
