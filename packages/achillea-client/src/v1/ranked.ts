/**
 * `/ranked` et son versant administration (`/admin/lobbies`, `/admin/ranked`,
 * `/admin/seasons`).
 *
 * Ces routes sont servies par le serveur Express du sous-process ranked, devant
 * le proxy qui relaie le reste de `/api` vers les contrôleurs TSed. Vu du
 * client, tout est relatif à la même `baseUrl`.
 */

import { z } from "zod";

import type {
  LeaderboardEntry,
  LeaderboardPage,
  RankedActiveMatch,
  RankedActivePlayer,
  RankedAdminDispute,
  RankedAdminSeason,
  RankedAdminValidateRequest,
  RankedChallengeLink,
  RankedChallengePreview,
  RankedDisputePlayer,
  RankedHistoryEntry,
  RankedMatchEvent,
  RankedOverview,
  RankedProfile,
  RankedSeasonConfig,
  RankedSeasonInput,
  RankedTierInfo,
  RankedTrend,
  RankTier,
} from "@rosegriffon/achillea-types/domain/ranked";
import type { MatchMode } from "@rosegriffon/achillea-types/enums/eventEnums";

import { matchModeSchema, okResponseSchema } from "./common";
import { AchilleaResource, encodePathSegment, type AchilleaClientResult } from "./http";
import type {
  RankedAdminValidateResult,
  RankedChallengeAccepted,
  RankedLadderResetResult,
  RankedProofUploaded,
} from "./pending-contracts";

// ── Schémas ─────────────────────────────────────────────────────────────────

export const rankTierSchema = z.object({
  key: z.string(),
  minElo: z.number(),
  maxElo: z.number(),
  emojiId: z.string(),
  emojiKey: z.string(),
  gradient: z.array(z.string()),
}) satisfies z.ZodType<RankTier>;

export const rankedProfileSchema = z.object({
  userId: z.string(),
  mode: matchModeSchema,
  elo: z.number(),
  peakRating: z.number(),
  gamesPlayed: z.number(),
  wins: z.number(),
  losses: z.number(),
  tier: rankTierSchema.nullable(),
  seasonId: z.string().nullable(),
  globalRank: z.number().nullable().optional(),
  totalPlayers: z.number().optional(),
  percentile: z.number().nullable().optional(),
}) satisfies z.ZodType<RankedProfile>;

export const rankedTierInfoSchema = z.object({
  key: z.string(),
  minElo: z.number(),
  maxElo: z.number(),
  gradient: z.array(z.string()),
  emojiId: z.string().nullable(),
  emojiKey: z.string().nullable(),
  playerCount: z.number(),
}) satisfies z.ZodType<RankedTierInfo>;

export const leaderboardEntrySchema = z.object({
  rank: z.number(),
  userId: z.string(),
  displayName: z.string(),
  avatar: z.string(),
  elo: z.number(),
  peakRating: z.number(),
  gamesPlayed: z.number(),
}) satisfies z.ZodType<LeaderboardEntry>;

export const leaderboardPageSchema = z.object({
  entries: z.array(leaderboardEntrySchema),
  total: z.number(),
  mode: matchModeSchema,
}) satisfies z.ZodType<LeaderboardPage>;

const opponentSchema = z.object({
  userId: z.string(),
  displayName: z.string(),
  avatar: z.string(),
});

export const rankedHistoryEntrySchema = z.object({
  lobbyId: z.number(),
  mode: matchModeSchema,
  state: z.string(),
  endedAt: z.string(),
  myScore: z.number(),
  opponentScore: z.number(),
  eloDelta: z.number(),
  result: z.enum(["win", "loss", "draw", "forfeit"]),
  opponent: opponentSchema,
}) satisfies z.ZodType<RankedHistoryEntry>;

export const rankedTrendSchema = z.object({
  sparkline: z.array(z.number()),
  deltaPeriod: z.number(),
  gamesInPeriod: z.number(),
  winRatePeriod: z.number(),
  days: z.number(),
}) satisfies z.ZodType<RankedTrend>;

