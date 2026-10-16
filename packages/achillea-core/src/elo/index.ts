/**
 * Calcul Elo classique (K-factor configurable par saison).
 *
 * Logique pure identique au bot (`apps/bot/src/ranked/elo.ts` +
 * `EloService.calculate`), découplée de toute DB / DI.
 */

/** K-factor par défaut quand la saison n'en définit pas. */
export const DEFAULT_K_FACTOR = 32;

/** Rating de départ par défaut quand la saison n'en définit pas (ladder Achillea : tout le monde part de 0). */
export const DEFAULT_BASE_RATING = 0;

/** Score attendu d'un joueur face à un adversaire (probabilité de victoire, 0..1). */
export function expectedScore(playerElo: number, opponentElo: number): number {
  return 1 / (1 + Math.pow(10, (opponentElo - playerElo) / 400));
}

/**
 * Variation d'Elo (arrondie) d'un joueur après un match.
 *
 * @param actual Résultat réel : 1 victoire, 0.5 nul, 0 défaite.
 * @param kFactor K-factor de la saison.
 */
export function eloDelta(playerElo: number, opponentElo: number, actual: number, kFactor: number): number {
  return Math.round(kFactor * (actual - expectedScore(playerElo, opponentElo)));
}

/**
 * Barème AP **progressif** par palier (« ratio progressif » demandé par la commu).
 *
 * `winK` / `lossK` = K-factor DIRECTIONNEL. À niveau égal (score attendu 0.5), le
 * gain ≈ `winK/2` et la perte ≈ `lossK/2`. Les bas paliers gagnent BEAUCOUP et
 * perdent PEU (on encourage la montée), puis ça converge vers du **symétrique ±16
 * à partir du Divin** (les hauts paliers « jouent à l'équilibre »).
 *
 * Calibré sur les 11 paliers FR Achillea (index 0 = Fer → 10 = Légendaire) :
 *
 * | idx | palier      | à niveau égal |
 * |-----|-------------|---------------|
 * | 0   | Fer         | +20 / -5      |
 * | 1   | Bronze      | +20 / -6      |
 * | 2   | Argent      | +19 / -8      |
 * | 3   | Or          | +19 / -9      |
 * | 4   | Platine     | +18 / -10     |
 * | 5   | Diamant     | +18 / -12     |
 * | 6   | Émeraude    | +17 / -13     |
 * | 7   | Rubis       | +17 / -14     |
 * | 8   | Divin       | +16 / -16     |
 * | 9   | Supernova   | +16 / -16     |
 * | 10  | Légendaire  | +16 / -16     |
 *
 * L'asymétrie est **volontaire** : elle gonfle légèrement la masse d'AP au fil des
 * matchs (les bas paliers gagnent plus qu'ils ne perdent) — c'est le ressenti de
 * progression voulu, pas un système Elo « pur » à somme nulle.
 */
export interface TierEloFactors {
  winK: number;
  lossK: number;
}

const TIER_ELO_FACTORS: readonly TierEloFactors[] = [
  { winK: 40, lossK: 10 }, // 0  Fer        +20 / -5
  { winK: 40, lossK: 12 }, // 1  Bronze     +20 / -6
  { winK: 38, lossK: 16 }, // 2  Argent     +19 / -8
  { winK: 38, lossK: 18 }, // 3  Or         +19 / -9
  { winK: 36, lossK: 20 }, // 4  Platine    +18 / -10
  { winK: 36, lossK: 24 }, // 5  Diamant    +18 / -12
  { winK: 34, lossK: 26 }, // 6  Émeraude   +17 / -13
  { winK: 34, lossK: 28 }, // 7  Rubis      +17 / -14
  { winK: 32, lossK: 32 }, // 8  Divin      +16 / -16 (équilibré)
  { winK: 32, lossK: 32 }, // 9  Supernova  +16 / -16
  { winK: 32, lossK: 32 }, // 10 Légendaire +16 / -16
];

/** Facteurs (winK, lossK) du palier d'index donné (clampé aux bornes de la table). */
export function tierEloFactors(tierIndex: number): TierEloFactors {
  if (!Number.isFinite(tierIndex) || tierIndex <= 0) return TIER_ELO_FACTORS[0]!;
  const i = Math.min(Math.floor(tierIndex), TIER_ELO_FACTORS.length - 1);
  return TIER_ELO_FACTORS[i] ?? TIER_ELO_FACTORS[0]!;
}

