// SPDX-License-Identifier: Apache-2.0
import { LEVEL_THRESHOLDS } from "./constants";
import {
	calculateLevelForXP,
	calculateNextThresholdFrom,
	calculateXpRequiredForLevel,
	formatXP as formatXpHelper,
	type LevelThreshold,
} from "@shenron/config/xp";

export type { LevelThreshold };

/**
 * Paliers ACTIFS. Défaut = `LEVEL_THRESHOLDS` (en dur), mais éditables depuis
 * l'admin : `loadLevelThresholds(db)` (au boot) et l'API remplacent ce tableau
 * par ceux stockés en DB (`guild_settings` clé `xp.thresholds`). Toujours trié
 * par xp croissant (invariant de `levelForXP`/`nextThresholdFrom`).
 */
let ACTIVE_THRESHOLDS: readonly LevelThreshold[] = LEVEL_THRESHOLDS;

/** Remplace la courbe de niveaux active (validée + triée par xp croissant). */
export function setLevelThresholds(rows: LevelThreshold[]): void {
	const clean = rows
		.filter((r) => Number.isFinite(r.level) && Number.isFinite(r.xp) && r.xp >= 0)
		.toSorted((a, b) => a.xp - b.xp);
	ACTIVE_THRESHOLDS = clean.length ? clean : LEVEL_THRESHOLDS;
}

/** Courbe de niveaux active (source unique de vérité runtime). */
export function getLevelThresholds(): readonly LevelThreshold[] {
	return ACTIVE_THRESHOLDS;
}

/**
 * Niveau atteint pour un XP.
 */
export function levelForXP(xp: number): number {
	return calculateLevelForXP(xp, ACTIVE_THRESHOLDS);
}

export function xpRequiredForLevel(level: number): number {
	return calculateXpRequiredForLevel(level, ACTIVE_THRESHOLDS);
}

export function nextThresholdFrom(xp: number) {
	return calculateNextThresholdFrom(xp, ACTIVE_THRESHOLDS);
}

export function randomInt(min: number, max: number): number {
	return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function formatXP(xp: number): string {
	return formatXpHelper(xp);
}
