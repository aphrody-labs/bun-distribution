/**
 * Formes de championnat exposées par l'API.
 *
 * Le calcul (classement, points, calendrier) vit dans
 * `@rosegriffon/achillea-core/league` ; seules les formes échangées sont ici,
 * pour qu'un client n'ait pas à dépendre de la logique métier pour lire une
 * réponse.
 */

export interface LeagueSummary {
  id: string;
  name: string;
  season: string;
  format: string;
  description: string;
  champion?: string;
  teamCount: number;
  matchdays: number;
  aliases: readonly string[];
}

export interface LeagueStandingRow {
  teamId: string;
  rank: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  winsOt: number;
  lossesOt: number;
  points: number;
  mapDiff: number;
  mapsFor: number;
  mapsAgainst: number;
}

export interface LeagueMatchRow {
  homeId: string;
  awayId: string;
  homeScore: number;
  awayScore: number;
  matchday: number;
  overtime?: boolean;
  winnerId?: string | null;
}

export interface LeagueTeam {
  tag: string;
  name: string;
}

export interface LeaguePointsConfig {
  /** Graphie servie par l'API. */
  win?: number;
  draw?: number;
  loss?: number;
  /** Graphie historique du contrat, conservée pour les appelants existants. */
  winRegulation?: number;
  lossRegulation?: number;
  winOvertime?: number;
  lossOvertime?: number;
}

export interface LeagueSeasonPayload {
  meta: LeagueSummary;
  format: Record<string, unknown>;
  teams: LeagueTeam[];
  pointsConfig: LeaguePointsConfig;
  standings: LeagueStandingRow[];
  results: LeagueMatchRow[];
  playoffs: unknown;
  schedule?: unknown;
  details?: unknown;
}

export interface LeagueListResponse {
  items: LeagueSummary[];
}
