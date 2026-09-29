/**
 * Règles de validation des notes — **client-safe**, sans `server-only`.
 *
 * Extraites de `lib/ratings.ts` pour une raison précise : ce module-là importe
 * `server-only`, donc il ne peut être importé ni depuis un composant client ni
 * depuis `bun test`. Conséquence, `tests/ratings.test.ts` re-déclarait
 * localement `isRatingTargetType` et `clampScore` et testait donc une COPIE :
 * modifier la vraie implémentation ne pouvait pas faire échouer le test. Le
 * fichier l'admettait lui-même en en-tête (« on rejoue les règles ici »).
 *
 * `lib/ratings.ts` réexporte tout ce qui suit : rien à changer côté appelants.
 */
import { RATING_TARGET_TYPES, type RatingTargetType } from "@/db/schema";

export { RATING_TARGET_TYPES, type RatingTargetType };

export const RATING_COMMENT_MAX = 800;
const RATING_SCORE_MIN = 1;
const RATING_SCORE_MAX = 5;

export function isRatingTargetType(v: unknown): v is RatingTargetType {
	return typeof v === "string" && (RATING_TARGET_TYPES as readonly string[]).includes(v);
}

/** Ramène une note à un entier de 1 à 5 ; `null` si la valeur est inexploitable. */
export function clampScore(n: number): number | null {
	if (!Number.isFinite(n)) return null;
	const s = Math.round(n);
	if (s < RATING_SCORE_MIN || s > RATING_SCORE_MAX) return null;
	return s;
}
