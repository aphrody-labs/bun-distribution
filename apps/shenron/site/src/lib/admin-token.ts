import "server-only";
import {
	ADMIN_COOKIE as PACKAGE_ADMIN_COOKIE,
	ADMIN_COOKIE_TTL_MS,
	createAdminCookieCodec,
	type AdminCookieCodec,
} from "@shenron/auth/tokens";
import { timingSafeEqualString } from "@shenron/auth/crypto";
import { env } from "@/lib/env";

/**
 * Admin par token — accès admin du site SANS Discord OAuth.
 *
 * Filet de sécurité (ex. perte d'accès Discord) : l'admin saisit le
 * `SHENRON_ADMIN_TOKEN` (même secret que le dashboard du bot) sur `/admin-access`.
 * On pose alors un cookie httpOnly **signé** (HMAC `BETTER_AUTH_SECRET`) que
 * `getCurrentUser()` reconnaît pour élever la session en admin.
 *
 * Façade de `createAdminCookieCodec` (`@shenron/auth/tokens`), format identique
 * octet pour octet : `${exp}.${hex(HMAC(secret, "admin:" + exp + ":" + fp))}`.
 *
 * Sécurité :
 *  - comparaison du token en temps constant ;
 *  - le cookie ne contient JAMAIS le token, seulement `expiry.hmac` — non
 *    rejouable après expiration, non forgeable sans le secret serveur ;
 *  - la signature est **liée à l'empreinte du token courant** : faire tourner
 *    `SHENRON_ADMIN_TOKEN` invalide instantanément tous les cookies émis ;
 *  - si `SHENRON_ADMIN_TOKEN` n'est pas configuré, la fonctionnalité est
 *    entièrement désactivée (aucun cookie accepté ni émis).
 */

export const ADMIN_COOKIE = PACKAGE_ADMIN_COOKIE;

let codecCache: { secret: string; token: string; codec: AdminCookieCodec } | null = null;

/** Codec construit sur les valeurs d'env courantes (reconstruit si elles changent). */
function codec(): AdminCookieCodec {
	const secret = env.BETTER_AUTH_SECRET;
	const token = env.SHENRON_ADMIN_TOKEN ?? "";
	if (!codecCache || codecCache.secret !== secret || codecCache.token !== token) {
		codecCache = { secret, token, codec: createAdminCookieCodec({ secret, masterToken: token }) };
	}
	return codecCache.codec;
}

/** 7 jours, en secondes (cookie porteur de droits admin). */
export const ADMIN_COOKIE_MAX_AGE = Math.floor(ADMIN_COOKIE_TTL_MS / 1000);

/** L'accès admin par token est-il activé côté serveur ? */
export function adminTokenEnabled(): boolean {
	return !!env.SHENRON_ADMIN_TOKEN;
}

/** Vrai si `input` == `SHENRON_ADMIN_TOKEN` (temps constant). */
export function tokenMatches(input: string): boolean {
	const t = env.SHENRON_ADMIN_TOKEN;
	if (!t || !input) return false;
	return timingSafeEqualString(input, t);
}

/** Valeur du cookie signé à poser après un login token réussi. */
export function buildAdminCookieValue(): string {
	return codec().sign();
}

/** Durée de validité étendue pour connexion souveraine / durable : 30 jours (secondes). */
export const DURABLE_ADMIN_COOKIE_MAX_AGE = 30 * 24 * 60 * 60;

/** Vérifie un cookie admin : non expiré + signature valide. */
export function verifyAdminCookie(value: string | undefined | null): boolean {
	if (!value || !adminTokenEnabled()) return false;
	return codec().verify(value);
}

/**
 * Vérifie si la valeur passée correspond soit au token maître en clair
 * (SHENRON_ADMIN_TOKEN), soit à un cookie admin signé valide.
 */
export function verifyAdminTokenOrBearer(value: string | undefined | null): boolean {
	if (!value || !adminTokenEnabled()) return false;
	const trimmed = value.trim();
	if (tokenMatches(trimmed)) return true;
	return verifyAdminCookie(trimmed);
}

