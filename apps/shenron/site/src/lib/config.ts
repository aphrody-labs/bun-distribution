/**
 * config — **source unique** des URL/endpoints du site (client-safe).
 *
 * Avant : la base de l'API bot (`https://bot.dragonballfr.com`), l'invitation
 * Discord (`https://discord.gg/dbfr`) et l'URL du site étaient recopiées en dur
 * dans ~25 fichiers, chacun avec sa propre résolution `process.env.X ?? "…"`.
 * Une migration de domaine devait alors toucher 25 endroits. Désormais tout
 * passe par ce module — un seul `process.env` lu, une seule valeur par défaut.
 *
 * Universel (importable par RSC, route handlers ET Client Components) : on lit
 * `process.env` directement (pas `@/lib/env`, dont le proxy `@t3-oss` jette sur
 * accès à une var *server* depuis le client). Résolution **public d'abord** :
 *  - `NEXT_PUBLIC_*` est inliné dans le bundle client par Next, donc disponible
 *    partout ;
 *  - la var *server* (non publique) sert de repli côté serveur uniquement
 *    (vaut `undefined` côté client → on tombe sur la valeur par défaut).
 *
 * C'est la SEULE exception autorisée à la règle « pas de `process.env` hors
 * `env.ts` » : ce fichier EST la centralisation que cette règle vise.
 */

import {
	DEFAULT_PUBLIC_ORIGINS,
	joinUrl,
	originOf,
	resolveApiUrl,
	resolveAssetsUrl,
	resolveSiteUrl,
} from "@shenron/config/public-urls";

/**
 * Accès littéraux (Next n'inline `NEXT_PUBLIC_*` que sous cette forme) ; la
 * précédence et les noms historiques vivent dans `@shenron/config/public-urls`.
 */
const trimSlash = (u: string): string => u.replace(/\/+$/, "");

const PUBLIC_ENV = {
	NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
	NEXT_PUBLIC_SHENRON_API_URL: process.env.NEXT_PUBLIC_SHENRON_API_URL,
	NEXT_PUBLIC_SHENRON_ASSETS_URL: process.env.NEXT_PUBLIC_SHENRON_ASSETS_URL,
	SHENRON_PUBLIC_SITE_URL: process.env.SHENRON_PUBLIC_SITE_URL,
	SHENRON_PUBLIC_API_URL: process.env.SHENRON_PUBLIC_API_URL,
	SHENRON_PUBLIC_ASSETS_URL: process.env.SHENRON_PUBLIC_ASSETS_URL,
	SHENRON_API_URL: process.env.SHENRON_API_URL,
	BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
};


/** Hôte canonique du bot (API REST + assets + SSE + canvas). */
export const BOT_HOST: string = DEFAULT_PUBLIC_ORIGINS.api;
/** Domaine canonique du site (Vercel). */
export const SITE_HOST: string = DEFAULT_PUBLIC_ORIGINS.site;
/**
 * Invitation Discord par défaut. Vanity `dragonballfr` = serveur « Dragon Ball FR »
 * (guild 934894610545770506). NE PAS remettre `dbfr` : ce code a été réattribué à
 * un autre serveur (« Goldbase Collection ») → il enverrait les visiteurs ailleurs.
 */
const DISCORD_DEFAULT = "https://discord.gg/dragonballfr";

/**
 * Base de l'API du bot Shenron (runtime, RAG, proxies admin/user, uploads).
 * Sans slash final.
 */
export const API_URL = resolveApiUrl(PUBLIC_ENV);

/**
 * Base des assets self-hostés par le bot (images wiki, banners, cartes canvas).
 * Même hôte que l'API par défaut ; un CDN dédié peut être posé via
 * `NEXT_PUBLIC_SHENRON_ASSETS_URL`.
 */
export const ASSET_BASE = resolveAssetsUrl(PUBLIC_ENV);

/**
 * Origine seule (schéma + hôte) de `ASSET_BASE`, pour les indices de connexion
 * (`<link rel="preconnect">`). Un preconnect doit porter une ORIGINE, pas une
 * URL avec chemin — sinon le navigateur l'ignore silencieusement.
 */
export const ASSET_ORIGIN = originOf(ASSET_BASE);

/** Origine de l'API bot (indices de connexion, repli d'assets). */
export const API_ORIGIN = originOf(API_URL);

/** Origine du CDN objet (planches manga, illustrations wiki). */
export const CDN_ORIGIN: string = DEFAULT_PUBLIC_ORIGINS.cdn;

/** URL publique du site (OG, liens absolus, metadataBase). Sans slash final. */
export const SITE_URL = resolveSiteUrl(PUBLIC_ENV);

/** Invitation Discord du serveur DBFR. */
export const DISCORD_INVITE = process.env.NEXT_PUBLIC_DISCORD_INVITE_URL ?? DISCORD_DEFAULT;

/** Construit une URL absolue sur l'API bot : `apiUrl("api/public/stats")`. */
export function apiUrl(path = ""): string {
	return joinUrl(API_URL, path);
}

/** Construit une URL absolue sur l'hôte des assets bot. */
function assetBaseUrl(path = ""): string {
	return joinUrl(ASSET_BASE, path);
}

/**
 * Base de l'API du bot pour les appels **serveur** (client admin
 * `@/lib/bot-admin`, cockpit IA `@/lib/ia-cockpit-server`). Sans slash final.
 *
 * Précédence (première valeur non vide) :
 *  1. `BOT_INTERNAL_URL` — URL interne (boucle locale / réseau privé) du bot,
 *     serveur uniquement : évite de repasser par le domaine public ;
 *  2. sinon {@link API_URL} : `NEXT_PUBLIC_SHENRON_API_URL`, puis
 *     `SHENRON_API_URL`, puis {@link BOT_HOST}.
 *
 * `db-universe.ts` garde sa propre résolution jusqu'à SH-API-4.
 */
export function botApiBaseUrl(env: Record<string, string | undefined> = process.env): string {
	const internal = env.BOT_INTERNAL_URL?.trim();
	if (internal) return trimSlash(internal);
	const configured = (env.NEXT_PUBLIC_SHENRON_API_URL ?? env.SHENRON_API_URL)?.trim();
	return trimSlash(configured || BOT_HOST);
}
