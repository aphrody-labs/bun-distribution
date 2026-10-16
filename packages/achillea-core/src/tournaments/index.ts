/**
 * Classement circuit — cumul de points sur tous les tournois élimination
 * (simple/double) d'Achilléa, pondéré par la taille du tableau.
 *
 * Distinct de l'AP podium versé en jeu (`elo/index.ts#placementPrizeAp`, qui
 * ne récompense que le podium + demi-finalistes) : le classement circuit
 * descend jusqu'aux 9-16e pour que chaque run compte, et sert uniquement à
 * l'affichage (page "Classement des tournois"), pas à l'économie AP.
 *
 * Le rang consommé est le **dense rank** de brackets-manager
 * (`BracketsManager.get.finalStandings`) : tout un palier d'éliminés partage
 * le même rang (1, 2, 3, 3, 4, 4, 4, 4, ...), incrémenté une fois par palier
 * plutôt que par joueur. `denseRankToTier` traduit ce rang en palier lisible
 * (1er / 2e / 3e-4e / 5e-8e / ...).
 */

import { ScoreReportPolicy } from "@rosegriffon/achillea-types";

export * from "./rules";
export * from "./phase-transition";

/**
 * Droit de saisir / valider le score d'un match de tournoi.
 *
 * Règle unique, partagée par l'API (qui la fait respecter) et le front (qui masque
 * les boutons en conséquence) — deux implémentations divergentes finiraient par
 * afficher un bouton que le serveur refuse.
 *
 * Un organisateur passe toujours : la politique n'encadre que les joueurs. Une
 * politique absente vaut `PLAYERS`, le comportement d'avant l'option.
 */
export function canReportTournamentScore(
  policy: ScoreReportPolicy | null | undefined,
  actor: { isOrganizer: boolean; isLobbyPlayer: boolean },
): boolean {
  if (actor.isOrganizer) return true;
  if (!actor.isLobbyPlayer) return false;

  return (policy ?? ScoreReportPolicy.PLAYERS) !== ScoreReportPolicy.STAFF_ONLY;
}

/** Barème de points par palier, avant pondération par la taille du tableau. */
export interface CircuitPointsTable {
  first: number;
  second: number;
  tier34: number;
  tier58: number;
  tier916: number;
  rest: number;
}

const DEFAULT_TABLE: CircuitPointsTable = {
  first: 100,
  second: 65,
  tier34: 40,
  tier58: 22,
  tier916: 10,
  rest: 3,
};

/**
 * Facteur multiplicatif lié à la taille du tableau : un titre à 128 joueurs
 * doit peser plus qu'un titre à 8. Mêmes paliers que `prizeTableForTournamentSize`
 * (elo/index.ts) pour rester cohérent avec le barème AP.
 */
export function circuitSizeWeight(size: number): number {
  const n = Number.isFinite(size) ? Math.max(0, Math.floor(size)) : 0;
  if (n <= 8) return 0.5;
  if (n <= 16) return 0.7;
  if (n <= 32) return 1.0;
  if (n <= 64) return 1.3;
  if (n <= 128) return 1.6;
  return 2.0;
}

/**
 * Palier lisible pour un dense rank brackets-manager donné.
 * `denseRank` 1 → "1er", 2 → "2e", 3 → tranche 3-4, 4 → tranche 5-8, etc.
 * (tranche = éliminés au même tour, taille `2^(denseRank-2)`).
 */
export function denseRankToTier(denseRank: number): { lo: number; hi: number; label: string } {
  if (denseRank <= 0 || !Number.isFinite(denseRank)) return { lo: 0, hi: 0, label: "?" };
  if (denseRank === 1) return { lo: 1, hi: 1, label: "1er" };
  if (denseRank === 2) return { lo: 2, hi: 2, label: "2e" };
  const tierSize = 2 ** (denseRank - 2);
  const hi = 2 ** (denseRank - 1);
  const lo = hi - tierSize + 1;
  if (hi <= 4) return { lo, hi, label: `${lo}e-${hi}e (demi-finale)` };
  if (hi <= 8) return { lo, hi, label: `${lo}e-${hi}e (quart de finale)` };
  if (hi <= 16) return { lo, hi, label: `${lo}e-${hi}e` };
  return { lo, hi, label: `${lo}e-${hi}e` };
}

