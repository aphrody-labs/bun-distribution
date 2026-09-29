/**
 * Montage de `@shenron/api` dans le `Bun.serve` du bot (B14, S9 — docs/STACK.md §2.2, D7).
 *
 * - Les routes historiques gardent la priorité : Bun résout la table `routes`
 *   avant `fetch`, et le repli n'est consulté qu'après tous les préfixes
 *   historiques du `fetch`, juste avant le 404 JSON.
 * - Budget public unique : le limiteur Hono est un adaptateur sur les MÊMES
 *   seaux (`publicRateBuckets`) que `publicRateLimit` de `server.ts`.
 * - `/graphql` (S9) passe par ce même limiteur (60/min/IP, 429 + `Retry-After: 60`).
 *
 * Aucune dépendance au conteneur DI ni à l'environnement : tout est injecté,
 * ce qui rend le câblage testable sans Discord ni PostgreSQL.
 */
import {
	clientIpFromHeaders,
	isDirectLoopback as isDirectLoopbackHeaders,
} from "@shenron/config/net";
import { originOf, type PublicUrlEnv, resolveSiteUrl } from "@shenron/config/public-urls";
import { VERCEL_PRODUCTION_ALIAS } from "@shenron/auth/origins";
import { createWikiReadRepository } from "@shenron/db/repos/wiki";
import {
	createPublicCache,
	noopInvalidation,
	PUBLIC_RATE_LIMIT,
	type RateLimitPort,
} from "@shenron/api/http";
import { createShenronApi, type ShenronApi, type WikiReadPort } from "@shenron/api/server";

/** Seaux à fenêtre fixe partagés par toutes les routes publiques du bot. */
export type PublicRateBuckets = Map<string, { count: number; resetAt: number }>;

/** Origine du site Next en développement local (hors production uniquement). */
const SITE_DEV_ORIGIN = "http://localhost:3000";

/**
 * Origines CORS publiques du bot : l'origine du site résolue par
 * `@shenron/config/public-urls`, sa variante `www`, l'alias Vercel nommé
 * (INFRA-4) et, hors production, le site Next local.
 */
export function buildPublicCorsOrigins(env: PublicUrlEnv): string[] {
	const site = originOf(resolveSiteUrl(env));
	const origins = [site];
	try {
		const u = new URL(site);
		u.hostname = u.hostname.startsWith("www.") ? u.hostname.slice(4) : `www.${u.hostname}`;
		origins.push(u.origin);
	} catch {}
	origins.push(`https://${VERCEL_PRODUCTION_ALIAS}`);
	if (env.NODE_ENV?.trim() !== "production") origins.push(SITE_DEV_ORIGIN);
	return [...new Set(origins)];
}

/** Allowlist par défaut (origines par défaut, sans environnement). */
const PUBLIC_CORS_ORIGINS: readonly string[] = buildPublicCorsOrigins({});

/**
 * Un coup sur les seaux publics — sémantique exacte de `publicRateLimit`
 * historique : la première requête ouvre une fenêtre, au-delà de `limit`
 * dans la fenêtre la requête est refusée.
 */
export function hitPublicBucket(
	buckets: PublicRateBuckets,
	key: string,
	o: { limit: number; windowMs: number } = PUBLIC_RATE_LIMIT,
	now: number = Date.now()
): boolean {
	const bucket = buckets.get(key);
	if (!bucket || bucket.resetAt < now) {
		buckets.set(key, { count: 1, resetAt: now + o.windowMs });
		return o.limit >= 1;
	}
	bucket.count += 1;
	return bucket.count <= o.limit;
}

/**
 * Port `RateLimitPort` adossé aux seaux historiques. `@shenron/api` préfixe
 * ses clés par `public:` : on le retire pour partager le budget par IP avec
 * les routes historiques (clé = IP nue).
 */
export function bucketRateLimiter(
	buckets: PublicRateBuckets,
	now: () => number = Date.now
): RateLimitPort {
	return {
		async hit(key, o) {
			const ip = key.startsWith("public:") ? key.slice("public:".length) : key;
			return {
				allowed: hitPublicBucket(buckets, ip, o, now()),
				retryAfterSeconds: Math.max(1, Math.ceil(o.windowMs / 1000)),
			};
		},
	};
}

/** Source de la connexion PostgreSQL (forme de `PgService`). */
export interface PgSource {
	get(): { db: unknown } | null;
}

