import type {
  MatchFormat,
  ParticipantStatus,
  ScoreReportPolicy,
  StageType,
  TournamentEventType,
  TournamentState,
} from "../enums/eventEnums";

import type { SeedOrdering } from "./brackets";
import type { EventEntity } from "./event";
import type { OrganizationDTO } from "./organization";
import type { UserDTO } from "./user";

export interface TournamentSeries {
  id: number;
  name: string;
  description: string;
  logo: string;
  organization: OrganizationDTO;
  tournaments: Tournament[];
}

export interface NewTournamentDTO {
  name: string;
  description: string;
  series?: TournamentSeries | null;
  organization: OrganizationDTO | number;
  managers?: UserDTO[];

  startsAt: Date;
  grandFinalAt: Date;

  tournamentType: StageType;
  participantsNumber?: number | null;
  seedOrdering?: SeedOrdering | null;
  matchFormat?: MatchFormat | null;
  customFormatChildCount?: number | null;
  groupStageEnabled: boolean;
  groupStageType?: StageType | null;

  affiche?: string | null;
  logo: string;
  ruleset: string;
  planning: string;

  /** Planning automatisé — facultatif : sans dates, le tournoi se conduit à la main. */
  registrationOpensAt?: Date | string | null;
  registrationClosesAt?: Date | string | null;
  autoStart?: boolean;
  /** Rôle Discord distribué aux inscrits. */
  discordRoleEnabled?: boolean;
  /** Qui saisit les scores des matchs (défaut : les joueurs). */
  scoreReportPolicy?: ScoreReportPolicy;

  /** Dérogation aux règles de publication — SuperAdmin uniquement, côté API. */
  bypassRules?: boolean;
}