/**
 * Points de circuit pour un dense rank donné, dans un tableau de `tournamentSize`
 * joueurs. 0 si le rang est invalide.
 */
export function circuitPointsForRank(
  tournamentSize: number,
  denseRank: number,
  table: CircuitPointsTable = DEFAULT_TABLE,
): number {
  if (!Number.isFinite(denseRank) || denseRank < 1) return 0;
  const weight = circuitSizeWeight(tournamentSize);
  const { hi } = denseRankToTier(denseRank);
  let base: number;
  if (denseRank === 1) base = table.first;
  else if (denseRank === 2) base = table.second;
  else if (hi <= 4) base = table.tier34;
  else if (hi <= 8) base = table.tier58;
  else if (hi <= 16) base = table.tier916;
  else base = table.rest;
  return Math.round(base * weight);
}

/**
 * Palier "circuit" — même vocabulaire/imagerie que les 11 paliers ranked
 * (Fer → Légendaire, table `rank` en base) pour que la page classement des
 * tournois se sente familière plutôt que de réinventer un système parallèle.
 * Bornes mises à l'échelle des points circuit (proportions ranked ÷ ~14,
 * calibrées sur les premières saisons de tournois — pas un barème d'Elo).
 */
export interface CircuitTier {
  key: string;
  minPoints: number;
  maxPoints: number;
}

export const CIRCUIT_TIERS: readonly CircuitTier[] = [
  { key: "Fer", minPoints: 0, maxPoints: 4 },
  { key: "Bronze", minPoints: 5, maxPoints: 14 },
  { key: "Argent", minPoints: 15, maxPoints: 29 },
  { key: "Or", minPoints: 30, maxPoints: 44 },
  { key: "Platine", minPoints: 45, maxPoints: 59 },
  { key: "Diamant", minPoints: 60, maxPoints: 74 },
  { key: "Émeraude", minPoints: 75, maxPoints: 89 },
  { key: "Rubis", minPoints: 90, maxPoints: 104 },
  { key: "Divin", minPoints: 105, maxPoints: 129 },
  { key: "Supernova", minPoints: 130, maxPoints: 159 },
  { key: "Légendaire", minPoints: 160, maxPoints: Number.POSITIVE_INFINITY },
];

/** Palier circuit couvrant `points` (clamp sur Fer si négatif/invalide). */
export function circuitPointsToTier(points: number): CircuitTier {
  const p = Number.isFinite(points) ? points : 0;
  for (const tier of CIRCUIT_TIERS) {
    if (p >= tier.minPoints && p <= tier.maxPoints) return tier;
  }
  return CIRCUIT_TIERS[0]!;
}

/**
 * "Goal average" (moyenne de buts) — quotient buts marqués / buts encaissés.
 * Méthode de départage historique (Coupes du monde 1954-1970, football anglais
 * avant 1976, avant que la différence de buts ne devienne la norme) :
 * https://fr.wikipedia.org/wiki/Goal_average
 *
 * Convention : 0 but encaissé avec au moins 1 but marqué -> le meilleur cas
 * possible. On renvoie un sentinel fini (`GOAL_AVERAGE_PERFECT`) plutôt que
 * `Infinity` — `JSON.stringify(Infinity)` vaut `null` et casserait le tri/
 * l'affichage côté API/front. 0-0 -> 0.
 */
export const GOAL_AVERAGE_PERFECT = 999;

export function goalAverage(goalsScored: number, goalsConceded: number): number {
  if (goalsConceded > 0) return goalsScored / goalsConceded;
  return goalsScored > 0 ? GOAL_AVERAGE_PERFECT : 0;
}

export * from "./organizers";