export interface BotShenronApiOptions {
	/** `PgService` (ou `null` : pas de PostgreSQL → groupe wiki désactivé). */
	pg?: PgSource | null;
	/** Port wiki explicite (tests) ; prioritaire sur `pg`. */
	wiki?: WikiReadPort | null;
	buckets: PublicRateBuckets;
	corsOrigins?: readonly string[];
	/** Adresse de socket de la requête (`server.requestIP(req)?.address`). */
	remoteAddress?: (request: Request) => string | null | undefined;
	now?: () => number;
	log?: (event: { event: string; path: string; status?: number; ms?: number }) => void;
}

function wikiPortFrom(o: BotShenronApiOptions): WikiReadPort | null {
	if (o.wiki !== undefined) return o.wiki;
	const handle = o.pg?.get() ?? null;
	if (!handle) return null;
	return createWikiReadRepository(
		handle.db as Parameters<typeof createWikiReadRepository>[0]
	) as WikiReadPort;
}

/** Application `@shenron/api` du bot. */
export function createBotShenronApi(o: BotShenronApiOptions): ShenronApi {
	const remote = o.remoteAddress ?? (() => null);
	return createShenronApi(
		{
			wiki: wikiPortFrom(o),
			rateLimit: bucketRateLimiter(o.buckets, o.now),
			publicCache: createPublicCache(),
			invalidation: noopInvalidation,
			cors: { allowedOrigins: o.corsOrigins ?? PUBLIC_CORS_ORIGINS },
			clientIp: (request) => clientIpFromHeaders(request.headers),
			isDirectLoopback: (request) => isDirectLoopbackHeaders(request.headers, remote(request)),
			...(o.log ? { log: o.log } : {}),
		},
		{ service: "shenron-bot" }
	);
}

/** Forme minimale du serveur Bun utilisée par le repli (adresse de socket). */
export interface RequestIpSource {
	requestIP(request: Request): { address: string } | null;
}

export interface PublicFallbackOptions {
	api: ShenronApi;
	buckets: PublicRateBuckets;
	graphql: (request: Request) => Response | Promise<Response>;
	corsOrigins?: readonly string[];
	now?: () => number;
}

/** En-têtes CORS publics historiques (`publicCorsHeaders` de `server.ts`). */
function publicCorsHeaders(
	request: Request,
	origins: readonly string[] = PUBLIC_CORS_ORIGINS
): Record<string, string> {
	const origin = request.headers.get("origin") ?? "";
	const allow = origins.includes(origin) ? origin : (origins[0] ?? "");
	return {
		"Access-Control-Allow-Origin": allow,
		"Access-Control-Allow-Methods": "GET, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type",
		"Access-Control-Max-Age": "600",
		Vary: "Origin",
	};
}

/** `/graphql` et `/graphql/*`. */
function isGraphqlPath(pathname: string): boolean {
	return pathname === "/graphql" || pathname.startsWith("/graphql/");
}

/**
 * Repli du `fetch` du bot pour les chemins servis par ce module :
 * - `/graphql` : limiteur public (S9 ; préflight OPTIONS non compté) puis handler inchangé ;
 * - chemins `@shenron/api` (B14) : délégués à Hono ;
 * - sinon `null` (l'appelant continue sa chaîne historique).
 */
export function createPublicFallback(o: PublicFallbackOptions) {
	const now = o.now ?? Date.now;
	return {
		graphql(request: Request, server?: RequestIpSource | null): Response | Promise<Response> {
			if (request.method !== "OPTIONS") {
				const remote = server?.requestIP(request)?.address ?? null;
				const direct = isDirectLoopbackHeaders(request.headers, remote);
				if (
					!direct &&
					!hitPublicBucket(
						o.buckets,
						clientIpFromHeaders(request.headers),
						PUBLIC_RATE_LIMIT,
						now()
					)
				) {
					return new Response(JSON.stringify({ error: "Rate limit (60/min)" }), {
						status: 429,
						headers: {
							...publicCorsHeaders(request, o.corsOrigins),
							"Content-Type": "application/json",
							"Retry-After": "60",
						},
					});
				}
			}
			return o.graphql(request);
		},
		handles(pathname: string): boolean {
			return o.api.handles(pathname);
		},
		fetch(request: Request): Promise<Response> {
			return o.api.fetch(request);
		},
	};
}

type PublicFallback = ReturnType<typeof createPublicFallback>;

/** Suivi des adresses de socket par requête, lu par `isDirectLoopback` du port Hono. */
export function createRemoteAddressRegistry() {
	const addresses = new WeakMap<Request, string | null>();
	return {
		remember(request: Request, server: RequestIpSource | null | undefined): void {
			addresses.set(request, server?.requestIP(request)?.address ?? null);
		},
		lookup(request: Request): string | null {
			return addresses.get(request) ?? null;
		},
	};
}
