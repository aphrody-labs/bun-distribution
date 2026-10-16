// Source: apps/shenron/site/src/lib/auth-rate-limit.ts at 8172f535ce (preserved Git history).
/**
 * Stockage du rate limit Better Auth : Redis quand il répond, mémoire sinon.
 *
 * Better Auth 1.7 attend un `consume(key, { window, max })` atomique
 * (`BetterAuthRateLimitStorage`). Côté Redis : `INCR` puis `EXPIRE` à la
 * création de la fenêtre, une seule clé par (IP, chemin), partagée entre les
 * instances du site.
 *
 * Pourquoi `customStorage` plutôt que `secondaryStorage` global : poser un
 * `secondaryStorage` sur la config fait aussi migrer les sessions vers Redis,
 * et une panne Redis déconnecterait alors tout le monde. Ici, seule la limite
 * de débit en dépend, et elle **dégrade vers un compteur en mémoire** (par
 * process) au premier échec Redis : la protection reste active, jamais d'erreur
 * 500 sur /api/auth à cause de Redis.
 *
 * Pas d'URL par défaut : sans `REDIS_URL`, le stockage est en mémoire.
 */
import type { BetterAuthOptions } from "better-auth";

/** `BetterAuthRateLimitStorage` (non réexporté par `better-auth`). */
export type BetterAuthRateLimitStorage = NonNullable<NonNullable<BetterAuthOptions["rateLimit"]>["customStorage"]>;

/** Sous-ensemble de `Bun.RedisClient` utilisé ici (injectable en test). */
export interface RateLimitRedis {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
  ttl(key: string): Promise<number>;
}

const KEY_PREFIX = "dbfr:ba-rate-limit:";

/** Compteur à fenêtre fixe en mémoire (repli, et seul stockage sans Redis). */
export function createMemoryRateLimitStorage(now: () => number = Date.now) {
  const windows = new Map<string, { count: number; resetAt: number }>();
  return {
    async consume(key: string, rule: { window: number; max: number }) {
      const t = now();
      let entry = windows.get(key);
      if (!entry || entry.resetAt <= t) {
        if (windows.size > 10_000) {
          for (const [k, v] of windows) if (v.resetAt <= t) windows.delete(k);
        }
        entry = { count: 0, resetAt: t + rule.window * 1000 };
        windows.set(key, entry);
      }
      if (entry.count >= rule.max) {
        return { allowed: false, retryAfter: Math.ceil((entry.resetAt - t) / 1000) };
      }
      entry.count += 1;
      return { allowed: true, retryAfter: null };
    },
  } satisfies BetterAuthRateLimitStorage;
}

/**
 * Stockage Redis avec repli mémoire. `getRedis` renvoie `null` quand Redis
 * n'est pas configuré ; toute erreur Redis bascule la requête sur la mémoire.
 */
export function createRateLimitStorage(
  getRedis: () => Promise<RateLimitRedis | null>,
  fallback = createMemoryRateLimitStorage(),
  onError: (error: unknown) => void = () => {},
): BetterAuthRateLimitStorage {
  return {
    async consume(key, rule) {
      let redis: RateLimitRedis | null = null;
      try {
        redis = await getRedis();
      } catch (error) {
        onError(error);
      }
      if (!redis) return fallback.consume(key, rule);
      try {
        const k = KEY_PREFIX + key;
        const count = await redis.incr(k);
        if (count === 1) await redis.expire(k, rule.window);
        if (count > rule.max) {
          const ttl = await redis.ttl(k);
          if (ttl < 0) await redis.expire(k, rule.window);
          return { allowed: false, retryAfter: ttl > 0 ? ttl : rule.window };
        }
        return { allowed: true, retryAfter: null };
      } catch (error) {
        onError(error);
        return fallback.consume(key, rule);
      }
    },
  };
}

let client: RateLimitRedis | null = null;
let loading: Promise<RateLimitRedis | null> | null = null;

/** Client Redis paresseux du rate limit (import dynamique de `bun`, cf. databooks-redis). */
function siteRateLimitRedis(): Promise<RateLimitRedis | null> {
  if (client) return Promise.resolve(client);
  if (loading) return loading;
  const url = process.env.REDIS_URL?.trim();
  if (!url) return Promise.resolve(null);
  loading = (async () => {
    try {
      const { RedisClient } = (await import("bun")) as unknown as {
        RedisClient: new (
          url: string,
          opts: Record<string, unknown>,
        ) => RateLimitRedis & { onclose: ((err: Error) => void) | null };
      };
      const c = new RedisClient(url, {
        autoReconnect: true,
        maxRetries: 20,
        enableOfflineQueue: false,
        connectionTimeout: 1000,
      });
      c.onclose = () => {
        if (client === c) client = null;
        loading = null;
      };
      client = c;
      return c;
    } catch {
      loading = null;
      return null;
    }
  })();
  return loading;
}

let warned = false;

/** Stockage du rate limit du site (Redis `REDIS_URL`, repli mémoire). */
export function siteRateLimitStorage(): BetterAuthRateLimitStorage {
  return createRateLimitStorage(siteRateLimitRedis, createMemoryRateLimitStorage(), error => {
    if (warned) return;
    warned = true;
    console.warn(
      "[better-auth] rate limit : Redis indisponible, repli en mémoire —",
      error instanceof Error ? error.message : String(error),
    );
  });
}
