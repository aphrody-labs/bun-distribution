/**
 * Coercition numérique défensive.
 *
 * Le piège corrigé ici est `Math.max(0, Math.floor(x))` : il a l'air de borner,
 * mais `Math.floor(NaN)` vaut `NaN` et `Math.max(0, NaN)` vaut `NaN`. Le
 * garde-fou laisse donc passer exactement la valeur contre laquelle il était
 * censé protéger, et le `NaN` se propage jusqu'à l'écran — « NaN matchs »,
 * une pagination vide, un tableau qui ne s'affiche pas.
 *
 * `NaN` et `Infinity` arrivent en vrai : `Number(queryString.page)`,
 * `total / 0`, une colonne SQL nulle castée. Ces fonctions sont le point de
 * passage obligé de toute entrée numérique venue de l'extérieur.
 */

/**
 * Nombre fini, ou `fallback`.
 *
 * `Number()` seul ne suffit pas : `Number(null)`, `Number("")` et `Number([])`
 * valent `0`, un zéro *fini* qui passe tous les garde-fous. Une colonne SQL
 * nulle devenait donc un solde de 0 ou une capacité de 0 au lieu de retomber
 * sur le repli — une valeur plausible et fausse, le pire des deux mondes.
 */
export function toNumber(value: unknown): number | null {
	if (value === null || value === undefined || typeof value === "boolean") return null;
	if (typeof value === "string" && value.trim() === "") return null;
	if (typeof value === "object") return null;

	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

/** Nombre fini, ou `fallback`. Neutralise `NaN`, `±Infinity`, `null` et `""`. */
export function toFinite(value: unknown, fallback = 0): number {
	return toNumber(value) ?? fallback;
}

/** Entier `>= 0` (un décompte, une taille, un total). */
export function toCount(value: unknown, fallback = 0): number {
	const parsed = toNumber(value);
	if (parsed === null) return fallback;
	return Math.max(0, Math.floor(parsed));
}

/** Entier `>= minimum` (un numéro de page, un nombre de manches). */
export function toPositiveInt(value: unknown, fallback = 1, minimum = 1): number {
	const parsed = toNumber(value);
	if (parsed === null) return fallback;
	return Math.max(minimum, Math.floor(parsed));
}

/** Ramène `value` dans `[min, max]`, `NaN` compris. */
export function clamp(value: unknown, min: number, max: number): number {
	const parsed = toNumber(value);
	if (parsed === null) return min;
	return Math.min(max, Math.max(min, parsed));
}

/**
 * Modulo **euclidien** : le résultat a toujours le signe du diviseur.
 *
 * `-1 % 6` vaut `-1` en JavaScript, pas `5`. Sur un index de tableau ou un
 * index d'avatar par défaut, ça donne un accès hors bornes silencieux.
 */
export function euclideanMod(value: number, modulus: number): number {
	// `+ 0` normalise `-0` en `0` : `Object.is(-0, 0)` est faux, et un `-0` qui
	// remonte jusqu'à une comparaison stricte produit une inégalité invisible.
	return (((value % modulus) + modulus) % modulus) + 0;
}
