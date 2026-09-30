// SPDX-License-Identifier: Apache-2.0
/**
 * Indice des prix du serveur — logique pure.
 *
 * L'indice suit la masse monétaire : quand les zénis en circulation doublent,
 * les prix montent, mais moins vite (élasticité < 1) et jamais de plus de
 * `maxDailyChange` par jour. Il ne descend pas sous 1 (on n'offre pas de soldes
 * parce que l'URSAF a brûlé des zénis) et ne dépasse pas le plafond, par
 * défaut le facteur d'inflation canon de la série (×2,96).
 */
import { CANON_INFLATION_FACTOR } from "./economy-canon";

export type InflationParams = {
	supply: number;
	referenceSupply: number;
	previousIndex: number;
	elasticity: number;
	maxDailyChange: number;
	floor?: number;
	ceiling?: number;
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Indice du jour, à partir de celui de la veille. */
export function computeIndex(p: InflationParams): number {
	const floor = p.floor ?? 1;
	const ceiling = p.ceiling ?? CANON_INFLATION_FACTOR;
	const previous = Number.isFinite(p.previousIndex) && p.previousIndex > 0 ? p.previousIndex : 1;
	if (!(p.referenceSupply > 0) || !(p.supply > 0)) return clamp(previous, floor, ceiling);

	const target = (p.supply / p.referenceSupply) ** clamp(p.elasticity, 0, 1);
	const step = clamp(p.maxDailyChange, 0, 1);
	const next = clamp(target, previous * (1 - step), previous * (1 + step));
	return Math.round(clamp(next, floor, ceiling) * 10_000) / 10_000;
}

/**
 * Prix indexé, arrondi à un palier lisible : un objet à 5 000 Ƶ ×1,037 coûte
 * 5 200 Ƶ, pas 5 185 Ƶ. Le pas grandit avec le montant.
 */
export function indexedPrice(base: number, index: number): number {
	if (!Number.isFinite(base) || base <= 0) return 0;
	const raw = base * (Number.isFinite(index) && index > 0 ? index : 1);
	const step =
		raw < 1_000 ? 10 : raw < 10_000 ? 100 : raw < 100_000 ? 500 : raw < 1_000_000 ? 5_000 : 50_000;
	return Math.max(step, Math.round(raw / step) * step);
}

/** Variation en pourcentage entre deux indices (signée, une décimale). */
export function changePercent(from: number, to: number): number {
	if (!(from > 0) || !Number.isFinite(to)) return 0;
	return Math.round(((to - from) / from) * 1000) / 10;
}
