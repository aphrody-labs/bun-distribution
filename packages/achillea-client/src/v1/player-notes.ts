/**
 * `/player-notes` — notes du staff sur les joueurs.
 *
 * Aucune de ces routes n'est publique et rien n'est jamais renvoyé au joueur
 * concerné : l'API tranche à chaque appel entre staff (accès complet) et
 * organisateur (le périmètre de son tournoi).
 */

import { z } from "zod";

import type {
	CreatePlayerNotePayload,
	PlayerNote,
	PlayerNoteFilters,
	PlayerNoteListResponse,
	PlayerNotePerson,
} from "@rosegriffon/achillea-types/domain/player-note";
import {
	PlayerNoteCategory,
	PlayerNoteSeverity,
} from "@rosegriffon/achillea-types/enums/eventEnums";

import { successResponseSchema } from "./common";
import {
	AchilleaResource,
	encodePathSegment,
	type AchilleaClientResult,
	type QueryParams,
} from "./http";
import type {
	PlayerNoteFiltersExtra,
	PlayerNoteSummary,
	SuccessResponse,
} from "./pending-contracts";

export const playerNoteCategorySchema = z.enum(
	PlayerNoteCategory
) satisfies z.ZodType<PlayerNoteCategory>;
export const playerNoteSeveritySchema = z.enum(
	PlayerNoteSeverity
) satisfies z.ZodType<PlayerNoteSeverity>;

export const playerNotePersonSchema = z.object({
	id: z.string(),
	username: z.string(),
	displayName: z.string(),
	avatar: z.string(),
}) satisfies z.ZodType<PlayerNotePerson>;

export const playerNoteSchema = z.object({
	id: z.string(),
	target: playerNotePersonSchema.nullable(),
	author: playerNotePersonSchema.nullable(),
	tournament: z.object({ id: z.number(), name: z.string() }).nullable(),
	category: playerNoteCategorySchema,
	severity: playerNoteSeveritySchema,
	content: z.string(),
	resolved: z.boolean(),
	resolvedAt: z.string().nullable(),
	resolvedBy: playerNotePersonSchema.nullable(),
	createdAt: z.string(),
	updatedAt: z.string(),
	docsUrl: z.string().nullable(),
}) satisfies z.ZodType<PlayerNote>;

export const playerNoteListResponseSchema = z.object({
	data: z.array(playerNoteSchema),
	total: z.number(),
	meta: z.object({
		page: z.number(),
		pageSize: z.number(),
		pageCount: z.number(),
		isStaff: z.boolean(),
	}),
}) satisfies z.ZodType<PlayerNoteListResponse>;

export const playerNoteSummarySchema = z.object({
	total: z.number(),
	open: z.number(),
	bySeverity: z.object({
		[PlayerNoteSeverity.INFO]: z.number(),
		[PlayerNoteSeverity.WARNING]: z.number(),
		[PlayerNoteSeverity.SERIOUS]: z.number(),
	}),
}) satisfies z.ZodType<PlayerNoteSummary>;

/** Champs modifiables par `PUT /player-notes/:id`. */
export type UpdatePlayerNotePayload = Partial<
	Pick<CreatePlayerNotePayload, "category" | "severity" | "content" | "tournamentId">
>;

/** Filtres complets acceptés par `GET /player-notes` (recherche plein texte comprise). */
export type PlayerNoteQuery = PlayerNoteFilters & PlayerNoteFiltersExtra;

/** 7 routes. */
export class PlayerNotesResource extends AchilleaResource {
	/** `GET /player-notes` — liste filtrée ; un organisateur doit passer `tournamentId`. */
	list(query: PlayerNoteQuery = {}): Promise<AchilleaClientResult<PlayerNoteListResponse>> {
		return this.http.get("/player-notes", playerNoteListResponseSchema, {
			query: query as QueryParams,
		});
	}

	/** `GET /player-notes/summary/:userId` — compteurs pour une fiche joueur. */
	summary(userId: string): Promise<AchilleaClientResult<PlayerNoteSummary>> {
		return this.http.get(
			`/player-notes/summary/${encodePathSegment(userId)}`,
			playerNoteSummarySchema
		);
	}

	/** `POST /player-notes` — consigne une observation sur un joueur. */
	create(payload: CreatePlayerNotePayload): Promise<AchilleaClientResult<PlayerNote>> {
		return this.http.post("/player-notes", playerNoteSchema, payload);
	}

	/** `PUT /player-notes/:id` — modifie une note existante. */
	update(
		id: string,
		patch: UpdatePlayerNotePayload
	): Promise<AchilleaClientResult<PlayerNote>> {
		return this.http.put(`/player-notes/${encodePathSegment(id)}`, playerNoteSchema, patch);
	}

	/** `POST /player-notes/:id/resolve` — marque la note comme traitée. */
	resolve(id: string): Promise<AchilleaClientResult<PlayerNote>> {
		return this.http.post(`/player-notes/${encodePathSegment(id)}/resolve`, playerNoteSchema);
	}

	/** `POST /player-notes/:id/reopen` — rouvre une note traitée. */
	reopen(id: string): Promise<AchilleaClientResult<PlayerNote>> {
		return this.http.post(`/player-notes/${encodePathSegment(id)}/reopen`, playerNoteSchema);
	}

	/** `DELETE /player-notes/:id` — supprime une note. */
	remove(id: string): Promise<AchilleaClientResult<SuccessResponse>> {
		return this.http.delete(`/player-notes/${encodePathSegment(id)}`, successResponseSchema);
	}
}
