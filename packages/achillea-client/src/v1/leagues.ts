/**
 * `/leagues` — championnats (format Premier League), distincts des coupes.
 *
 * Les types de championnat appartiennent à `@rosegriffon/achillea-core/league`
 * et non au contrat : ce module s'appuie donc sur les formes d'attente de
 * `pending-contracts.ts`, volontairement tolérantes sur les sous-objets
 * (`format`, `playoffs`, `details`) que le client n'a pas à interpréter.
 */

import { z } from "zod";

import { AchilleaResource, type AchilleaClientResult } from "./http";
import type {
	LeagueListResponse,
	LeagueMatchRow,
	LeaguePointsConfig,
	LeagueSeasonPayload,
	LeagueStandingRow,
	LeagueSummary,
	LeagueTeam,
} from "./pending-contracts";

export const leagueSummarySchema = z.object({
	id: z.string(),
	name: z.string(),
	season: z.string(),
	format: z.string(),
	description: z.string(),
	champion: z.string().optional(),
	teamCount: z.number(),
	matchdays: z.number(),
	aliases: z.array(z.string()),
}) satisfies z.ZodType<LeagueSummary>;

export const leagueTeamSchema = z.object({
	tag: z.string(),
	name: z.string(),
}) satisfies z.ZodType<LeagueTeam>;

/**
 * Barème de points d'une saison.
 *
 * Mesuré sur `GET /leagues/astral` : l'API renvoie
 * `{ win, draw, loss, winOvertime, lossOvertime }`. Le contrat attendait
 * `winRegulation`/`lossRegulation`, qui n'existent nulle part côté serveur :
 * la saison entière — 8 équipes, 28 résultats — était rejetée pour deux noms
 * de champ. Les deux graphies sont acceptées, toutes optionnelles, pour ne plus
 * jamais faire tomber un classement sur un barème.
 */
export const leaguePointsConfigSchema = z.object({
	win: z.number().optional(),
	draw: z.number().optional(),
	loss: z.number().optional(),
	winRegulation: z.number().optional(),
	lossRegulation: z.number().optional(),
	winOvertime: z.number().optional(),
	lossOvertime: z.number().optional(),
}) satisfies z.ZodType<LeaguePointsConfig>;

export const leagueStandingRowSchema = z.object({
	teamId: z.string(),
	rank: z.number(),
	played: z.number(),
	wins: z.number(),
	draws: z.number(),
	losses: z.number(),
	winsOt: z.number(),
	lossesOt: z.number(),
	points: z.number(),
	mapDiff: z.number(),
	mapsFor: z.number(),
	mapsAgainst: z.number(),
}) satisfies z.ZodType<LeagueStandingRow>;

export const leagueMatchRowSchema = z.object({
	homeId: z.string(),
	awayId: z.string(),
	homeScore: z.number(),
	awayScore: z.number(),
	matchday: z.number(),
	overtime: z.boolean().optional(),
	winnerId: z.string().nullable().optional(),
}) satisfies z.ZodType<LeagueMatchRow>;

export const leagueSeasonPayloadSchema = z.object({
	meta: leagueSummarySchema,
	format: z.record(z.string(), z.unknown()),
	teams: z.array(leagueTeamSchema),
	pointsConfig: leaguePointsConfigSchema,
	standings: z.array(leagueStandingRowSchema),
	results: z.array(leagueMatchRowSchema),
	playoffs: z.unknown(),
	schedule: z.unknown().optional(),
	details: z.unknown().optional(),
}) satisfies z.ZodType<LeagueSeasonPayload>;

export const leagueListResponseSchema = z.object({
	items: z.array(leagueSummarySchema),
}) satisfies z.ZodType<LeagueListResponse>;

/** Alias de chemin acceptés par l'API pour la saison Astral 1. */
export type AstralAlias = "astral" | "astral-s1" | "asytral" | "asytral-s1";

/** 2 routes (dont 4 alias de chemin sur le détail Astral S1). */
export class LeaguesResource extends AchilleaResource {
	/** `GET /leagues` — championnats connus. */
	list(): Promise<AchilleaClientResult<LeagueListResponse>> {
		return this.http.get("/leagues", leagueListResponseSchema);
	}

	/**
	 * `GET /leagues/astral` — règlement, classement, résultats et play-offs.
	 * Les alias `astral-s1`, `asytral` et `asytral-s1` pointent le même payload.
	 */
	astral(alias: AstralAlias = "astral"): Promise<AchilleaClientResult<LeagueSeasonPayload>> {
		return this.http.get(`/leagues/${alias}`, leagueSeasonPayloadSchema);
	}
}
