/**
 * `/auth` — session unifiée Rose Griffon, jeton temps réel, déconnexion.
 *
 * Achilléa ne possède plus l'OAuth Discord : le site Rose Griffon/Better Auth
 * est l'unique propriétaire du callback Discord.
 */

import { z } from "zod";

import type { SessionUserDTO } from "@rosegriffon/achillea-types/domain/user";

import { okResponseSchema, userDtoSchema } from "./common";
import { AchilleaResource, type AchilleaClientResult } from "./http";
import type { RealtimeTokenResponse } from "./pending-contracts";

/**
 * Origine publique du site Rose Griffon. Ce paquet est consommé côté navigateur
 * (client Achilléa) autant que côté serveur : pas d'accès à `@/lib/site-url`
 * (interne à `apps/website`), donc un repli local au même schéma
 * (`process.env.NEXT_PUBLIC_BASE_URL` puis l'apex de production).
 */
const RG_ORIGIN = process.env.NEXT_PUBLIC_BASE_URL || "https://rosegriffon.fr";

export const sessionUserSchema = userDtoSchema satisfies z.ZodType<SessionUserDTO>;

export const realtimeTokenResponseSchema = z.object({
  token: z.string(),
  expiresIn: z.number(),
  userId: z.string(),
}) satisfies z.ZodType<RealtimeTokenResponse>;

const providerOAuthUrlSchema = z.object({ url: z.string().url() });

/** Session et fournisseurs OAuth de l'API Achilléa. */
export class AuthResource extends AchilleaResource {
  /** `GET /auth/me` — utilisateur de la session courante. */
  me(): Promise<AchilleaClientResult<SessionUserDTO>> {
    return this.http.get("/auth/me", sessionUserSchema);
  }

  /** `GET /auth/token` — jeton court pour le client temps réel Colyseus. */
  realtimeToken(): Promise<AchilleaClientResult<RealtimeTokenResponse>> {
    return this.http.get("/auth/token", realtimeTokenResponseSchema);
  }

  /** `POST /auth/logout` — route canonique de déconnexion. */
  logout(): Promise<AchilleaClientResult<{ ok: boolean }>> {
    return this.http.post("/auth/logout", okResponseSchema);
  }

  /**
   * URL de connexion canonique Rose Griffon.
   *
   * Achillea ne doit plus envoyer de nouveaux utilisateurs vers son alias
   * historique `/api/auth/discord`: Better Auth/Rose Griffon est l'unique
   * propriétaire de l'autorisation et du callback Discord.
   */
  discordLoginUrl(state?: string): string {
    const url = new URL(`${RG_ORIGIN}/login`);
    if (state) url.searchParams.set("redirect", state);
    return url.toString();
  }

  /** Callback Discord canonique enregistré dans le portail développeur. */
  callbackUrl(): string {
    return `${RG_ORIGIN}/api/auth/callback/discord`;
  }

  /** URL de `GET /auth/challonge` — liaison du compte Challonge (session requise). */
  challongeLinkUrl(): string {
    return this.http.url("/auth/challonge");
  }

  /** URL de `GET /auth/twitch` — liaison du compte Twitch (session requise). */
  twitchLinkUrl(): string {
    return this.http.url("/auth/twitch");
  }

  /** URL d'association d'un fournisseur, générée par l'API unifiée. */
  providerOAuthUrl(
    provider: "twitch" | "challonge",
    userId: string,
    options?: { authorization?: string },
  ): Promise<AchilleaClientResult<{ url: string }>> {
    return this.http.get(`/auth/oauth/${provider}/start`, providerOAuthUrlSchema, {
      query: { userId },
      headers: options?.authorization ? { Authorization: options.authorization } : undefined,
    });
  }

  /**
   * URL de `GET /auth/test-login` — session de test anonyme.
   * Hors production uniquement, et gardée par `TEST_LOGIN_SECRET` (404 sinon).
   */
  testLoginUrl(key: string, state?: string): string {
    return this.http.url("/auth/test-login", { key, state });
  }
}