export const rankedChallengeLinkSchema = z.object({
  code: z.string(),
  url: z.string(),
  mode: matchModeSchema,
  ranked: z.boolean(),
  toUserId: z.string().nullable(),
  expiresAt: z.number(),
}) satisfies z.ZodType<RankedChallengeLink>;

export const rankedChallengePreviewSchema = z.object({
  code: z.string(),
  fromUserId: z.string(),
  fromDisplayName: z.string(),
  fromAvatar: z.string(),
  fromElo: z.number(),
  mode: matchModeSchema,
  ranked: z.boolean(),
  isOwn: z.boolean(),
  expiresAt: z.number(),
}) satisfies z.ZodType<RankedChallengePreview>;

export const rankedChallengeAcceptedSchema = z.object({
  reservation: z.unknown(),
  mode: z.number(),
  ranked: z.boolean(),
}) satisfies z.ZodType<RankedChallengeAccepted>;

export const rankedProofUploadedSchema = z.object({
  url: z.string(),
}) satisfies z.ZodType<RankedProofUploaded>;

export const rankedDisputePlayerSchema = z.object({
  userId: z.string(),
  displayName: z.string(),
  submittedScore: z.number(),
  claimedOpponentScore: z.number().nullable().optional(),
  screenshotUrl: z.string().nullable().optional(),
}) satisfies z.ZodType<RankedDisputePlayer>;

export const rankedAdminDisputeSchema = z.object({
  lobbyId: z.number(),
  mode: matchModeSchema,
  player1: rankedDisputePlayerSchema,
  player2: rankedDisputePlayerSchema,
  createdAt: z.string(),
}) satisfies z.ZodType<RankedAdminDispute>;

export const rankedActivePlayerSchema = z.object({
  userId: z.string(),
  displayName: z.string(),
  score: z.number(),
  claimedOpponentScore: z.number().nullable(),
  submitted: z.boolean(),
  hasProof: z.boolean(),
}) satisfies z.ZodType<RankedActivePlayer>;

export const rankedActiveMatchSchema = z.object({
  lobbyId: z.number(),
  mode: matchModeSchema,
  createdAt: z.string(),
  player1: rankedActivePlayerSchema,
  player2: rankedActivePlayerSchema,
}) satisfies z.ZodType<RankedActiveMatch>;

export const rankedOverviewSchema = z.object({
  activeMatches: z.number(),
  contestedMatches: z.number(),
  finishedToday: z.number(),
  matchesToday: z.number(),
  totalPlayers: z.number(),
}) satisfies z.ZodType<RankedOverview>;

export const rankedMatchEventSchema = z.object({
  id: z.number(),
  createdAt: z.string(),
  lobbyId: z.number().nullable(),
  roomCode: z.string().nullable(),
  mode: z.number().nullable(),
  userId: z.string().nullable(),
  displayName: z.string().nullable(),
  type: z.string(),
  detail: z.record(z.string(), z.unknown()),
}) satisfies z.ZodType<RankedMatchEvent>;

export const rankedSeasonConfigSchema = z.object({
  kFactor: z.number(),
  baseRating: z.number(),
  decayRate: z.number(),
}) satisfies z.ZodType<RankedSeasonConfig>;

const DEFAULT_SEASON_CONFIG: RankedSeasonConfig = { kFactor: 32, baseRating: 0, decayRate: 0 };

/**
 * Les routes `/admin/seasons` renvoient la ligne SQL brute (snake_case) —
 * le schéma la normalise vers le DTO `RankedAdminSeason` du contrat.
 */
export const rankedAdminSeasonSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    state: z.enum(["Upcoming", "Active", "Closed"]),
    starts_at: z.string(),
    ends_at: z.string(),
    config: rankedSeasonConfigSchema.nullable(),
    player_count: z.number(),
  })
  .transform(row => ({
    id: row.id,
    name: row.name,
    state: row.state,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    config: row.config ?? DEFAULT_SEASON_CONFIG,
    playerCount: row.player_count,
  })) satisfies z.ZodType<RankedAdminSeason>;

