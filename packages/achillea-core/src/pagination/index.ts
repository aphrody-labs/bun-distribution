/**
 * Arithmétique de pagination — identique côté serveur (calcul des métadonnées)
 * et côté client (bornes, navigation, offsets), donc calculée une seule fois.
 */

import type { PageMeta, PageSizeMeta, PageQuery } from "@rosegriffon/achillea-types";

import { toCount, toPositiveInt } from "../numbers/index";

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/** Ramène une taille de page dans `[1, MAX_PAGE_SIZE]`. */
export function clampPageSize(size: number | undefined, fallback = DEFAULT_PAGE_SIZE): number {
	const n = Number(size);
	if (!Number.isFinite(n) || n < 1) return fallback;
	return Math.min(Math.floor(n), MAX_PAGE_SIZE);
}

/** Nombre total de pages (0 élément → 0 page, pas 1). */
export function pageCount(total: number, pageSize: number): number {
	return Math.ceil(toCount(total) / clampPageSize(pageSize));
}

/** Ramène un numéro de page dans `[1, pageCount]` (1 si la liste est vide). */
export function clampPage(page: number | undefined, total: number, pageSize: number): number {
	const pages = pageCount(total, pageSize);
	const n = Number(page);
	if (!Number.isFinite(n) || n < 1) return 1;
	if (pages === 0) return 1;
	return Math.min(Math.floor(n), pages);
}

/** Décalage SQL `OFFSET` correspondant à une page 1-indexée. */
export function pageOffset(page: number | undefined, pageSize: number): number {
	return (toPositiveInt(page) - 1) * clampPageSize(pageSize);
}

/** Métadonnées au format `Paginated<T>` (`limit`). */
export function buildPageMeta(page: number, limit: number, total: number): PageMeta {
	const size = clampPageSize(limit);
	return {
		page: clampPage(page, total, size),
		limit: size,
		total: toCount(total),
		pageCount: pageCount(total, size),
	};
}

/** Métadonnées au format `PagedList<T>` (`pageSize`). */
export function buildPageSizeMeta(page: number, pageSize: number, total: number): PageSizeMeta {
	const size = clampPageSize(pageSize);
	return {
		page: clampPage(page, total, size),
		pageSize: size,
		pageCount: pageCount(total, size),
	};
}

/** `true` s'il existe une page suivante. */
export function hasNextPage(page: number, total: number, pageSize: number): boolean {
	return clampPage(page, total, pageSize) < pageCount(total, pageSize);
}

/**
 * Normalise une requête de pagination entrante (query string, formulaire) en
 * valeurs sûres. À appeler côté API avant toute requête SQL.
 */
export function normalizePageQuery(query: PageQuery | undefined): {
	page: number;
	pageSize: number;
	offset: number;
} {
	const pageSize = clampPageSize(query?.pageSize);
	const page = toPositiveInt(query?.page);
	return { page, pageSize, offset: (page - 1) * pageSize };
}

/**
 * Fenêtre de numéros de page à afficher autour de la page courante.
 * `[1, …, 4, 5, 6, …, 20]` se construit à partir de ce tableau.
 */
export function pageWindow(current: number, pages: number, radius = 2): number[] {
	const total = toCount(pages);
	if (total <= 0) return [];

	// La page courante est d'abord recalée dans les bornes : sans ça, une page
	// hors intervalle (`-5`, `999`, `NaN`) faisait passer la borne basse
	// au-dessus de la borne haute et la fenêtre sortait VIDE — la pagination
	// disparaissait de l'écran au lieu de se recaler sur la page la plus proche.
	const anchor = Math.min(total, toPositiveInt(current));
	const span = toCount(radius);
	const from = Math.max(1, anchor - span);
	const to = Math.min(total, anchor + span);
	const numbers: number[] = [];
	for (let i = from; i <= to; i++) numbers.push(i);
	return numbers;
}
