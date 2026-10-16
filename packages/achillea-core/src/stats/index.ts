/**
 * Agrégats statistiques — ratios, séries, distributions.
 *
 * Utilisés par le hub stats, les profils joueur et les tableaux de bord admin.
 * Purs et déterministes : un jeu Rust ou une app mobile peuvent recalculer
 * localement les mêmes chiffres que l'API.
 */

import type { CompetitionStats, RankTier, RankedModeStats } from "@rosegriffon/achillea-types";

import { clamp, toCount, toFinite } from "../numbers/index";

/** Taux de victoire dans `[0, 1]` (0 si aucun match joué). */
export function winRate(wins: number, total: number): number {
  const played = toFinite(total);
  if (played <= 0) return 0;
  return clamp(toFinite(wins) / played, 0, 1);
}

/** Taux de victoire en pourcentage arrondi. */
export function winRatePercent(wins: number, total: number, digits = 0): number {
  const factor = 10 ** digits;
  return Math.round(winRate(wins, total) * 100 * factor) / factor;
}

export function rankedWinRate(stats: RankedModeStats): number {
  return winRate(stats.wins, stats.total);
}

export function competitionWinRate(stats: CompetitionStats): number {
  return winRate(stats.personalWins, stats.personalTotal);
}

/** Différence de buts (marqués − encaissés). */
export function goalDifference(scored: number, conceded: number): number {
  return toFinite(scored) - toFinite(conceded);
}

/** Moyenne par match, 0 si aucun match. */
export function perMatch(value: number, matches: number): number {
  const played = toFinite(matches);
  if (played <= 0) return 0;
  return toFinite(value) / played;
}

/**
 * Plus longue série de victoires d'une suite de résultats, du plus ancien au
 * plus récent. `results[i]` vrai = victoire.
 */
export function longestStreak(results: readonly boolean[]): number {
  let best = 0;
  let current = 0;
  for (const won of results) {
    current = won ? current + 1 : 0;
    if (current > best) best = current;
  }
  return best;
}

/** Série en cours à la fin de la suite (0 si le dernier match est perdu). */
export function currentStreak(results: readonly boolean[]): number {
  let streak = 0;
  for (let i = results.length - 1; i >= 0; i--) {
    if (!results[i]) break;
    streak++;
  }
  return streak;
}

export interface TierBucket<T extends RankTier = RankTier> {
  tier: T;
  count: number;
  /** Part du total, dans `[0, 1]`. */
  share: number;
}

/**
 * Distribution d'une population d'Elo sur des paliers.
 * Les paliers sont supposés couvrants ; un Elo hors bornes est ignoré.
 */
export function tierDistribution<T extends RankTier>(elos: readonly number[], tiers: readonly T[]): TierBucket<T>[] {
  const counts = new Map<string, number>();
  for (const elo of elos) {
    const tier = tiers.find(t => elo >= t.minElo && elo <= t.maxElo);
    if (!tier) continue;
    counts.set(tier.key, (counts.get(tier.key) ?? 0) + 1);
  }
  const total = Array.from(counts.values()).reduce((sum, n) => sum + n, 0);
  return tiers.map(tier => {
    const count = counts.get(tier.key) ?? 0;
    return { tier, count, share: total === 0 ? 0 : count / total };
  });
}

/**
 * Réduit une série de valeurs à `points` échantillons, pour une sparkline.
 * Conserve toujours la première et la dernière valeur.
 */
export function downsample(values: readonly number[], points: number): number[] {
  const target = Math.max(2, toCount(points));
  if (values.length <= target) return values.slice();
  const step = (values.length - 1) / (target - 1);
  const out: number[] = [];
  for (let i = 0; i < target; i++) {
    out.push(values[Math.round(i * step)] as number);
  }
  return out;
}

/** Moyenne arithmétique (0 sur une liste vide). */
export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Médiane (0 sur une liste vide). */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] as number;
  return ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}
