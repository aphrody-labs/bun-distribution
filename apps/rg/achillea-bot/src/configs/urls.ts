import { env } from "@/env";

/**
 * Source UNIQUE des URLs d'infra du projet.
 * Tout est dérivé des variables d'env (WEBSITE_URL / PUBLIC_API_URL /
 * OAUTH_CALLBACK_BASE_URL) — aucune URL projet en dur ailleurs dans le code.
 */
export const urlsConfig = {
	/** Site public Achillea. */
	website: env.WEBSITE_URL,
	/** Hôte du site (sans protocole) — labels, fallback de host. */
	websiteHost: new URL(env.WEBSITE_URL).host,
	/** API publique (vérification de licences, etc.). */
	publicApi: env.PUBLIC_API_URL,
	/** API unifiée Elysia/Kysely — seule destination des nouveaux flux métier. */
	unifiedApi: env.UNIFIED_API_URL,
	/** Base de vérification d'une licence (QR) → page web publique /licence/verify/:qr. */
	licenseVerify: `${env.WEBSITE_URL}/licence/verify`,
	/** Origines CORS autorisées (CSV `WEB_ALLOWED_ORIGINS`, sinon localhost + site). */
	allowedOrigins: [
		...new Set(
			(env.WEB_ALLOWED_ORIGINS ?? `http://localhost:4200,${env.WEBSITE_URL}`)
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean)
		),
	],
} as const;
