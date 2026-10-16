// Source: packages/shenron/auth/src/index.ts at 8172f535ce (preserved Git history).
/**
 * Framework-agnostic Better Auth building blocks shared by the Next site, the
 * Bun bot and the standalone API. Each app keeps its own `betterAuth()` call
 * (adapter, hooks, provider scopes differ); only invariants live here.
 */

import { botTrustedOrigins, siteAllowedHosts } from "./origins";

export {
  VERCEL_PRODUCTION_ALIAS,
  botTrustedOrigins,
  siteAllowedHosts,
  siteTrustedOrigins,
  type OriginPolicyInput,
} from "./origins";

/**
 * Public origins allowed to call `/api/auth/*` (production values, S2).
 * @deprecated Use `botTrustedOrigins({ production })` or
 * `siteTrustedOrigins({ production })` from `@shenron/auth/origins`.
 */
export const SHENRON_TRUSTED_ORIGINS: readonly string[] = Object.freeze(botTrustedOrigins({ production: true }));

/**
 * Hosts accepted by the dynamic `baseURL` of the site (production values, S2:
 * no generic `*.vercel.app`, no `localhost`).
 * @deprecated Use `siteAllowedHosts({ production })` from `@shenron/auth/origins`.
 */
export const SHENRON_ALLOWED_HOSTS: readonly string[] = Object.freeze(siteAllowedHosts({ production: true }));

export const SHENRON_CANONICAL_URL = "https://dragonballfr.com";
export const AUTH_BASE_PATH = "/api/auth";

/**
 * Trims and strips trailing slashes: an env value polluted by `echo` (final
 * `\n`) produced malformed Discord redirect URIs. Never concatenate a raw env URL.
 */
export function normalizeBaseUrl(raw: string | undefined, fallback = SHENRON_CANONICAL_URL): string {
  return (raw?.trim() || fallback).replace(/\/+$/, "");
}

/**
 * Resolves the Better Auth secret. Order: BETTER_AUTH_SECRET then SESSION_SECRET.
 * Never API_ADMIN_TOKEN nor a hard-coded value.
 *
 * - production: fail closed when no secret (>= 32 chars) is provided;
 * - otherwise: explicit BETTER_AUTH_DEV_SECRET, else an ephemeral random one.
 */
export function resolveBetterAuthSecret(
  source: Record<string, string | undefined>,
  randomSecret: () => string = () => crypto.randomUUID() + crypto.randomUUID(),
): { secret: string; origin: "env" | "dev" | "ephemeral" } {
  const isProduction = source.NODE_ENV === "production";
  for (const key of ["BETTER_AUTH_SECRET", "SESSION_SECRET"] as const) {
    const value = source[key]?.trim();
    if (!value) continue;
    if (value.length < 32) {
      throw new Error(`${key} must be at least 32 characters long.`);
    }
    return { secret: value, origin: "env" };
  }
  if (isProduction) {
    throw new Error("Better Auth: BETTER_AUTH_SECRET (or SESSION_SECRET) is required in production.");
  }
  const devSecret = source.BETTER_AUTH_DEV_SECRET?.trim();
  if (devSecret) return { secret: devSecret, origin: "dev" };
  return { secret: randomSecret(), origin: "ephemeral" };
}

/**
 * `advanced` options shared by every app. `trustProxy` does not exist in
 * better-auth 1.7; the typed equivalent is `ipAddress`: nginx runs on the same
 * host and sets X-Real-IP, only loopback is a trusted proxy.
 */
export function sharedAdvancedOptions(nodeEnv: string | undefined, cookiePrefix?: string) {
  return {
    useSecureCookies: nodeEnv === "production",
    crossSubDomainCookies: { enabled: false },
    ...(cookiePrefix ? { cookiePrefix } : {}),
    ipAddress: {
      ipAddressHeaders: ["x-real-ip", "x-forwarded-for"],
      trustedProxies: ["127.0.0.1", "::1"],
    },
  };
}

/** Maps a Discord profile without e-mail (phone-only accounts) to a stable placeholder. */
export function mapDiscordProfileEmail(profile: { id: string; email?: string | null }) {
  return { email: profile.email ?? `${profile.id}@discord.placeholder.local` };
}

/** Minimal structural type of a Better Auth instance, to stay version-agnostic. */
export interface AuthLike {
  handler: (request: Request) => Promise<Response>;
  api: { getSession: (input: { headers: Headers }) => Promise<unknown> };
}

/**
 * Routes a `Request` to Better Auth when it targets `basePath`, else `null`.
 * Works with Bun.serve, Hono and Next route handlers alike.
 */
export async function handleAuthRequest(
  auth: AuthLike,
  request: Request,
  basePath = AUTH_BASE_PATH,
): Promise<Response | null> {
  const { pathname } = new URL(request.url);
  if (pathname !== basePath && !pathname.startsWith(`${basePath}/`)) return null;
  return auth.handler(request);
}

/** Core fields of a Better Auth session payload (user + session rows). */
export interface BaseSession {
  user: {
    id: string;
    name: string | null;
    email: string | null;
    emailVerified?: boolean;
    image?: string | null;
  };
  session: { id: string; userId: string; token: string; expiresAt: Date };
}

/** Session lookup that never throws (expired cookie, DB hiccup → `null`). */
export async function getSessionSafe<T = BaseSession>(auth: AuthLike, headers: Headers): Promise<T | null> {
  try {
    return ((await auth.api.getSession({ headers })) as T | null) ?? null;
  } catch {
    return null;
  }
}
