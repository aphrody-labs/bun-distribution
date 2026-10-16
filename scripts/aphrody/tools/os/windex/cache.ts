// SPDX-License-Identifier: Apache-2.0
// Redis cache in front of the PostgreSQL index (Bun's built-in RedisClient). Keys are versioned under
// `windex:v1:` (KEY_PREFIX): bumping KEY_VERSION invalidates everything at once. The watcher deletes the keys of
// changed paths and of their parent directory, increments the query generation and publishes the change.
import { RedisClient, type SQL } from "bun";
import { KEY_PREFIX, pathKey, readSecret, type Config } from "./config.ts";
import { getNode } from "./pg.ts";

export const NODE_TTL_S = 24 * 3600;
export const QUERY_TTL_S = 600;
export const EVENTS_CHANNEL = `${KEY_PREFIX}:events`;

export const nodeKey = (path: string) => `${KEY_PREFIX}:path:${pathKey(path)}`;
export const genKey = `${KEY_PREFIX}:gen`;
export const statsKey = `${KEY_PREFIX}:stats`;
export const queryKey = (gen: number | string, text: string) =>
  `${KEY_PREFIX}:q:${gen}:${new Bun.CryptoHasher("sha256").update(text).digest("hex").slice(0, 32)}`;

export function redisUrl(cfg: Config): string {
  // The password is only part of the in-memory URL; it is never printed.
  return `redis://default:${encodeURIComponent(readSecret(cfg.redis.passwordFile))}@${cfg.redis.host}:${cfg.redis.port}`;
}

export async function connectRedis(cfg: Config): Promise<RedisClient> {
  const client = new RedisClient(redisUrl(cfg), {
    connectionTimeout: 5000,
    autoReconnect: true,
    enableOfflineQueue: false,
  });
  await client.connect();
  return client;
}

export type Cached<T> = { hit: boolean; value: T | undefined };

/** Read-through lookup of one path: Redis first, PostgreSQL on a miss (then cached for NODE_TTL_S). */
export async function cachedNode(
  redis: RedisClient,
  sql: SQL,
  path: string,
): Promise<Cached<Record<string, unknown>>> {
  const key = nodeKey(path);
  const raw = await redis.get(key);
  if (raw !== null) {
    await redis.hincrby(statsKey, "hits", 1);
    return { hit: true, value: JSON.parse(raw) };
  }
  await redis.hincrby(statsKey, "misses", 1);
  const value = await getNode(sql, path);
  if (value) await redis.set(key, JSON.stringify(value), "EX", NODE_TTL_S);
  return { hit: false, value };
}

/** Read-through cache of a query result, keyed by the current generation (any change invalidates all queries). */
export async function cachedQuery<T>(
  redis: RedisClient,
  text: string,
  compute: () => Promise<T>,
): Promise<Cached<T>> {
  const gen = (await redis.get(genKey)) ?? "0";
  const key = queryKey(gen, text);
  const raw = await redis.get(key);
  if (raw !== null) {
    await redis.hincrby(statsKey, "query_hits", 1);
    return { hit: true, value: JSON.parse(raw) as T };
  }
  await redis.hincrby(statsKey, "query_misses", 1);
  const value = await compute();
  await redis.set(key, JSON.stringify(value), "EX", QUERY_TTL_S);
  return { hit: false, value };
}

export type ChangeEvent = {
  v: number;
  op: "upsert" | "delete" | "rename";
  path: string;
  from?: string;
  dir: boolean;
  usn: string | null;
  at: number;
};

function parentOf(path: string): string | null {
  const cut = path.lastIndexOf("\\");
  return cut > 2 ? path.slice(0, cut) : cut === 2 ? path.slice(0, 3) : null;
}

/** Invalidates the keys touched by a batch of changes, bumps the query generation and publishes the events. */
export async function invalidate(
  redis: RedisClient,
  events: ChangeEvent[],
): Promise<void> {
  if (!events.length) return;
  const keys = new Set<string>();
  for (const e of events) {
    for (const p of [e.path, e.from]) {
      if (!p) continue;
      keys.add(nodeKey(p));
      const parent = parentOf(p);
      if (parent) keys.add(nodeKey(parent));
    }
  }
  const all = [...keys];
  for (let i = 0; i < all.length; i += 500)
    await redis.unlink(...all.slice(i, i + 500));
  await redis.incr(genKey);
  for (const e of events)
    await redis.publish(EVENTS_CHANNEL, JSON.stringify(e));
}

/** Drops every cached path below a root (after a rescan or a directory rename). */
export async function invalidatePrefix(
  redis: RedisClient,
  root: string,
): Promise<number> {
  let cursor = "0";
  let n = 0;
  const pattern = `${nodeKey(root).replace(/[*?[\]\\]/g, (c) => `\\${c}`)}*`;
  do {
    const [next, keys] = (await redis.send("SCAN", [
      cursor,
      "MATCH",
      pattern,
      "COUNT",
      "1000",
    ])) as [string, string[]];
    cursor = next;
    if (keys.length) n += await redis.unlink(...keys);
  } while (cursor !== "0");
  await redis.incr(genKey);
  return n;
}
