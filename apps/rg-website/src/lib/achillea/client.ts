/**
 * Accès à l'API Achilléa depuis `apps/website`.
 *
 * Le client (`@rosegriffon/achillea-client`) est isomorphe : le même objet
 * fonctionne dans un Server Component, dans une route handler et dans un îlot
 * `"use client"`. C'est exactement ce qui rend la migration d'Achilléa vers
 * Next.js possible sans réécrire une couche d'accès.
 *
 * Module pur : il ne lit `process.env` qu'à l'appel, jamais au chargement, pour
 * rester importable côté navigateur.
 */

import {
	AchilleaClient,
	DEFAULT_ACHILLEA_API_URL,
	type AchilleaClientOptions,
} from "@rosegriffon/achillea-client";

/**
 * Origine de l'API. `NEXT_PUBLIC_*` est inliné au build : lancer le déploiement
 * depuis l'app, pas depuis la racine, sinon le `.env` racine l'écrase.
 */
export function achilleaApiUrl(): string {
	// Next only inlines direct NEXT_PUBLIC_* lookups. The variable is optional,
	// so an unconfigured browser build must also work without a global process.
	try {
		return process.env.NEXT_PUBLIC_ACHILLEA_API_URL || DEFAULT_ACHILLEA_API_URL;
	} catch {
		return DEFAULT_ACHILLEA_API_URL;
	}
}

/**
 * Client partagé pour le rendu serveur.
 *
 * Sans cache Next explicite : les vues Achilléa (classement, tournois en cours)
 * bougent à la minute, et un `force-cache` par défaut servirait un classement
 * périmé. Les appelants qui veulent du cache passent leur propre `fetch`.
 */
export function createAchilleaClient(options: AchilleaClientOptions = {}): AchilleaClient {
	return new AchilleaClient({
		baseUrl: achilleaApiUrl(),
		// Le cookie HttpOnly est posé sur .rosegriffon.fr et l'API est sur une
		// autre origine : fetch ne l'envoie pas avec son mode same-origin implicite.
		...(typeof window !== "undefined" ? { credentials: "include" as const } : {}),
		...options,
	});
}
