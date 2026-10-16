/**
 * Contrats Ranked — profils, salon de présence, matchs live, litiges, saisons.
 *
 * Côté serveur : entities MikroORM (`UserElo`, `Rank`, `Lobby`, `LobbyMatch`,
 * `LobbyUser`). Côté temps réel : reflète le state schema `MatchRoom`
 * (cf. `docs/ranking.md` §5). Aucun de ces champs n'est propre à un framework.
 */

import type { MatchMode } from "../enums/eventEnums";

export type MatchRoomStatus = "waiting" | "playing" | "scoring" | "disputed" | "finished";

export type MatchResult = "win" | "loss" | "draw" | "forfeit";

export interface RankTier {
  key: string;
  minElo: number;
  maxElo: number;
  emojiId: string;
  emojiKey: string;
  gradient: string[];
}

export interface RankedProfile {
  userId: string;
  mode: MatchMode;
  elo: number;
  peakRating: number;
  gamesPlayed: number;
  wins: number;
  losses: number;
  tier: RankTier | null;
  seasonId: string | null;
  globalRank?: number | null;
  totalPlayers?: number;
  percentile?: number | null;
}

export interface RankedTrend {
  sparkline: number[];
  deltaPeriod: number;
  gamesInPeriod: number;
  winRatePeriod: number;
  days: number;
}

export interface RankedPlayerView {
  userId: string;
  displayName: string;
  avatar: string;
  elo: number;
  /** Côté terrain : 1 = domicile (1er joueur), 2 = extérieur (2e joueur). 0 = non assigné. */
  team: number;
  /** Saisie du score (double validation), du point de vue du joueur (−1 = non saisi). */
  myScore: number;
  oppScore: number;
  /** A cliqué « Début de match ». */
  startedMatch: boolean;
  /** A validé sa saisie de score. */
  submitted: boolean;
  /** A uploadé sa capture de preuve. */
  proofUploaded: boolean;
  /** A cliqué « Fin de match ». */
  confirmedFinish: boolean;
}

export interface RankedChatMessage {
  userId: string;
  text: string;
  at: number;
}

/** Joueur présent dans le salon de présence ranked, pour le défi direct. */
export interface RankedLobbyPlayer {
  userId: string;
  displayName: string;
  avatar: string;
  elo: number;
  mode: number;
}

/** Invitation reçue (on est défié par un autre joueur). */
export interface RankedPendingInvite {
  fromUserId: string;
  fromDisplayName: string;
  fromAvatar: string;
  fromElo: number;
  mode: MatchMode;
  /** Classé (ELO) ou non classé (amical). */
  ranked: boolean;
}

/** Invitation envoyée (on a défié un joueur, en attente de sa réponse). */
export interface RankedSentInvite {
  targetUserId: string;
  targetDisplayName: string;
  mode: MatchMode;
  ranked: boolean;
}

/** Défi par lien partageable créé par le joueur courant (en attente d'acceptation). */
export interface RankedChallengeLink {
  code: string;
  url: string;
  mode: MatchMode;
  ranked: boolean;
  toUserId: string | null;
  expiresAt: number;
}

/** Aperçu d'un défi reçu via un lien. */
export interface RankedChallengePreview {
  code: string;
  fromUserId: string;
  fromDisplayName: string;
  fromAvatar: string;
  fromElo: number;
  mode: MatchMode;
  ranked: boolean;
  isOwn: boolean;
  expiresAt: number;
}

/** Proposition de revanche reçue en temps réel (`rematch_offer`). */
export interface RankedRematchOffer {
  code: string;
  fromUserId: string;
  fromDisplayName: string;
  fromAvatar: string;
  fromElo: number;
  mode: MatchMode;
  ranked: boolean;
  url: string;
}

export interface RankedMatchSummary {
  lobbyId: number;
  roomCode: string;
  mode: MatchMode;
  /** `false` = partie amicale (aucun ELO appliqué). */
  ranked?: boolean;
  opponent: { userId: string; displayName: string; avatar: string };
  result: MatchResult;
  myScore: number;
  opponentScore: number;
  eloBefore: number;
  eloAfter: number;
  eloDelta: number;
  newTier: RankTier | null;
  endedAt: string;
}

