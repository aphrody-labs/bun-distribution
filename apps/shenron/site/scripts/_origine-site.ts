/**
 * Internal HTTP origin for the Shenron site API.
 *
 * Les scripts d'ops (dépôt de transcriptions, corrections OCR) écrivent par
 * l'API du site en loopback. L'adresse canonique vient du catalogue
 * `aphrody-infra` (`127.0.0.1:5011`) ; les développeurs et tâches de preview
 * peuvent la remplacer par `SITE_INTERNAL_URL` ou `DATABOOKS_API_BASE`.
 */

/**
 * Base d'API à utiliser. `$DATABOOKS_API_BASE` reste prioritaire (tests, preview,
 * dépôt depuis un poste distant vers `https://dragonballfr.com`).
 */
export function origineSite(): string {
	const forcee = process.env.DATABOOKS_API_BASE?.trim() || process.env.SITE_INTERNAL_URL?.trim();
	if (forcee) return forcee.replace(/\/$/, "");
	return "http://127.0.0.1:5011";
}
