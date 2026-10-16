/**
 * Helpers de validation et de découpage purs (portables).
 *
 * Extraits de `apps/bot/src/utils/functions/{string,array}.ts` — uniquement les
 * fonctions sans dépendance (les helpers couplés à `case`/Discord restent côté bot).
 */

/**
 * Vérifie que toutes les valeurs sont des chaînes non vides (après `trim`).
 * Retourne `false` si aucune valeur n'est fournie.
 */
export function validString(...values: readonly unknown[]): boolean {
	if (values.length === 0) return false;
	for (const value of values) {
		if (typeof value !== "string") return false;
		if (value.trim().length === 0) return false;
	}
	return true;
}

/** Indique si une chaîne est une URL absolue valide (via le constructeur `URL`). */
export function isValidUrl(url: string): boolean {
	return URL.canParse(url);
}

/**
 * Accepte uniquement un chemin de retour local.
 *
 * Cette garde est partagée par les adaptateurs HTTP : aucun adaptateur (bot,
 * API, front) ne doit pouvoir transformer un `redirect` en URL externe.
 */
export function isSafeInternalPath(value: unknown): value is string {
	if (
		typeof value !== "string" ||
		value.length > 2_048 ||
		!value.startsWith("/") ||
		value.startsWith("//") ||
		value.includes("\\") ||
		// eslint-disable-next-line no-control-regex
		/[\u0000-\u001f\u007f]/.test(value)
	) {
		return false;
	}

	try {
		return new URL(value, "https://achillea.invalid").origin === "https://achillea.invalid";
	} catch {
		return false;
	}
}

/** Aligne un nombre à droite sur `align` caractères (padding espace). */
export function numberAlign(value: number, align: number = 2): string {
	return value.toString().padStart(align, " ");
}

/**
 * Découpe un tableau en sous-tableaux de taille `chunkSize` (2 par défaut).
 */
export function chunkArray<T>(array: readonly T[], chunkSize: number = 2): T[][] {
	const result: T[][] = [];
	for (let i = 0; i < array.length; i += chunkSize) {
		result.push(array.slice(i, i + chunkSize));
	}
	return result;
}