/**
 * Variation d'AP **progressive** (arrondie) d'un joueur après un match.
 *
 * K directionnel selon le palier du joueur (`tierIndex` ; gain et perte
 * asymétriques) × modulation classique par l'écart d'Elo (`expectedScore`) : battre
 * plus fort que soi rapporte plus, perdre contre plus faible coûte plus.
 *
 * @param actual    1 victoire, 0.5 nul, 0 défaite.
 * @param tierIndex Palier du joueur AVANT le match (0 = Fer … 10 = Légendaire).
 * @param seasonK   Échelle globale de la saison (32 = barème nominal ci-dessus).
 */
export function progressiveEloDelta(
  playerElo: number,
  opponentElo: number,
  actual: number,
  tierIndex: number,
  seasonK: number = DEFAULT_K_FACTOR,
): number {
  const { winK, lossK } = tierEloFactors(tierIndex);
  const dirK = actual >= 1 ? winK : actual <= 0 ? lossK : (winK + lossK) / 2;
  const scaled = dirK * (seasonK / DEFAULT_K_FACTOR);
  return Math.round(scaled * (actual - expectedScore(playerElo, opponentElo)));
}

/**
 * Applique une variation d'Elo à un joueur en bornant le rating à 0 minimum.
 *
 * @returns Nouveau rating et delta réellement appliqué (après clamp).
 */
export function applyEloUpdate(playerElo: number, delta: number): { newElo: number; clampedDelta: number } {
  const newElo = Math.max(0, playerElo + delta);
  return { newElo, clampedDelta: newElo - playerElo };
}

/** Résultat d'un calcul Elo gagnant / perdant pour un match 1v1. */
export interface EloMatchResult {
  newWinner: number;
  newLoser: number;
  delta: number;
}

/**
 * Calcule les nouveaux Elo d'un duel gagnant / perdant.
 *
 * Identique à `EloService.calculate` du bot : le gagnant gagne `delta`,
 * le perdant perd l'équivalent (rating perdant borné à 0).
 */
export function computeMatchElo(
  winnerRating: number,
  loserRating: number,
  kFactor: number = DEFAULT_K_FACTOR,
): EloMatchResult {
  const expectedWinner = expectedScore(winnerRating, loserRating);
  const expectedLoser = 1 - expectedWinner;

  const delta = Math.round(kFactor * (1 - expectedWinner));
  const deltaLoser = Math.round(kFactor * (0 - expectedLoser));

  return {
    newWinner: winnerRating + delta,
    newLoser: Math.max(0, loserRating + deltaLoser),
    delta,
  };
}

// ── Bonus podium tournoi (AP plats, hors match) ─────────────────────────────

/**
 * Barème de récompense AP pour le podium d'un tournoi à élimination.
 *
 * Calibré sur le retour commu : un 32 (petit tournoi type Evo) = 50 / 25 / 10.
 * Les tailles plus grandes montent d'un cran ; les micros (≤8) restent modestes.
 * Pas de récompense au-delà des demi-finalistes (top 4).
 */
export interface TournamentPlacementPrizeTable {
  /** AP du vainqueur (rank 1). */
  first: number;
  /** AP du finaliste (rank 2). */
  second: number;
  /** AP de chaque demi-finaliste (rank 3 et 4). */
  semi: number;
}

/**
 * Table de prix selon la taille du tournoi (`participantsNumber` / capacité bracket).
 * Bornes inclusives sur le max de la tranche.
 */
export function prizeTableForTournamentSize(size: number): TournamentPlacementPrizeTable {
  const n = Number.isFinite(size) ? Math.max(0, Math.floor(size)) : 0;
  if (n <= 8) return { first: 25, second: 12, semi: 5 };
  if (n <= 16) return { first: 35, second: 18, semi: 8 };
  if (n <= 32) return { first: 50, second: 25, semi: 10 };
  if (n <= 64) return { first: 80, second: 40, semi: 15 };
  if (n <= 128) return { first: 120, second: 60, semi: 25 };
  return { first: 180, second: 90, semi: 35 };
}

/**
 * AP plats attribués pour un placement final.
 *
 * @param tournamentSize Capacité du tournoi (ex. 32).
 * @param rank           Place 1-based (`finalStandings[].rank` de brackets-manager).
 * @returns 0 si hors podium (rank > 4) ou rank invalide.
 */
export function placementPrizeAp(tournamentSize: number, rank: number): number {
  if (!Number.isFinite(rank) || rank < 1) return 0;
  const table = prizeTableForTournamentSize(tournamentSize);
  if (rank === 1) return table.first;
  if (rank === 2) return table.second;
  if (rank <= 4) return table.semi;
  return 0;
}
