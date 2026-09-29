/**
 * Garde « admin ou jeton » partagée par les routes d'API qui acceptent soit une
 * session admin Better Auth, soit `Authorization: Bearer <jeton>` (outils hors
 * navigateur, scripts d'ingest, sondes).
 *
 * Volontairement sans `import "server-only"` : ce module n'importe que les
 * façades `@/lib/session` et `@/lib/api-token` (elles-mêmes server-only), de
 * sorte que les simulations `mock.module("@/lib/session" | "@/lib/api-token")`
 * des suites de tests continuent d'intercepter les deux chemins.
 *
 * Chaque route garde son propre mappeur de refus (`forbidden()`, 401 Bearer…) :
 * la garde ne renvoie que des décisions, jamais de réponse HTTP.
 */
// Imports en espace de noms : une suite qui ne simule que `isCurrentUserAdmin`
// (sans `getCurrentUser`) continue de lier ce module ; la résolution se fait à
// l'appel, jamais au chargement.
import * as session from "@/lib/session";
import type { CurrentUser } from "@/lib/session";
import * as apiToken from "@/lib/api-token";

/** Jeton porteur valide (sémantique inchangée de `@/lib/api-token`). */
export function hasValidApiToken(req: Request): boolean {
	return apiToken.hasValidApiToken(req);
}

/**
 * Session admin (`isCurrentUserAdmin` : staff Discord ou `users.roleAdmin`) OU
 * jeton porteur valide. La session est évaluée d'abord (ordre historique des
 * routes), le jeton ensuite.
 */
export async function isAdminOrToken(req: Request): Promise<boolean> {
	return (await session.isCurrentUserAdmin()) || hasValidApiToken(req);
}

export interface AdminUserOrTokenDecision {
	allowed: boolean;
	/** Utilisateur courant (identité d'audit des écritures), `null` si anonyme. */
	me: CurrentUser | null;
	/** `true` si le jeton porteur est valide (indépendamment de la session). */
	token: boolean;
}

/**
 * Variante des écritures (PUT/PATCH) : `getCurrentUser().user.roleAdmin === true`
 * OU jeton porteur valide. Renvoie aussi l'utilisateur pour l'identité d'audit
 * (`me?.discordId || me?.user?.id || "token-admin"`).
 */
export async function adminUserOrToken(req: Request): Promise<AdminUserOrTokenDecision> {
	const me = await session.getCurrentUser();
	const token = hasValidApiToken(req);
	return { allowed: me?.user?.roleAdmin === true || token, me, token };
}

/** Forme booléenne de {@link adminUserOrToken}. */
export async function isAdminUserOrToken(req: Request): Promise<boolean> {
	return (await adminUserOrToken(req)).allowed;
}
