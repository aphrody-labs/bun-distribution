/**
 * Mapping Elo → palier (tier / rank) et calculs de classement purs.
 *
 * Logique identique à `apps/bot/src/ranked/db.ts#findTier` et au calcul de
 * percentile de `ranked/main.ts`, mais découplée des lignes SQL : un palier
 * est décrit par l'interface portable `RankTier`.
 */

/** Palier de classement (intervalle d'Elo + métadonnées d'affichage). */
export interface RankTier {
  key: string;
  minElo: number;
  maxElo: number;
  gradient: string[];
}

/** Clé renvoyée quand aucun palier ne couvre l'Elo fourni. */
export const UNRANKED_KEY = "Unranked";

/**
 * Trouve le palier couvrant l'Elo donné (intervalle `[minElo, maxElo]` inclusif).
 * Retourne `null` si aucun palier ne correspond.
 *
 * Les paliers ne sont pas supposés triés ; le premier intervalle couvrant
 * l'Elo est renvoyé (les barèmes Achilléa sont disjoints).
 */
export function eloToTier<T extends RankTier>(elo: number, tiers: readonly T[]): T | null {
  for (const tier of tiers) {
    if (elo >= tier.minElo && elo <= tier.maxElo) return tier;
  }
  return null;
}

/**
 * Renvoie la clé du palier d'un Elo, ou `UNRANKED_KEY` si hors barème.
 * Pratique pour les vues qui n'ont besoin que du libellé.
 */
export function eloToRankKey(elo: number, tiers: readonly RankTier[]): string {
  return eloToTier(elo, tiers)?.key ?? UNRANKED_KEY;
}

/**
 * Percentile (0.1..100, une décimale) d'un joueur à partir de son rang global
 * (DENSE_RANK) et du nombre total de joueurs classés. Identique au calcul de
 * `ranked/main.ts` : `max(0.1, round(rank/total * 1000) / 10)`.
 *
 * @returns `null` si le rang est inconnu ou s'il n'y a aucun joueur classé.
 */
export function computePercentile(globalRank: number | null, totalPlayers: number): number | null {
  if (!globalRank || totalPlayers <= 0) return null;
  return Math.max(0.1, Math.round((globalRank / totalPlayers) * 1000) / 10);
}
