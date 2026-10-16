/**
 * Règles sur les inscrits d'un tournoi — statut, capacité, liste d'attente,
 * seeding.
 *
 * Ces règles étaient dispersées dans les composants Angular du tableau des
 * participants. Un front Next.js ou une app mobile en a exactement besoin pour
 * afficher la même chose, et l'API pour la faire respecter : elles n'ont rien
 * à faire dans une vue.
 *
 * Les paramètres sont structurels plutôt que des `ParticipantDTO` complets :
 * une prévisualisation de seeding travaille sur des lignes allégées.
 */

import { ParticipantStatus } from "@rosegriffon/achillea-types";

import { toCount } from "../numbers/index";

export interface ParticipantLike {
	status?: ParticipantStatus;
	seed?: number | null;
	waitlistPosition?: number | null;
	hasCheckedIn?: boolean;
	user: { username?: string; soloRank?: { elo?: number } };
}

/**
 * Statut effectif d'un inscrit.
 * Absent sur les réponses d'API antérieures au statut : vaut `ACTIVE`.
 */
export function participantStatus(participant: { status?: ParticipantStatus }): ParticipantStatus {
	return participant.status ?? ParticipantStatus.ACTIVE;
}

/** Inscrits occupant réellement une place. */
export function activeParticipants<T extends { status?: ParticipantStatus }>(
	participants: readonly T[]
): T[] {
	return participants.filter((p) => participantStatus(p) === ParticipantStatus.ACTIVE);
}

/** Inscrits affichés au tableau : tout sauf la liste d'attente. */
export function rosterParticipants<T extends { status?: ParticipantStatus }>(
	participants: readonly T[]
): T[] {
	return participants.filter((p) => participantStatus(p) !== ParticipantStatus.WAITLISTED);
}

/** Liste d'attente dans l'ordre de promotion (position calculée par l'API). */
export function waitlist<T extends { status?: ParticipantStatus; waitlistPosition?: number | null }>(
	participants: readonly T[]
): T[] {
	return participants
		.filter((p) => participantStatus(p) === ParticipantStatus.WAITLISTED)
		.slice()
		.sort((a, b) => (a.waitlistPosition ?? 0) - (b.waitlistPosition ?? 0));
}

export function disqualifiedCount(
	participants: readonly { status?: ParticipantStatus }[]
): number {
	return participants.filter((p) => participantStatus(p) === ParticipantStatus.DISQUALIFIED).length;
}

/** Reste-t-il une place ? Conditionne la promotion depuis la liste d'attente. */
export function hasFreeSlot(
	participants: readonly { status?: ParticipantStatus }[],
	capacity: number
): boolean {
	return activeParticipants(participants).length < toCount(capacity);
}

/** Places restantes (jamais négatif, même si la capacité a été réduite). */
export function freeSlots(
	participants: readonly { status?: ParticipantStatus }[],
	capacity: number
): number {
	return Math.max(0, toCount(capacity) - activeParticipants(participants).length);
}

/**
 * Inscrits triés par seed croissant, les non-seedés en bas et départagés par
 * nom — un ordre stable est indispensable pour une prévisualisation d'arbre.
 */
export function sortBySeed<T extends { seed?: number | null; user: { username?: string } }>(
	participants: readonly T[]
): T[] {
	return participants.slice().sort((a, b) => {
		const sa = a.seed ?? Number.MAX_SAFE_INTEGER;
		const sb = b.seed ?? Number.MAX_SAFE_INTEGER;
		if (sa !== sb) return sa - sb;
		return (a.user.username ?? "").localeCompare(b.user.username ?? "", "fr-FR");
	});
}

export function seededCount(participants: readonly { seed?: number | null }[]): number {
	return participants.filter((p) => p.seed != null && p.seed > 0).length;
}

/** Numéros de seed encore libres, dans l'ordre croissant. */
export function freeSeeds(
	participants: readonly { seed?: number | null }[],
	capacity: number
): number[] {
	const taken = new Set(
		participants.map((p) => p.seed).filter((seed): seed is number => seed != null && seed > 0)
	);
	const free: number[] = [];
	const limit = toCount(capacity);
	for (let seed = 1; seed <= limit; seed++) {
		if (!taken.has(seed)) free.push(seed);
	}
	return free;
}

/**
 * Seeding par Elo décroissant : le seed 1 va au mieux classé, départage par
 * nom pour rester déterministe d'un appel à l'autre.
 */
export function seedByElo<T extends { user: { username?: string; soloRank?: { elo?: number } } }>(
	participants: readonly T[]
): Array<{ seed: number; participant: T }> {
	return participants
		.slice()
		.sort((a, b) => {
			const ea = a.user.soloRank?.elo ?? 0;
			const eb = b.user.soloRank?.elo ?? 0;
			if (eb !== ea) return eb - ea;
			return (a.user.username ?? "").localeCompare(b.user.username ?? "", "fr-FR");
		})
		.map((participant, index) => ({ seed: index + 1, participant }));
}

export function checkedInCount(participants: readonly { hasCheckedIn?: boolean }[]): number {
	return participants.filter((p) => p.hasCheckedIn === true).length;
}

/** Transitions de statut autorisées sur un inscrit. */
export const PARTICIPANT_STATUS_TRANSITIONS: Readonly<
	Record<ParticipantStatus, readonly ParticipantStatus[]>
> = {
	[ParticipantStatus.ACTIVE]: [ParticipantStatus.WAITLISTED, ParticipantStatus.DISQUALIFIED],
	[ParticipantStatus.WAITLISTED]: [ParticipantStatus.ACTIVE, ParticipantStatus.DISQUALIFIED],
	// Réintégration possible : une DQ peut être annulée par un organisateur.
	[ParticipantStatus.DISQUALIFIED]: [ParticipantStatus.ACTIVE, ParticipantStatus.WAITLISTED],
};

export function canTransitionParticipantStatus(
	from: ParticipantStatus,
	to: ParticipantStatus
): boolean {
	return PARTICIPANT_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}
