/**
 * `/users` et `/misc/suggest` — profils, classement, tendance, carte joueur,
 * autocomplétion globale.
 */

import { z } from "zod";

import type {
	LeaderboardPage,
	RankedHistoryEntry,
	RankedTrend,
} from "@rosegriffon/achillea-types/domain/ranked";
import type { Suggestion, SuggestionRank } from "@rosegriffon/achillea-types/domain/suggestion";
import type {
	EnrichedUserDTO,
	UpdateUserProfilePayload,
} from "@rosegriffon/achillea-types/domain/user";
import type { MatchMode } from "@rosegriffon/achillea-types/enums/eventEnums";

import {
	apiDateSchema,
	enrichedUserDtoSchema,
	matchModeSchema,
	rankDtoSchema,
	userRoleSchema,
} from "./common";
import {
	AchilleaResource,
	encodePathSegment,
	type AchilleaClientResult,
} from "./http";
import type { ImageGenerationResult } from "./pending-contracts";
import { leaderboardPageSchema, rankedHistoryEntrySchema, rankedTrendSchema } from "./ranked";

/** `SuggestionRank` est un alias de `RankDTO` : même schéma, même contrat. */
export const suggestionRankSchema = rankDtoSchema satisfies z.ZodType<SuggestionRank>;

export const suggestionSchema = z.object({
	id: z.string(),
	type: z.enum(["clan", "user"]),
	label: z.string(),
	sim: z.number(),
	clanShortName: z.string().optional(),
	avatar: z.string().optional(),
	soloRank: suggestionRankSchema,
	duoRank: suggestionRankSchema,
	lastInteract: apiDateSchema.optional(),
	role: userRoleSchema.optional(),
	currentLevel: z.number().optional(),
	totalXp: z.number().optional(),
	hasTwitch: z.boolean().optional(),
	hasChallonge: z.boolean().optional(),
	hasYoutube: z.boolean().optional(),
}) satisfies z.ZodType<Suggestion>;

export const userProfileFieldsSchema = z.object({
	bio: z.string().nullable(),
	twitchUrl: z.string().nullable(),
});

/** Champs éditables renvoyés par `PUT /users/me/profile`. */
export type UserProfileFields = z.infer<typeof userProfileFieldsSchema>;

export const imageGenerationResultSchema = z.object({
	success: z.boolean(),
	path: z.string().optional(),
	error: z.string().optional(),
}) satisfies z.ZodType<ImageGenerationResult>;

const avatarResyncSchema = z.object({ started: z.boolean() });

export type LeaderboardQuery = {
	mode?: MatchMode | number;
	season?: string | null;
	limit?: number;
	offset?: number;
}

export type RankedHistoryQuery = {
	mode?: MatchMode | number;
	limit?: number;
	offset?: number;
}

export type RankedTrendQuery = {
	mode?: MatchMode | number;
	days?: number;
	last?: number;
}

/** 11 routes (`/users` + `/misc/suggest`). */
export class UsersResource extends AchilleaResource {
	/** `GET /users/:id` — profil public enrichi (clan, stats, ranked). */
	get(id: string): Promise<AchilleaClientResult<EnrichedUserDTO>> {
		return this.http.get(`/users/${encodePathSegment(id)}`, enrichedUserDtoSchema);
	}

	/** `GET /users/leaderboard` — classement Elo enrichi (public, mis en cache CDN). */
	leaderboard(query: LeaderboardQuery = {}): Promise<AchilleaClientResult<LeaderboardPage>> {
		return this.http.get("/users/leaderboard", leaderboardPageSchema, {
			query,
		});
	}

	/** `GET /users/me/ranked-history` — historique des matchs classés du compte connecté. */
	myRankedHistory(
		query: RankedHistoryQuery = {}
	): Promise<AchilleaClientResult<RankedHistoryEntry[]>> {
		return this.http.get("/users/me/ranked-history", z.array(rankedHistoryEntrySchema), {
			query,
		});
	}

	/** `GET /users/:id/ranked-history` — résultats publics d'un joueur. */
	rankedHistory(id: string, query: RankedHistoryQuery = {}): Promise<AchilleaClientResult<RankedHistoryEntry[]>> {
		return this.http.get(`/users/${encodePathSegment(id)}/ranked-history`, z.array(rankedHistoryEntrySchema), { query });
	}

	/** `GET /users/me/ranked-trend` — sparkline Elo et bilan sur la période. */
	myRankedTrend(query: RankedTrendQuery = {}): Promise<AchilleaClientResult<RankedTrend>> {
		return this.http.get("/users/me/ranked-trend", rankedTrendSchema, {
			query,
		});
	}

	/** `PUT /users/me/profile` — bio et lien Twitch du titulaire uniquement. */
	updateMyProfile(
		payload: UpdateUserProfilePayload
	): Promise<AchilleaClientResult<UserProfileFields>> {
		return this.http.put("/users/me/profile", userProfileFieldsSchema, payload);
	}

	/** URL de `GET /users/:id/card.png` — carte joueur, à poser dans un `<img>`. */
	cardUrl(id: string): string {
		return this.http.url(`/users/${encodePathSegment(id)}/card.png`);
	}

	/** `GET /users/:id/card.png` — carte joueur en PNG. */
	card(id: string): Promise<AchilleaClientResult<ArrayBuffer>> {
		return this.http.requestBytes(`/users/${encodePathSegment(id)}/card.png`);
	}

	/** `POST /users/:id/card/regenerate` — régénère et archive la carte (authentifié). */
	regenerateCard(id: string): Promise<AchilleaClientResult<ImageGenerationResult>> {
		return this.http.post(
			`/users/${encodePathSegment(id)}/card/regenerate`,
			imageGenerationResultSchema
		);
	}

	/** `POST /users/resync-avatars` — réindexation des avatars Discord (admin, asynchrone). */
	resyncAvatars(): Promise<AchilleaClientResult<{ started: boolean }>> {
		return this.http.post("/users/resync-avatars", avatarResyncSchema);
	}

	/** `GET /misc/suggest/users` — autocomplétion joueurs. */
	suggestUsers(query: string): Promise<AchilleaClientResult<Suggestion[]>> {
		return this.http.get("/misc/suggest/users", z.array(suggestionSchema), { query: { query } });
	}

	/** `GET /misc/suggest/clans` — autocomplétion clans. */
	suggestClans(query: string): Promise<AchilleaClientResult<Suggestion[]>> {
		return this.http.get("/misc/suggest/clans", z.array(suggestionSchema), { query: { query } });
	}

	/** `GET /misc/suggest/all` — autocomplétion mixte clans + joueurs (barre de recherche). */
	suggestAll(query: string): Promise<AchilleaClientResult<Suggestion[]>> {
		return this.http.get("/misc/suggest/all", z.array(suggestionSchema), { query: { query } });
	}
}

/** Réexport utilitaire : le mode de jeu sert de paramètre à plusieurs ressources. */
export { matchModeSchema };
