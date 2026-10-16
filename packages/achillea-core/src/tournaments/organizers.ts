/**
 * Qui organise un tournoi — prédicat unique partagé par l'API (qui l'applique)
 * et par les fronts (qui masquent l'UI TO en conséquence).
 *
 * Les paramètres sont volontairement structurels et non des DTO complets :
 * l'API travaille sur des entités MikroORM, le web sur des DTO, un client
 * mobile sur un modèle allégé. Tous satisfont ces formes minimales.
 */

import { UserRole } from "@rosegriffon/achillea-types";

export interface OrganizerActor {
	id?: string | null;
	role?: number | null;
}

export interface OrganizerScope {
	organization?: {
		owner?: string | { id?: string | null } | null;
		managers?: Array<{
			user?: { id?: string | null } | null;
			id?: string | null;
		} | null> | null;
	} | null;
	managers?: Array<{ id?: string | null } | null> | null;
}

/**
 * L'utilisateur est-il organisateur du tournoi (owner d'org, manager d'org, TO) ?
 *
 * Le SuperAdministrator a un accès ops complet.
 *
 * Piège confirmé en production : ne jamais comparer deux identifiants
 * optionnels entre eux. Sans visiteur connecté, `undefined === undefined` est
 * vrai et ouvrirait l'UI d'organisateur à tous les anonymes — d'où le garde
 * `if (!userId) return false` en tête.
 */
export function isTournamentOrganizer(
	user: OrganizerActor | null | undefined,
	tournament: OrganizerScope | null | undefined
): boolean {
	const userId = user?.id;
	if (!userId) return false;

	if ((user?.role ?? 0) >= UserRole.SuperAdministrator) return true;

	const owner = tournament?.organization?.owner;
	const ownerId = typeof owner === "string" ? owner : owner?.id;
	if (ownerId && ownerId === userId) return true;

	const orgManagers = tournament?.organization?.managers;
	if (orgManagers?.some((manager) => manager?.user?.id === userId)) return true;

	const tournamentManagers = tournament?.managers;
	return Boolean(tournamentManagers?.some((manager) => manager?.id === userId));
}

/** Formats éligibles au bonus AP podium (élimination uniquement). */
export function isPlacementPrizeEligible(tournamentType: string | null | undefined): boolean {
	return tournamentType === "single_elimination" || tournamentType === "double_elimination";
}
