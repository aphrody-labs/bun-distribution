import { refreshAccessToken } from "@/lib/patreon/client";
import type { PatreonTokenResponse } from "@/lib/patreon/types";

/**
 * Helper unifié de rafraîchissement de tokens OAuth (grant_type=refresh_token).
 *
 * Constat (audit du 2026-06) : le POST réel vers le token endpoint Patreon
 * vit déjà à UN seul endroit — `@rosegriffon/patreon-bun` (`oauth.refreshToken`),
 * exposé via `@/lib/patreon/client::refreshAccessToken`. Aucun fetch dupliqué.
 *
 * Ce qui ÉTAIT dupliqué dans 3 fichiers (`sync.ts`, `live.ts`, `export.ts`) :
 *   1. le test de fraîcheur « expiresAt - now > margin » ;
 *   2. l'appel à `refreshAccessToken` suivi du calcul de `expiresAt`
 *      à partir de `expires_in` (secondes → Date absolue).
 *
 * Ce helper extrait exactement ces deux primitives — SANS toucher à la
 * sémantique de persistance propre à chaque appelant (verrou optimiste,
 * update simple, ou bootstrap depuis env). Les providers délégués à
 * better-auth (Discord/Google) NE rafraîchissent PAS manuellement ici ;
 * Twitch (`rgtv/status`) utilise `client_credentials`, pas `refresh_token`.
 */

/** Résultat normalisé d'un rafraîchissement OAuth. */
export interface RefreshedOAuthToken {
  /** Access token clair, immédiatement utilisable en Bearer. */
  accessToken: string;
  /** Nouveau refresh token (Patreon effectue une rotation). */
  refreshToken: string;
  /** Scope renvoyé par le provider (peut être vide). */
  scope: string;
  /** Instant d'expiration absolu calculé depuis `expires_in`. */
  expiresAt: Date;
  /** Payload brut du provider, pour les appelants qui en ont besoin. */
  raw: PatreonTokenResponse;
}

/**
 * Vrai si le token reste valide au-delà de `marginMs` (marge de sécurité
 * pour ne pas servir un token sur le point d'expirer pendant un fetch).
 */
export function isTokenFresh(expiresAt: Date | number, marginMs: number): boolean {
  const at = typeof expiresAt === "number" ? expiresAt : expiresAt.getTime();
  return at - Date.now() > marginMs;
}

/**
 * Rafraîchit un token Patreon et normalise la réponse (calcul de `expiresAt`
 * inclus). Centralise l'appel au token endpoint + la conversion `expires_in`.
 */
export async function refreshOAuthToken(refreshToken: string): Promise<RefreshedOAuthToken> {
  const refreshed = await refreshAccessToken(refreshToken);
  return {
    accessToken: refreshed.access_token,
    expiresAt: new Date(Date.now() + refreshed.expires_in * 1000),
    raw: refreshed,
    refreshToken: refreshed.refresh_token,
    scope: refreshed.scope,
  };
}