export const rankedAdminValidateResultSchema = z.object({
  ok: z.boolean(),
  eloDelta: z.number().optional(),
}) satisfies z.ZodType<RankedAdminValidateResult>;

export const rankedLadderResetResultSchema = z.object({
  ok: z.boolean(),
  affected: z.number(),
}) satisfies z.ZodType<RankedLadderResetResult>;

// ── Paramètres d'appel ──────────────────────────────────────────────────────

export type RankedLeaderboardQuery = {
  mode?: MatchMode | number;
  /** Pagination base 0, comme l'attend le serveur ranked. */
  page?: number;
  pageSize?: number;
  /** Recherche globale par pseudo / nom affiché. */
  search?: string;
  /** Bornes Elo inclusives, notamment pour filtrer par palier public. */
  minElo?: number;
  maxElo?: number;
};

export type RankedTelemetryQuery = {
  lobbyId?: number;
  roomCode?: string;
  userId?: string;
  limit?: number;
};

export interface CreateChallengePayload {
  mode?: MatchMode | number;
  /** `false` pour une partie amicale (aucun Elo appliqué). */
  ranked?: boolean;
  /** Revanche ciblée : le joueur visé reçoit une notification temps réel. */
  toUserId?: string | null;
}

/** 19 routes (8 joueur + 11 administration). */
export class RankedResource extends AchilleaResource {
  // ── Joueur ────────────────────────────────────────────────────────────────

  /** `GET /ranked/me` — profil Elo du compte connecté pour un mode. */
  me(mode?: MatchMode | number): Promise<AchilleaClientResult<RankedProfile>> {
    return this.http.get("/ranked/me", rankedProfileSchema, { query: { mode } });
  }

  /** `GET /ranked/tiers` — paliers de la saison active et effectifs. */
  tiers(mode?: MatchMode | number): Promise<AchilleaClientResult<RankedTierInfo[]>> {
    return this.http.get("/ranked/tiers", z.array(rankedTierInfoSchema), { query: { mode } });
  }

  /** `GET /ranked/leaderboard` — classement live de la saison active. */
  leaderboard(query: RankedLeaderboardQuery = {}): Promise<AchilleaClientResult<LeaderboardPage>> {
    return this.http.get("/ranked/leaderboard", leaderboardPageSchema, {
      query,
    });
  }

  /** `POST /ranked/challenge` — crée un lien de défi partageable. */
  createChallenge(payload: CreateChallengePayload = {}): Promise<AchilleaClientResult<RankedChallengeLink>> {
    return this.http.post("/ranked/challenge", rankedChallengeLinkSchema, payload);
  }

  /** `GET /ranked/challenge/:code` — aperçu d'un défi reçu. */
  getChallenge(code: string): Promise<AchilleaClientResult<RankedChallengePreview>> {
    return this.http.get(`/ranked/challenge/${encodePathSegment(code)}`, rankedChallengePreviewSchema);
  }

  /** `POST /ranked/challenge/:code/accept` — accepte un défi et crée le match. */
  acceptChallenge(code: string): Promise<AchilleaClientResult<RankedChallengeAccepted>> {
    return this.http.post(`/ranked/challenge/${encodePathSegment(code)}/accept`, rankedChallengeAcceptedSchema);
  }

  /** `DELETE /ranked/challenge/:code` — l'inviteur annule son défi en attente. */
  cancelChallenge(code: string): Promise<AchilleaClientResult<{ ok: boolean }>> {
    return this.http.delete(`/ranked/challenge/${encodePathSegment(code)}`, okResponseSchema);
  }

  /**
   * `POST /ranked/:lobbyId/dispute` — dépose la capture de preuve d'un litige.
   * Le corps est la capture encodée en data-URL base64, envoyée en `text/plain`.
   */
  uploadDisputeProof(lobbyId: number, dataUrl: string): Promise<AchilleaClientResult<RankedProofUploaded>> {
    return this.http.requestJson(`/ranked/${encodePathSegment(lobbyId)}/dispute`, rankedProofUploadedSchema, {
      method: "POST",
      rawBody: dataUrl,
      contentType: "text/plain",
    });
  }

