import { getLevelThresholds } from "./xp";

/**
 * Pure TypeScript implementation of the duration/hash/XP methods
 * that previously linked to the deleted napi-rs Rust native FFI crate.
 *
 * Les fonctions de niveau lisent la courbe ACTIVE (`getLevelThresholds`, éditable
 * depuis l'admin) — plus le tableau en dur — pour rester cohérentes avec `xp.ts`.
 */

/** Niveau DBZ atteint pour un montant d'XP donné. 0 si en-dessous du palier 1. */
function levelForXP(xp: number): number {
	let level = 0;
	for (const t of getLevelThresholds()) {
		if (xp >= t.xp) level = t.level;
		else break;
	}
	return level;
}

/** Progression vers le palier suivant. `undefined` si déjà au niveau max. */
type XpProgress = {
	current: number;
	nextLevel: number;
	nextLevelXp: number;
	needed: number;
};
function xpProgress(xp: number): XpProgress | undefined {
	const next = getLevelThresholds().find((t) => t.xp > xp);
	if (!next) return undefined;
	return {
		current: xp,
		nextLevel: next.level,
		nextLevelXp: next.xp,
		needed: next.xp - xp,
	};
}

/** Hash FNV-1a 32-bit hex (8 chars padded). */
function fnv1aHex(input: string): string {
	let h = 0x811c9dc5;
	const encoder = new TextEncoder();
	const bytes = encoder.encode(input);
	for (const b of bytes) {
		h ^= b;
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * ETag value pour le header HTTP (avec quotes englobantes — format spec).
 */
function etagOf(input: string | Uint8Array): string {
	const s = typeof input === "string" ? input : new TextDecoder("utf-8").decode(input);
	return `"${fnv1aHex(s)}"`;
}

/**
 * Parse `"10m"`, `"1h"`, `"7d"`, `"2w"` → millisecondes.
 * `undefined` si format invalide.
 */
export function parseDuration(input?: string): number | undefined {
	if (!input) return undefined;
	const trimmed = input.trim();
	if (trimmed.length === 0) return undefined;

	let i = 0;
	while (i < trimmed.length && trimmed.charCodeAt(i) >= 48 && trimmed.charCodeAt(i) <= 57) {
		i++;
	}
	if (i === 0) return undefined;

	const n = parseInt(trimmed.slice(0, i), 10);
	if (isNaN(n)) return undefined;

	let j = i;
	while (j < trimmed.length && (trimmed[j] === " " || trimmed[j] === "\t")) {
		j++;
	}
	if (j >= trimmed.length) return undefined;

	const unit = trimmed[j].toLowerCase();
	let mult: number;
	switch (unit) {
		case "s":
			mult = 1000;
			break;
		case "m":
			mult = 60000;
			break;
		case "h":
			mult = 3600000;
			break;
		case "d":
			mult = 86400000;
			break;
		case "w":
			mult = 604800000;
			break;
		default:
			return undefined;
	}

	for (let k = j + 1; k < trimmed.length; k++) {
		if (trimmed[k] !== " " && trimmed[k] !== "\t") {
			return undefined;
		}
	}

	return n * mult;
}

/** Format d'une durée en ms vers `"3j"`, `"4h"`, `"15min"`, `"42s"`. */
export function formatDuration(ms: number): string {
	const abs = Math.abs(ms);
	const divRound = (n: number, d: number) => Math.floor((n + d / 2) / d);

	if (abs >= 86400000) {
		return `${divRound(abs, 86400000)}j`;
	}
	if (abs >= 3600000) {
		return `${divRound(abs, 3600000)}h`;
	}
	if (abs >= 60000) {
		return `${divRound(abs, 60000)}min`;
	}
	return `${divRound(abs, 1000)}s`;
}
