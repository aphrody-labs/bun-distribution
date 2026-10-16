/**
 * Types pour le détail sheet Astral League (manches joueurs, stats, H2H).
 * Source : packages/core/src/league/astral-s1-details.json
 */

/** Une manche 1v1 au sein d'une rencontre d'équipe. */
export interface AstralGameLine {
  /** Pseudo TO / Shakka / Gamidon (ou null). */
  slotLabel: string | null;
  homePlayer: string;
  awayPlayer: string;
  /** Buts marqués ; -1 = forfait de ce côté. */
  homeGoals: number;
  awayGoals: number;
  forfeitHome: boolean;
  forfeitAway: boolean;
}

/** Rencontre d'équipe enrichie (phase régulière ou play-off). */
export interface AstralDetailedMatch {
  time: string;
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
  date: string;
  matchday: number;
  games: AstralGameLine[];
  phase: "regular" | "playoff" | string;
  overtime?: boolean;
  winnerId?: string;
  /** Libellé play-off (ex. « Demi 1 »). */
  label?: string;
  roundIndex?: number;
}

export interface AstralMatchday {
  matchday: number;
  date: string;
  matches: AstralDetailedMatch[];
}

/** Stats individuelles agrégées depuis le sheet. */
export interface AstralPlayerStats {
  name: string;
  teams: string[];
  primaryTeam: string;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  /** Winrate % 0–100. */
  winrate: number;
  forfeitsGiven: number;
  forfeitsReceived: number;
  regularGames: number;
  playoffGames: number;
}

/** Confrontation directe phase régulière. */
export interface AstralH2HEntry {
  scoreFor: number;
  scoreAgainst: number;
  matchday: number;
  date: string;
  home: boolean;
}

export interface AstralSeasonDetails {
  regularMatchdays: AstralMatchday[];
  playoffMatches: AstralDetailedMatch[];
  players: AstralPlayerStats[];
  rosters: Record<string, string[]>;
  h2h: Record<string, Record<string, AstralH2HEntry>>;
}
