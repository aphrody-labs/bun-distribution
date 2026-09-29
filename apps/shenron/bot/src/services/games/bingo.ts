/**
 * Bingo — logique pure, sans dépendance Discord.
 * Concept : devine un nombre dans une plage. Le moteur dit "plus haut" / "plus bas".
 * Source de vérité partagée par /bingo (Discord) et `POST /api/games/bingo/*`.
 */
import { difficultyReward, type GameDifficulty } from "./difficulty";

export const BINGO_MIN = 1;
export const BINGO_MAX = 100;
export const BINGO_DEFAULT_TIMEOUT_MS = 60_000;
/**
 * Essais avant défaite sur la partie web (`POST /api/games/bingo/play`).
 *
 * La valeur vivait en dur des deux côtés — `attempts >= 10` dans `api/server.ts`,
 * « / 10 » dans l'écran du site — alors que ce module se présente comme la source
 * de vérité du jeu. La partie web reste sur la plage 1-100 en 10 essais (niveau
 * « facile ») ; la commande Discord utilise `BINGO_LEVELS`.
 */
export const BINGO_MAX_ATTEMPTS = 10;
/** Durée plancher d'une partie Discord, quel que soit le réglage. */
export const BINGO_MIN_TIME_MS = 10_000;

export interface BingoLevel {
	min: number;
	max: number;
	/** Essais autorisés par joueur. */
	maxAttempts: number;
	/** Multiplicateur appliqué à `game.bingo.limit_ms`. */
	timeFactor: number;
	/** La défaite en solo coûte-t-elle `zeni.game.loss_penalty` ? */
	lossPenalty: boolean;
}

/**
 * Courbe : en jouant la dichotomie parfaite, on gagne à coup sûr en facile,
 * environ 85 % du temps en normal et une fois sur deux en difficile
 * (cf. `bingoOptimalWinChance`).
 */
export const BINGO_LEVELS: Record<GameDifficulty, BingoLevel> = {
	facile: { min: 1, max: 100, maxAttempts: BINGO_MAX_ATTEMPTS, timeFactor: 1.6, lossPenalty: false },
	normal: { min: 1, max: 300, maxAttempts: 8, timeFactor: 1.6, lossPenalty: true },
	difficile: { min: 1, max: 1000, maxAttempts: 9, timeFactor: 2, lossPenalty: true },
};

export type BingoHint = "match" | "higher" | "lower" | "out-of-range";

export function randomBingoTarget(
	min = BINGO_MIN,
	max = BINGO_MAX,
	rng: () => number = Math.random
): number {
	const span = max - min + 1;
	return Math.min(max, Math.floor(rng() * span) + min);
}

export function compareBingoGuess(
	guess: number,
	target: number,
	min = BINGO_MIN,
	max = BINGO_MAX
): BingoHint {
	if (!Number.isInteger(guess) || guess < min || guess > max) {
		return "out-of-range";
	}
	if (guess === target) return "match";
	return guess < target ? "higher" : "lower";
}

export interface BingoRange {
	lo: number;
	hi: number;
}

/** Resserre l'intervalle encore possible après un indice. Ne mute pas `range`. */
export function narrowBingoRange(range: BingoRange, guess: number, hint: BingoHint): BingoRange {
	if (hint === "higher") return { lo: Math.max(range.lo, guess + 1), hi: range.hi };
	if (hint === "lower") return { lo: range.lo, hi: Math.min(range.hi, guess - 1) };
	if (hint === "match") return { lo: guess, hi: guess };
	return range;
}

/** Durée d'une partie Discord au niveau donné. */
export function bingoTimeLimitMs(level: GameDifficulty, baseMs: number = BINGO_DEFAULT_TIMEOUT_MS): number {
	const safe = Number.isFinite(baseMs) && baseMs > 0 ? baseMs : BINGO_DEFAULT_TIMEOUT_MS;
	return Math.max(BINGO_MIN_TIME_MS, Math.round(safe * BINGO_LEVELS[level].timeFactor));
}

/**
 * Probabilité de victoire en jouant parfaitement (dichotomie) : k essais
 * couvrent au plus 2^k − 1 valeurs.
 */
export function bingoOptimalWinChance(level: GameDifficulty): number {
	const { min, max, maxAttempts } = BINGO_LEVELS[level];
	return Math.min(1, (2 ** maxAttempts - 1) / (max - min + 1));
}

/** Gain d'une victoire au bingo (hors mise). */
export function bingoReward(baseWin: number, level: GameDifficulty): number {
	return difficultyReward(baseWin, level);
}

/** Pénalité d'une défaite solo au niveau donné. */
export function bingoLossPenalty(baseLoss: number, level: GameDifficulty): number {
	return BINGO_LEVELS[level].lossPenalty ? Math.max(0, Math.round(baseLoss)) : 0;
}
