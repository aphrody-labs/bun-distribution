/**
 * Utilitaires texte partagés par la liste et la fiche épisode.
 * Server-safe (aucune dépendance postgres) → importable côté RSC, y compris
 * dans `generateMetadata`.
 */

/**
 * Nettoie un synopsis Markdown pour un usage en texte brut (meta description,
 * og:description, JSON-LD, aperçu de liste) : retire les crédits « (Sources:…) »,
 * la syntaxe Markdown (`*_#>\``), écrase les espaces et tronque à `max` caractères.
 */
export function excerpt(text: string | null, max = 160): string {
	if (!text) return "";
	const clean = text
		.replace(/_?\(Sources?\s*:[^)]*\)_?/gi, "")
		.replace(/[*_#>`]/g, "")
		.replace(/\s+/g, " ")
		.trim();
	return clean.length > max ? `${clean.slice(0, max).trimEnd()}…` : clean;
}
