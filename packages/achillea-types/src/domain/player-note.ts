/**
 * Notes du staff sur les joueurs — « espace dédié » où les organisateurs
 * consignent ce qu'ils ont à dire d'un joueur pendant un tournoi.
 *
 * Jamais exposé au joueur concerné : l'API réserve ces routes au staff et aux
 * organisateurs du tournoi cité. Distinct d'une sanction : une note est une
 * observation, pas une décision.
 */

import type { PlayerNoteCategory, PlayerNoteSeverity } from "../enums/eventEnums";

import type { PageQuery } from "./common";

export interface PlayerNotePerson {
	id: string;
	username: string;
	displayName: string;
	avatar: string;
}

export interface PlayerNote {
	id: string;
	target: PlayerNotePerson | null;
	author: PlayerNotePerson | null;
	tournament: { id: number; name: string } | null;
	category: PlayerNoteCategory;
	severity: PlayerNoteSeverity;
	content: string;
	resolved: boolean;
	resolvedAt: string | null;
	resolvedBy: PlayerNotePerson | null;
	createdAt: string;
	updatedAt: string;
	/** Registre Drive où le signalement a été consigné (null si Drive non configuré). */
	docsUrl: string | null;
}

export interface PlayerNoteListResponse {
	data: PlayerNote[];
	total: number;
	meta: { page: number; pageSize: number; pageCount: number; isStaff: boolean };
}

export interface PlayerNoteFilters extends PageQuery {
	targetId?: string;
	tournamentId?: number;
	category?: PlayerNoteCategory;
	severity?: PlayerNoteSeverity;
	resolved?: boolean;
}

export interface CreatePlayerNotePayload {
	targetId: string;
	tournamentId?: number | null;
	category?: PlayerNoteCategory;
	severity?: PlayerNoteSeverity;
	content: string;
}

export interface PlayerNoteSummary {
	total: number;
	open: number;
	bySeverity: Record<PlayerNoteSeverity, number>;
}

/** Filtres additionnels acceptés par la liste des notes. */
export interface PlayerNoteFiltersExtra {
	category?: PlayerNoteCategory;
	severity?: PlayerNoteSeverity;
	search?: string;
}
