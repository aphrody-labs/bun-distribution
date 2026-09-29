/**
 * Niveaux de difficulté partagés par les jeux de devinette (pendu, bingo).
 *
 * Les réglages en base (`zeni.game.win`, `game.pendu.max_errors`,
 * `game.bingo.limit_ms`) restent la référence : le niveau « facile » les
 * applique tels quels, les niveaux supérieurs les durcissent et multiplient le
 * gain en conséquence. Aucune valeur en base n'est modifiée.
 */

export const GAME_DIFFICULTIES = ["facile", "normal", "difficile"] as const;
export type GameDifficulty = (typeof GAME_DIFFICULTIES)[number];

const DEFAULT_GAME_DIFFICULTY: GameDifficulty = "normal";

export const DIFFICULTY_LABELS: Record<GameDifficulty, string> = {
	facile: "Facile",
	normal: "Normal",
	difficile: "Difficile",
};

/**
 * Multiplicateur du gain de base (`zeni.game.win`) par niveau.
 * Strictement croissant : un niveau plus dur rapporte toujours plus.
 */
export const DIFFICULTY_WIN_MULTIPLIER: Record<GameDifficulty, number> = {
	facile: 1,
	normal: 1.5,
	difficile: 2.5,
};

function isGameDifficulty(value: unknown): value is GameDifficulty {
	return typeof value === "string" && (GAME_DIFFICULTIES as readonly string[]).includes(value);
}

/** Valeur inconnue ou absente → niveau par défaut. */
export function parseGameDifficulty(value: unknown): GameDifficulty {
	return isGameDifficulty(value) ? value : DEFAULT_GAME_DIFFICULTY;
}

/** Gain d'une victoire au niveau donné, arrondi au zeni, jamais négatif. */
export function difficultyReward(baseWin: number, level: GameDifficulty): number {
	const base = Number.isFinite(baseWin) ? Math.max(0, baseWin) : 0;
	return Math.round(base * DIFFICULTY_WIN_MULTIPLIER[level]);
}