  // ── Administration ────────────────────────────────────────────────────────

  /** `GET /admin/lobbies/disputes` — matchs contestés en attente d'arbitrage. */
  adminDisputes(): Promise<AchilleaClientResult<RankedAdminDispute[]>> {
    return this.http.get("/admin/lobbies/disputes", z.array(rankedAdminDisputeSchema));
  }

  /** `GET /admin/lobbies/active` — matchs en cours et leur état live. */
  adminActiveMatches(): Promise<AchilleaClientResult<RankedActiveMatch[]>> {
    return this.http.get("/admin/lobbies/active", z.array(rankedActiveMatchSchema));
  }

  /** `POST /admin/lobbies/:id/validate` — l'arbitre tranche un litige. */
  adminValidateLobby(
    lobbyId: number,
    payload: RankedAdminValidateRequest,
  ): Promise<AchilleaClientResult<RankedAdminValidateResult>> {
    return this.http.post(
      `/admin/lobbies/${encodePathSegment(lobbyId)}/validate`,
      rankedAdminValidateResultSchema,
      payload,
    );
  }

  /** `POST /admin/lobbies/:id/cancel` — annule le match, sans aucun effet Elo. */
  adminCancelLobby(lobbyId: number): Promise<AchilleaClientResult<{ ok: boolean }>> {
    return this.http.post(`/admin/lobbies/${encodePathSegment(lobbyId)}/cancel`, okResponseSchema);
  }

  /** `GET /admin/ranked/overview` — compteurs synthétiques du ranked. */
  adminOverview(): Promise<AchilleaClientResult<RankedOverview>> {
    return this.http.get("/admin/ranked/overview", rankedOverviewSchema);
  }

  /** `GET /admin/ranked/telemetry` — journal du flux des matchs. */
  adminTelemetry(query: RankedTelemetryQuery = {}): Promise<AchilleaClientResult<RankedMatchEvent[]>> {
    return this.http.get("/admin/ranked/telemetry", z.array(rankedMatchEventSchema), {
      query,
    });
  }

  /** `GET /admin/seasons` — saisons, de la plus récente à la plus ancienne. */
  adminSeasons(): Promise<AchilleaClientResult<RankedAdminSeason[]>> {
    return this.http.get("/admin/seasons", z.array(rankedAdminSeasonSchema));
  }

  /** `POST /admin/seasons` — crée une saison à l'état `Upcoming`. */
  adminCreateSeason(payload: RankedSeasonInput): Promise<AchilleaClientResult<RankedAdminSeason>> {
    return this.http.post("/admin/seasons", rankedAdminSeasonSchema, payload);
  }

  /** `PATCH /admin/seasons/:id` — modification partielle d'une saison. */
  adminUpdateSeason(
    id: string,
    patch: Partial<RankedSeasonInput> & { state?: RankedAdminSeason["state"] },
  ): Promise<AchilleaClientResult<RankedAdminSeason>> {
    return this.http.patch(`/admin/seasons/${encodePathSegment(id)}`, rankedAdminSeasonSchema, patch);
  }

  /** `POST /admin/seasons/:id/activate` — active la saison et clôt la précédente. */
  adminActivateSeason(id: string): Promise<AchilleaClientResult<RankedAdminSeason>> {
    return this.http.post(`/admin/seasons/${encodePathSegment(id)}/activate`, rankedAdminSeasonSchema);
  }

  /** `POST /admin/seasons/:id/reset` — remet le ladder à la note de base. */
  adminResetLadder(id: string): Promise<AchilleaClientResult<RankedLadderResetResult>> {
    return this.http.post(`/admin/seasons/${encodePathSegment(id)}/reset`, rankedLadderResetResultSchema);
  }
}
