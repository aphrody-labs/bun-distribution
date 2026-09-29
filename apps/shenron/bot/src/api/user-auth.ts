/**
 * Auth user-acting pour les routes de jeu accessibles depuis le site.
 *
 * Flow :
 *   site (Next, server-side)
 *     → vérifie session Better Auth → récupère discordId
 *     → signe `${discordId}:${timestampMs}` via HMAC-SHA256(API_USER_SECRET)
 *     → POST bot avec headers :
 *         X-Acting-User: <discordId>
 *         X-Acting-Ts:   <timestampMs>
 *         X-Acting-Sig:  <hex sig>
 *
 * Le bot vérifie : signature valide, timestamp dans une fenêtre ±5min
 * (anti-replay). Retourne `discordId` ou `null`.
 *
 * Note : cette auth NE remplace PAS Bearer admin. Les routes admin restent
 * gated par `checkAdmin()`. Les routes user-only doivent appeler
 * `verifyActingUser(req)`.
 */
import { verifyActingUser as verifyActingUserHeaders } from "@shenron/auth/acting-user";
import { ENV_ALIASES, envFirst } from "@shenron/config/env";
import { env } from "~/lib/env";
import { logger } from "~/lib/logger";

/**
 * Secret partagé site ↔ bot : `SHENRON_USER_SECRET` (nom canonique) sinon
 * `API_USER_SECRET` (`ENV_ALIASES.actingUserSecret`), lu à chaque appel.
 */
export function actingUserSecret(): string | undefined {
	return envFirst(
		{ SHENRON_USER_SECRET: Bun.env.SHENRON_USER_SECRET, API_USER_SECRET: env.API_USER_SECRET },
		ENV_ALIASES.actingUserSecret
	)?.value;
}

/** Retourne le `discordId` de l'utilisateur agissant, ou null si invalide. */
export function verifyActingUser(req: Request, nowMs?: number): string | null {
	const result = verifyActingUserHeaders(req.headers, { secret: actingUserSecret(), nowMs });
	if (result.ok) return result.discordId;
	if (result.code === "not_configured") {
		logger.warn("API_USER_SECRET non configuré — routes user-auth désactivées");
	}
	return null;
}
