"use client";

import { createShenronAuthClient } from "@shenron/auth/client";
import { SITE_URL } from "@/lib/config";

/**
 * Client Better Auth — utilisé dans les composants client uniquement.
 *
 * `baseURL` explicite : Better Auth doit connaître l'origine pour construire
 * les URLs OAuth. Sans ça, en SSR/build ou edge runtime, ça peut pointer
 * vers le mauvais host et provoquer des redirects en boucle.
 *
 * `createShenronAuthClient` lit `window.location.origin` en runtime (composant
 * client), repli sur `SITE_URL` (`@/lib/config`, source unique) pour le SSR
 * initial.
 */
export const authClient = createShenronAuthClient({
	fallbackURL: SITE_URL,
});
