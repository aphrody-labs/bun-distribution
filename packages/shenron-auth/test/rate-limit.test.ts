// Source: apps/shenron/site/tests/auth-rate-limit.test.ts at 8172f535ce (preserved Git history).
/**
 * Rate limit Better Auth du site : compteurs Redis, repli mémoire si Redis
 * n'est pas configuré ou tombe (aucune erreur remontée à /api/auth).
 */
import { describe, expect, test } from "bun:test";
import { createMemoryRateLimitStorage, createRateLimitStorage, type RateLimitRedis } from "../src/rate-limit";

const RULE = { window: 60, max: 2 };

function fakeRedis(): RateLimitRedis & { store: Map<string, number> } {
  const store = new Map<string, number>();
  const ttls = new Map<string, number>();
  return {
    store,
    async incr(key) {
      const n = (store.get(key) ?? 0) + 1;
      store.set(key, n);
      return n;
    },
    async expire(key, seconds) {
      ttls.set(key, seconds);
      return 1;
    },
    async ttl(key) {
      return ttls.get(key) ?? -1;
    },
  };
}

describe("stockage mémoire", () => {
  test("fenêtre fixe : max requêtes puis refus avec retryAfter, réinitialisée après la fenêtre", async () => {
    let now = 0;
    const storage = createMemoryRateLimitStorage(() => now);
    expect((await storage.consume("k", RULE)).allowed).toBe(true);
    expect((await storage.consume("k", RULE)).allowed).toBe(true);
    expect(await storage.consume("k", RULE)).toEqual({ allowed: false, retryAfter: 60 });
    now = 60_000;
    expect((await storage.consume("k", RULE)).allowed).toBe(true);
  });
});

describe("stockage Redis", () => {
  test("INCR + EXPIRE, refus au-delà du max", async () => {
    const redis = fakeRedis();
    const storage = createRateLimitStorage(async () => redis);
    expect((await storage.consume("ip|/sign-in", RULE)).allowed).toBe(true);
    expect((await storage.consume("ip|/sign-in", RULE)).allowed).toBe(true);
    expect(await storage.consume("ip|/sign-in", RULE)).toEqual({ allowed: false, retryAfter: 60 });
    expect(redis.store.get("dbfr:ba-rate-limit:ip|/sign-in")).toBe(3);
  });

  test("Redis non configuré : repli mémoire, la limite reste appliquée", async () => {
    const storage = createRateLimitStorage(async () => null);
    await storage.consume("k", RULE);
    await storage.consume("k", RULE);
    expect((await storage.consume("k", RULE)).allowed).toBe(false);
  });

  test("Redis en panne : repli mémoire sans exception, erreur signalée", async () => {
    const errors: unknown[] = [];
    const broken: RateLimitRedis = {
      incr: async () => {
        throw new Error("ECONNREFUSED");
      },
      expire: async () => 0,
      ttl: async () => -2,
    };
    const storage = createRateLimitStorage(
      async () => broken,
      createMemoryRateLimitStorage(),
      e => errors.push(e),
    );
    expect((await storage.consume("k", RULE)).allowed).toBe(true);
    expect((await storage.consume("k", RULE)).allowed).toBe(true);
    expect((await storage.consume("k", RULE)).allowed).toBe(false);
    expect(errors).toHaveLength(3);
  });

  test("échec d'ouverture du client : repli mémoire", async () => {
    const storage = createRateLimitStorage(async () => {
      throw new Error("no bun");
    });
    expect((await storage.consume("k", RULE)).allowed).toBe(true);
  });
});
