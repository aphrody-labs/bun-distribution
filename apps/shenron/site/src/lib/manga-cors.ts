/**
 * En-têtes CORS des routes manga — lecture seule, ouverte à tout client.
 *
 * Partagés par les quatre routes plutôt que recopiés : une seule d'entre elles
 * qui oublierait `Access-Control-Allow-Origin` suffirait à rendre l'API
 * inutilisable depuis un navigateur, et le défaut ne se voit pas en `curl`.
 */
export const CORS_MANGA = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type",
	"Access-Control-Max-Age": "86400",
} as const;