export interface RankedDisputeRequest {
  lobbyId: number;
  screenshotUrl: string;
}

export interface RankedDisputePlayer {
  userId: string;
  displayName: string;
  /** Score que CE joueur réclame pour lui-même. */
  submittedScore: number;
  /** Score qu'il attribue à l'adversaire. */
  claimedOpponentScore?: number | null;
  screenshotUrl?: string | null;
}

export interface RankedAdminDispute {
  lobbyId: number;
  mode: MatchMode;
  player1: RankedDisputePlayer;
  player2: RankedDisputePlayer;
  createdAt: string;
}

export interface RankedAdminValidateRequest {
  scoreTeam1: number;
  scoreTeam2: number;
  forfeitUserId?: string;
}

/** Un joueur d'un match EN COURS (vue admin « Matchs en cours »). */
export interface RankedActivePlayer {
  userId: string;
  displayName: string;
  score: number;
  claimedOpponentScore: number | null;
  submitted: boolean;
  hasProof: boolean;
}

/** Un match ranked EN COURS (lobby `Ongoing`), avec son état live persisté. */
export interface RankedActiveMatch {
  lobbyId: number;
  mode: MatchMode;
  createdAt: string;
  /** Domicile (team 1). */
  player1: RankedActivePlayer;
  /** Extérieur (team 2). */
  player2: RankedActivePlayer;
}

/** Compteurs synthétiques du ranked (vue admin overview). */
export interface RankedOverview {
  activeMatches: number;
  contestedMatches: number;
  finishedToday: number;
  matchesToday: number;
  totalPlayers: number;
}

/** Un événement de télémétrie ranked (journal du flow des matchs, vue staff). */
export interface RankedMatchEvent {
  id: number;
  createdAt: string;
  lobbyId: number | null;
  roomCode: string | null;
  mode: number | null;
  userId: string | null;
  displayName: string | null;
  type: string;
  detail: Record<string, unknown>;
}

export interface RankedTierInfo {
  key: string;
  minElo: number;
  maxElo: number;
  gradient: string[];
  emojiId: string | null;
  emojiKey: string | null;
  playerCount: number;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  displayName: string;
  avatar: string;
  elo: number;
  peakRating: number;
  gamesPlayed: number;
}

export interface LeaderboardPage {
  entries: LeaderboardEntry[];
  total: number;
  mode: MatchMode;
}

export interface RankedHistoryEntry {
  lobbyId: number;
  mode: MatchMode;
  state: string;
  endedAt: string;
  myScore: number;
  opponentScore: number;
  eloDelta: number;
  result: MatchResult;
  opponent: { userId: string; displayName: string; avatar: string };
}

// ── Administration des saisons ──────────────────────────────────────────────

export type SeasonState = "Upcoming" | "Active" | "Closed";

export interface RankedSeasonConfig {
  kFactor: number;
  baseRating: number;
  decayRate: number;
}

export interface RankedAdminSeason {
  id: string;
  name: string;
  state: SeasonState;
  startsAt: string;
  endsAt: string;
  config: RankedSeasonConfig;
  playerCount: number;
}

export interface RankedSeasonInput {
  name: string;
  startsAt: string;
  endsAt: string;
  config: RankedSeasonConfig;
}

/** `POST /ranked/challenge/:code/accept` — la réservation temps réel est opaque. */
export interface RankedChallengeAccepted {
  reservation: unknown;
  mode: number;
  ranked: boolean;
}

/** `POST /ranked/:lobbyId/dispute` — URL de la preuve stockée. */
export interface RankedProofUploaded {
  url: string;
}

export interface RankedAdminValidateResult {
  ok: boolean;
  eloDelta?: number;
}

export interface RankedLadderResetResult {
  ok: boolean;
  affected: number;
}
