/**
 * Primitives de schéma partagées par toutes les ressources.
 *
 * Chaque schéma est verrouillé sur le DTO correspondant de
 * `@rosegriffon/achillea-types` via `satisfies z.ZodType<…>` : si le contrat
 * change et que le schéma ne suit pas, le `type-check` casse.
 */

import { z } from "zod";

import type {
	Column,
	Country,
	PageMeta,
	PageSizeMeta,
	Paginated,
	PagedList,
	SocialMediaDTO,
} from "@rosegriffon/achillea-types/domain/common";
import { SocialMedia } from "@rosegriffon/achillea-types/domain/common";
import type {
	CompetitionStats,
	EnrichedUserDTO,
	RankDTO,
	RankedModeStats,
	UserClanSummary,
	UserDTO,
	UserRef,
} from "@rosegriffon/achillea-types/domain/user";
import {
	ClanMemberDistinction,
	ClanMemberRole,
} from "@rosegriffon/achillea-types/enums/clanMemberRole";
import { MatchMode } from "@rosegriffon/achillea-types/enums/eventEnums";
import { UserRole } from "@rosegriffon/achillea-types/enums/userRole";

import type { ApiEnvelope, SuccessResponse } from "./pending-contracts";

/** Horodatage ISO renvoyé par l'API, normalisé en `Date` côté client. */
export const apiDateSchema = z.coerce.date();

/** Les enums de contrat, en version runtime. */
export const userRoleSchema = z.enum(UserRole) satisfies z.ZodType<UserRole>;
export const matchModeSchema = z.enum(MatchMode) satisfies z.ZodType<MatchMode>;
export const clanMemberRoleSchema = z.enum(ClanMemberRole) satisfies z.ZodType<ClanMemberRole>;
export const clanMemberDistinctionSchema = z.enum(
	ClanMemberDistinction
) satisfies z.ZodType<ClanMemberDistinction>;
export const socialMediaSchema = z.enum(SocialMedia) satisfies z.ZodType<SocialMedia>;

/**
 * Métadonnées de pagination.
 *
 * Mesuré sur `GET /clans` : l'API renvoie `{ total, pageCount: null }` — ni
 * `page`, ni `limit`, et `pageCount` peut valoir `null` quand le total tient en
 * une page. Les exiger faisait échouer la validation de la réponse ENTIÈRE,
 * donc effaçait les 42 clans pour une histoire de compteur.
 *
 * Une enveloppe de pagination ne doit jamais pouvoir invalider sa charge utile.
 */
export const pageMetaSchema = z.object({
	page: z.number().optional(),
	limit: z.number().optional(),
	total: z.number(),
	pageCount: z.number().nullable().optional(),
}) satisfies z.ZodType<PageMeta>;

export const pageSizeMetaSchema = z.object({
	page: z.number(),
	pageSize: z.number(),
	pageCount: z.number(),
}) satisfies z.ZodType<PageSizeMeta>;

/** Enveloppe `{ data, meta }` des contrôleurs historiques. */
export function paginatedSchema<T>(item: z.ZodType<T>): z.ZodType<Paginated<T>> {
	return z.object({ data: z.array(item), meta: pageMetaSchema });
}

/** Enveloppe `{ data, total, meta }` des contrôleurs récents (casts, sanctions…). */
export function pagedListSchema<T>(item: z.ZodType<T>): z.ZodType<PagedList<T>> {
	return z.object({ data: z.array(item), total: z.number(), meta: pageSizeMetaSchema });
}

/** Enveloppe `{ success, data?, error? }` des contrôleurs clans / organisations. */
export function apiEnvelopeSchema<T>(payload: z.ZodType<T>): z.ZodType<ApiEnvelope<T>> {
	return z.object({
		success: z.boolean(),
		data: payload.optional(),
		error: z.string().optional(),
	});
}

export const successResponseSchema = z.object({
	success: z.boolean(),
	error: z.string().optional(),
}) satisfies z.ZodType<SuccessResponse>;

/** Corps `{ ok: true }` des routes ranked et de la déconnexion. */
export const okResponseSchema = z.object({ ok: z.boolean() });

export const columnSchema = z.object({
	field: z.string(),
	header: z.string(),
}) satisfies z.ZodType<Column>;

export const countrySchema = z.object({
	code: z.string(),
	language: z.string(),
	flag: z.string(),
	name: z.string(),
}) satisfies z.ZodType<Country>;

export const socialMediaDtoSchema = z.object({
	platform: socialMediaSchema,
	username: z.string(),
	canonicalUrl: z.string(),
}) satisfies z.ZodType<SocialMediaDTO>;

export const rankDtoSchema = z.object({
	elo: z.number(),
	key: z.string(),
	gradient: z.array(z.string()),
}) satisfies z.ZodType<RankDTO>;

export const userDtoSchema = z.object({
	id: z.string(),
	type: z.string().optional(),
	username: z.string(),
	rgProfileUsername: z.string().optional(),
	sim: z.number().optional(),
	avatar: z.string().optional(),
	// Le backend retourne explicitement `null` pour un joueur sans clan.
	// `optional()` seul rejetait la réponse entière des tournois concernés.
	clanId: z.number().nullable().optional(),
	soloRank: rankDtoSchema.optional(),
	duoRank: rankDtoSchema.optional(),
	lastInteract: apiDateSchema.optional(),
	role: userRoleSchema.optional(),
	currentLevel: z.number().optional(),
	totalXp: z.number().optional(),
	hasTwitch: z.boolean().optional(),
	hasChallonge: z.boolean().optional(),
	hasYoutube: z.boolean().optional(),
}) satisfies z.ZodType<UserDTO>;

export const userRefSchema = z.object({
	id: z.string(),
	username: z.string(),
	displayName: z.string().optional(),
	avatar: z.string().nullable().optional(),
}) satisfies z.ZodType<UserRef>;

export const rankedModeStatsSchema = z.object({
	mode: matchModeSchema,
	total: z.number(),
	wins: z.number(),
	losses: z.number(),
	draws: z.number(),
	goalsScored: z.number(),
	goalsReceived: z.number(),
}) satisfies z.ZodType<RankedModeStats>;

export const competitionStatsSchema = z.object({
	total: z.number(),
	wins: z.number(),
	losses: z.number(),
	draws: z.number(),
	goalsScoredAvg: z.number(),
	goalsReceivedAvg: z.number(),
	personalTotal: z.number(),
	personalWins: z.number(),
	personalLosses: z.number(),
	personalDraws: z.number(),
}) satisfies z.ZodType<CompetitionStats>;

export const userClanSummarySchema = z.object({
	id: z.number(),
	shortenedName: z.string(),
	name: z.string(),
	avatarUrl: z.string().optional(),
	role: clanMemberRoleSchema,
	distinctions: z.array(clanMemberDistinctionSchema),
}) satisfies z.ZodType<UserClanSummary>;

export const enrichedUserDtoSchema = userDtoSchema.extend({
	clan: userClanSummarySchema.optional(),
	interclans: competitionStatsSchema,
	tournaments: competitionStatsSchema,
	ranked: z.object({ solo: rankedModeStatsSchema, duo: rankedModeStatsSchema }),
	bio: z.string().nullable(),
	twitchUrl: z.string().nullable(),
}) satisfies z.ZodType<EnrichedUserDTO>;