/** Projection compacte de la liste publique `/tournaments`. */
export interface TournamentListItem {
  id: number;
  name: string;
  description: string;
  type: string;
  status: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Tournament extends EventEntity {
  internalState: TournamentState;
  startsAt: Date;
  grandFinalAt: Date;

  series?: TournamentSeries | null;
  organization: OrganizationDTO;
  managers?: UserDTO[];
  participants?: ParticipantDTO[];

  tournamentType: StageType;
  participantsNumber?: number | null;
  seedOrdering?: SeedOrdering | null;
  matchFormat?: MatchFormat | null;
  customFormatChildCount?: number | null;
  groupStageEnabled: boolean;
  groupStageType?: StageType | null;

  logo: string;
  affiche?: string | null;
  planning: string;
  ruleset: string;

  /**
   * True une fois le bonus AP podium (top 4) versé.
   * Absent / false tant que non appliqué (tournois en cours ou formats hors scope).
   */
  placementEloApplied?: boolean;

  /** Planning automatisé (voir `docs/plan-tournois.md`). */
  registrationOpensAt?: string | null;
  registrationClosesAt?: string | null;
  autoStart?: boolean;
  discordRoleEnabled?: boolean;

  /** Qui saisit les scores (absent sur un tournoi d'avant l'option = joueurs). */
  scoreReportPolicy?: ScoreReportPolicy;

  /** Rôle Discord attribué aux inscrits, créé à l'ouverture des inscriptions. */
  discordRoleId?: string | null;

  /** Renseignés quand le tournoi a été annulé (l'entité reste en base). */
  cancelReason?: string | null;
  canceledAt?: string | null;
  /** Horodatage d'une clôture manuelle (null si passage automatique en Terminé). */
  closedAt?: string | null;
}

export interface ParticipantDTO {
  id: number;
  tournament: Tournament;
  user: UserDTO;
  bracketParticipantId?: number | null;
  seed?: number | null;
  hasCheckedIn: boolean;
  /** Absent sur les réponses d'API antérieures au statut : traiter comme `ACTIVE`. */
  status?: ParticipantStatus;
  registeredAt?: string;
  /** Rang dans la liste d'attente (1 = prochain promu). */
  waitlistPosition?: number | null;
  /** Motif de DQ — renseigné uniquement pour les organisateurs. */
  statusReason?: string | null;
}

export interface TournamentEventActor {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
}

export interface TournamentEventDTO {
  id: string;
  type: TournamentEventType;
  createdAt: string;
  actor: TournamentEventActor | null;
  target: TournamentEventActor | null;
  payload: Record<string, unknown> | null;
  /** Motif (DQ, annulation) — null pour les non-organisateurs. */
  reason: string | null;
}

// ── Circuit ─────────────────────────────────────────────────────────────────

/**
 * Classement circuit — cumul de points de circuit sur tous les tournois
 * élimination terminés. Calcul : `@rosegriffon/achillea-core/tournaments`.
 */
export interface CircuitLeaderboardEntry {
  userId: string;
  displayName: string;
  username: string;
  avatar: string;
  clan: CircuitClanTag | null;
  tournamentsPlayed: number;
  points: number;
  tournaments: number;
  wins: number;
  podiums: number;
  top4: number;
  top8: number;
  bestRank: number;
  bestRankLabel: string;
  /** Palier circuit — mêmes clés que le ranked (Fer → Légendaire). */
  tier: string;
}

export interface CircuitClanTag {
  id: number;
  name: string;
  shortName: string;
  avatar: string;
}

/** Classement des clans — somme des points circuit de leurs membres actuels. */
export interface CircuitClanEntry {
  id: number;
  name: string;
  shortName: string;
  avatar: string;
  points: number;
  players: number;
  tournamentsPlayed: number;
  wins: number;
  podiums: number;
  tier: string;
}

export interface CircuitPodiumEntry {
  rank: number;
  rankLabel: string;
  userId: string;
  displayName: string;
  avatar: string;
}

export interface CircuitTournamentSummary {
  id: number;
  name: string;
  size: number;
  grandFinalAt: string;
  podium: CircuitPodiumEntry[];
  standingsStatus: "resolved" | "unresolved";
}

export interface CircuitRanking {
  leaderboard: CircuitLeaderboardEntry[];
  tournaments: CircuitTournamentSummary[];
  clanRanking: CircuitClanEntry[];
}

export interface TournamentTop10Entry {
  rank: number;
  rankLabel: string;
  userId: string;
  displayName: string;
  avatar: string;
  clan: CircuitClanTag | null;
  /** Points de circuit gagnés pour CE tournoi — pas le cumul all-time. */
  points: number;
  tier: string;
  goalsScored: number;
  goalsConceded: number;
  goalAverage: number;
}

export interface TournamentMatchup {
  winnerDisplayName: string;
  winnerAvatar: string;
  loserDisplayName: string;
  loserAvatar: string;
  scoreWinner: number;
  scoreLoser: number;
}

export interface TournamentMatchStats {
  matches: number;
  totalGoals: number;
  avgGoals: number;
  topScore: number;
  minMargin: number;
  maxMargin: number;
  biggestBlowout: TournamentMatchup | null;
  closestMatch: TournamentMatchup | null;
}

export interface TournamentSummary {
  top10: TournamentTop10Entry[];
  stats: TournamentMatchStats | null;
}

// ── Hub stats ───────────────────────────────────────────────────────────────

/** Joueur enrichi des stats matchs (buts, séries) pour le hub stats circuit. */
export interface StatsHubPlayerEntry extends CircuitLeaderboardEntry {
  matchesPlayed: number;
  matchWins: number;
  matchLosses: number;
  goalsScored: number;
  goalsConceded: number;
  goalDiff: number;
  /** Buts marqués / encaissés — départage à points égaux. */
  goalAverage: number;
  bestStreak: number;
}

export interface StatsHubClanEntry extends CircuitClanEntry {
  goalsScored: number;
  goalsConceded: number;
  goalAverage: number;
}

export interface StatsHubRecord {
  value: number;
  tournamentId: number;
  tournamentName: string;
  detail: string;
}

export interface StatsHubTournamentHistoryEntry {
  id: number;
  name: string;
  grandFinalAt: string;
  size: number;
  matches: number;
  goals: number;
  champion: string | null;
  runnerUp: string | null;
}

export interface StatsHub {
  overview: {
    totalTournaments: number;
    totalMatches: number;
    totalGoals: number;
    avgGoalsPerMatch: number;
    totalPlayers: number;
    totalClans: number;
  };
  records: {
    topScorer: StatsHubPlayerEntry | null;
    mostTitles: StatsHubPlayerEntry | null;
    mostTournaments: StatsHubPlayerEntry | null;
    bestStreakPlayer: StatsHubPlayerEntry | null;
    biggestTournament: { id: number; name: string; size: number } | null;
    highestScoringMatch: StatsHubRecord | null;
    closestFinal: StatsHubRecord | null;
    biggestBlowoutFinal: StatsHubRecord | null;
  };
  players: StatsHubPlayerEntry[];
  clans: StatsHubClanEntry[];
  tournamentHistory: StatsHubTournamentHistoryEntry[];
  tournaments: CircuitTournamentSummary[];
}

export interface PlayerTournamentHistoryEntry {
  tournamentId: number;
  tournamentName: string;
  grandFinalAt: string;
  size: number;
  rank: number | null;
  rankLabel: string;
  points: number;
  tier: string;
  goalsScored: number;
  goalsConceded: number;
}

/** Profil circuit d'un joueur — page profil public `/users/:id`. */
export interface PlayerCircuitProfile {
  tournamentsPlayed: number;
  points: number;
  tier: string;
  wins: number;
  podiums: number;
  top4: number;
  top8: number;
  bestRankLabel: string;
  goalsScored: number;
  goalsConceded: number;
  goalAverage: number;
  bestStreak: number;
  history: PlayerTournamentHistoryEntry[];
}
