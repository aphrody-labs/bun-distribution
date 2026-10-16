// Source: apps/shenron/site/src/lib/epoch.ts at 8172f535ce (preserved Git history).
/**
 * Horodatages du wiki — secondes ou millisecondes (client-safe).
 *
 * `bot.db_databooks.published_at` et ses voisins sont des `bigint` qui portent
 * tantôt des secondes (l'ingest historique), tantôt des millisecondes (les
 * écritures récentes venues du JavaScript). Six endroits du code tranchaient
 * chacun de leur côté avec `v >= 1e12`.
 *
 * Ce seuil est FAUX pour les dates anciennes : une date de 1996 en millisecondes
 * vaut 8,37 × 10¹¹, donc en dessous de 10¹² — elle était relue comme des
 * secondes et projetée en l'an 28517. Le corpus va de 1985 à 2026, soit
 * 4,8 × 10⁸ à 1,8 × 10⁹ en secondes et 4,8 × 10¹¹ à 1,8 × 10¹² en millisecondes :
 * 10¹¹ sépare les deux familles sans ambiguïté et couvre 1973–5138 en secondes.
 */

/** Seuil de discrimination secondes / millisecondes. */
const SEUIL_MS = 1e11;

/** Convertit un horodatage de la base en millisecondes, quelle que soit son unité. */
export function toMillis(v: number): number {
  return v >= SEUIL_MS ? v : v * 1000;
}

/** Année d'un horodatage de la base, ou `null` s'il est inexploitable. */
export function yearOf(v: number | null | undefined): number | null {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  const an = new Date(toMillis(v)).getFullYear();
  return Number.isFinite(an) ? an : null;
}

/**
 * Ramène un horodatage d'écriture en SECONDES.
 *
 * Toute la base wiki stocke des secondes — vérifié le 2026-08-21 sur
 * `db_episodes.air_date`, `db_movies.release_date`, `db_games.release_date` et
 * `db_databooks.published_at` : zéro valeur en millisecondes. Une API ouverte à
 * des clients externes est le moyen le plus court d'y introduire un `Date.now()`
 * et de créer deux unités dans la même colonne. On normalise donc à l'entrée.
 */
export function toSeconds(v: number): number {
  return Math.trunc(v >= SEUIL_MS ? v / 1000 : v);
}
