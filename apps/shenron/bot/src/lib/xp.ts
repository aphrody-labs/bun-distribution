import { LEVEL_THRESHOLDS } from "./constants";

export type LevelThreshold = { level: number; xp: number };

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
 * Niveau atteint pour un XP. Reste en TS pur — bench (Bun 1.3.14, 1M iter)
 * mesure 5× plus lent en Rust à cause de l'overhead FFI napi (~130ns/call)
 * pour une boucle de 10 items. Le hot-path message/voice tick l'appelle
 * 60+ fois/seconde donc on garde TS.
 *
 * Pour les use cases qui ont besoin de la version riche `{current, nextLevel,
 * nextLevelXp, needed}`, utiliser `native.xpProgress(xp)` (cf. `lib/native.ts`).
 */
export function levelForXP(xp: number): number {
	let level = 0;
	for (const t of ACTIVE_THRESHOLDS) {
		if (xp >= t.xp) level = t.level;
		else break;
	}
	return level;
}

export function xpRequiredForLevel(level: number): number {
	return ACTIVE_THRESHOLDS.find((t) => t.level === level)?.xp ?? Infinity;
}

export function nextThresholdFrom(xp: number) {
	return ACTIVE_THRESHOLDS.find((t) => t.xp > xp);
}

export function randomInt(min: number, max: number): number {
	return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function formatXP(xp: number): string {
	return xp.toLocaleString("fr-FR");
}
