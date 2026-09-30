// SPDX-License-Identifier: Apache-2.0
/**
 * xp.ts — Calculs de progression XP et paliers purs Shenron.
 */

/**
 * Paliers XP par défaut (en "unités" DragonBall).
 */
export const DEFAULT_LEVEL_THRESHOLDS: readonly { level: number; xp: number }[] = [
	{ level: 1, xp: 1_000 },
	{ level: 2, xp: 5_000 },
	{ level: 3, xp: 10_000 },
	{ level: 4, xp: 25_000 },
	{ level: 5, xp: 50_000 },
	{ level: 6, xp: 100_000 },
	{ level: 7, xp: 250_000 },
	{ level: 8, xp: 500_000 },
	{ level: 9, xp: 1_000_000 },
	{ level: 10, xp: 9_000_000 }, // It's over 9000 !
] as const;

export type LevelThreshold = { level: number; xp: number };

/**
 * Calcule le niveau correspondant à un montant d'XP selon une grille de paliers.
 */
export function calculateLevelForXP(xp: number, thresholds: readonly LevelThreshold[] = DEFAULT_LEVEL_THRESHOLDS): number {
	let level = 0;
	for (const t of thresholds) {
		if (xp >= t.xp) level = t.level;
		else break;
	}
	return level;
}

/**
 * Montant d'XP requis pour atteindre un niveau donné.
 */
export function calculateXpRequiredForLevel(level: number, thresholds: readonly LevelThreshold[] = DEFAULT_LEVEL_THRESHOLDS): number {
	return thresholds.find((t) => t.level === level)?.xp ?? Infinity;
}

/**
 * Prochain palier à franchir depuis le montant d'XP actuel.
 */
export function calculateNextThresholdFrom(xp: number, thresholds: readonly LevelThreshold[] = DEFAULT_LEVEL_THRESHOLDS): LevelThreshold | undefined {
	return thresholds.find((t) => t.xp > xp);
}

/** Formatage standard français d'un montant d'XP. */
export function formatXP(xp: number): string {
	return xp.toLocaleString("fr-FR");
}
