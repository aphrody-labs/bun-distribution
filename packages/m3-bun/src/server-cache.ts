// SPDX-License-Identifier: Apache-2.0
// Response and value cache of an app's API on Redis or Valkey through Bun's native client (`Bun.RedisClient`). The
// client connects on first use (`REDIS_URL`, `VALKEY_URL`, else `redis://localhost:6379`); entries expire with `EX`.
//
//   const cache = m3Cache({ ttl: 30 });
//   export default defineM3Api({ "/api/feed": cache.route(() => Response.json(expensiveFeed())) });
import type { M3Handler } from "./api.ts";

export interface M3CacheOptions {
  /** Server URL (default `REDIS_URL`, `VALKEY_URL`, else Bun's default `redis://localhost:6379`). */
  url?: string;
  /** An existing client (its owner closes it). */
  client?: Bun.RedisClient;
  /** Key prefix (default `m3:`). */
  prefix?: string;
  /** Default lifetime in seconds (default 60). */
  ttl?: number;
}

export interface M3Cache {
  readonly client: Bun.RedisClient;
  get<T = unknown>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown, ttl?: number): Promise<void>;
  delete(key: string): Promise<void>;
  /** The cached value of `key`, else `compute()` stored for `ttl` seconds. */
  wrap<T>(key: string, compute: () => T | Promise<T>, ttl?: number): Promise<T>;
  /** A GET handler whose 200 responses are cached by URL (`X-Cache: HIT` or `MISS`); other methods pass through. */
  route(
    handler: M3Handler,
    options?: { ttl?: number; key?: (request: Request) => string },
  ): M3Handler;
  close(): void;
}

interface Stored {
  status: number;
  type: string | null;
  body: string;
}

export function m3Cache(options: M3CacheOptions = {}): M3Cache {
  const prefix = options.prefix ?? "m3:";
  const ttl = options.ttl ?? 60;
  let owned: Bun.RedisClient | undefined;
  const client = (): Bun.RedisClient =>
    options.client ??
    (owned ??= new Bun.RedisClient(
      options.url ?? Bun.env.REDIS_URL ?? Bun.env.VALKEY_URL,
    ));
  const seconds = (value: number | undefined): number =>
    Math.max(1, Math.round(value ?? ttl));

  const cache: M3Cache = {
    get client() {
      return client();
    },
    async get<T>(key: string) {
      const raw = await client().get(prefix + key);
      return raw === null ? undefined : (JSON.parse(raw) as T);
    },
    async set(key, value, lifetime) {
      await client().set(
        prefix + key,
        JSON.stringify(value),
        "EX",
        seconds(lifetime),
      );
    },
    async delete(key) {
      await client().del(prefix + key);
    },
    async wrap<T>(
      key: string,
      compute: () => T | Promise<T>,
      lifetime?: number,
    ) {
      const hit = await cache.get<T>(key);
      if (hit !== undefined) return hit;
      const value = await compute();
      await cache.set(key, value, lifetime);
      return value;
    },
    route(handler, routeOptions = {}) {
      return async (request) => {
        if (request.method !== "GET") return handler(request);
        const key = `response:${routeOptions.key?.(request) ?? new URL(request.url).pathname + new URL(request.url).search}`;
        const hit = await cache.get<Stored>(key);
        if (hit)
          return new Response(hit.body, {
            status: hit.status,
            headers: {
              ...(hit.type ? { "Content-Type": hit.type } : {}),
              "X-Cache": "HIT",
            },
          });
        const response = await handler(request);
        if (response.status !== 200 || response.headers.has("Set-Cookie"))
          return response;
        const body = await response.text();
        await cache.set(
          key,
          {
            status: 200,
            type: response.headers.get("content-type"),
            body,
          } satisfies Stored,
          routeOptions.ttl,
        );
        const headers = new Headers(response.headers);
        headers.set("X-Cache", "MISS");
        return new Response(body, { status: 200, headers });
      };
    },
    close() {
      owned?.close();
      owned = undefined;
    },
  };
  return cache;
}
