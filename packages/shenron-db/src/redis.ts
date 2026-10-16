// Source: packages/shenron/db/src/redis.ts at 8172f535ce (preserved Git history).
// SPDX-License-Identifier: Apache-2.0
/**
 * Resilient Redis client (B8). Runtime class: `bun`.
 *
 * Bun's `RedisClient` gives up after `maxRetries`: from then on every command
 * throws `ERR_REDIS_CONNECTION_CLOSED` forever (incident 2026-08-21, pattern of
 * apps/shenron/bot/src/workers/indexer.ts). Here the client is disposable: once it is
 * dead it is dropped and a new one is built after a backoff. Commands issued
 * while no live client may be built (the dead window) reject with an explicit
 * error — never a silent no-op. Clients are built by `@aphrody/sql/redis`.
 */
import { createRedisClient } from "@aphrody/sql/redis";

export interface RedisLike {
  send(command: string, args: string[]): Promise<unknown>;
  close(): void;
  readonly connected: boolean;
}

export interface ResilientRedis extends RedisLike {
  readonly name: string;
}

export type ResilientRedisEvent = { kind: "connect" | "error" | "recreate"; attempt: number };

export interface ResilientRedisOptions {
  url: string;
  name: string;
  createClient?: (url: string) => RedisLike;
  /** Delay before each successive recreation; the last value repeats. */
  backoffMs?: readonly number[];
  onEvent?: (event: ResilientRedisEvent) => void;
  /** Clock (tests). */
  now?: () => number;
}

export const DEFAULT_REDIS_BACKOFF_MS: readonly number[] = [250, 1000, 5000, 15000];

export class RedisUnavailableError extends Error {
  readonly code = "REDIS_UNAVAILABLE" as const;
  constructor(
    readonly redisName: string,
    readonly retryInMs: number,
    cause?: unknown,
  ) {
    super(
      `Redis "${redisName}" indisponible : client mort, nouvelle tentative dans ${retryInMs} ms.`,
      cause === undefined ? undefined : { cause },
    );
    this.name = "RedisUnavailableError";
  }
}

async function defaultFactory(url: string): Promise<RedisLike> {
  return createRedisClient(url, {
    autoReconnect: true,
    maxRetries: 20,
    enableOfflineQueue: true,
  }) as unknown as RedisLike;
}

export function createResilientRedis(options: ResilientRedisOptions): ResilientRedis {
  const backoff = options.backoffMs?.length ? options.backoffMs : DEFAULT_REDIS_BACKOFF_MS;
  const now = options.now ?? Date.now;
  const emit = (event: ResilientRedisEvent) => {
    try {
      options.onEvent?.(event);
    } catch {
      // observers never break the data path
    }
  };

  let client: RedisLike | null = null;
  let pending: Promise<RedisLike> | null = null;
  let created = 0; // clients built so far
  let deaths = 0; // consecutive deaths since the last healthy command
  let deadUntil = 0;
  let lastCause: unknown;
  let closed = false;

  const build = (): Promise<RedisLike> => {
    if (client) return Promise.resolve(client);
    if (pending) return pending;
    const attempt = created;
    pending = (async () => {
      const c = options.createClient ? options.createClient(options.url) : await defaultFactory(options.url);
      created++;
      client = c;
      emit({ kind: attempt === 0 ? "connect" : "recreate", attempt });
      return c;
    })().finally(() => {
      pending = null;
    });
    return pending;
  };

  const markDead = (c: RedisLike, cause: unknown) => {
    if (client !== c) return;
    client = null;
    lastCause = cause;
    const delay = backoff[Math.min(deaths, backoff.length - 1)] ?? 0;
    deaths++;
    deadUntil = now() + delay;
    try {
      c.close();
    } catch {
      // already closed
    }
  };

  return {
    name: options.name,
    get connected() {
      return client?.connected ?? false;
    },
    async send(command, args) {
      if (closed) throw new Error(`Redis "${options.name}" fermé.`);
      if (!client && now() < deadUntil) {
        throw new RedisUnavailableError(options.name, deadUntil - now(), lastCause);
      }
      const c = await build();
      try {
        const result = await c.send(command, args);
        deaths = 0;
        return result;
      } catch (error) {
        emit({ kind: "error", attempt: created - 1 });
        if (!c.connected) markDead(c, error);
        throw error;
      }
    },
    close() {
      closed = true;
      const c = client;
      client = null;
      c?.close();
    },
  };
}
