// SPDX-License-Identifier: Apache-2.0
import { RedisClient } from "bun";

export interface RedisOptions {
  hostname?: string | undefined;
  port?: number | undefined;
  timeoutMs?: number | undefined;
  /** Native Redis/Valkey URL, including TLS, authentication and database when required. */
  url?: string | undefined;
  /** Explicitly disable network access; stores retain pending mutations in memory. */
  offline?: boolean | undefined;
}

export class RedisUnavailableError extends Error {
  constructor() {
    super("Redis is unavailable; pending store changes remain in memory");
    this.name = "RedisUnavailableError";
  }
}

/** Compatibility facade over Bun's native Redis owner, with bounded operations. */
export class NativeRedisClient {
  readonly hostname: string;
  readonly port: number;
  readonly #url: string;
  readonly #timeoutMs: number;
  readonly #offline: boolean;
  #native: RedisClient | null = null;
  #connecting: Promise<this> | null = null;
  #closed = false;

  constructor(options: RedisOptions = {}) {
    this.hostname = options.hostname ?? "127.0.0.1";
    this.port = options.port ?? 6379;
    this.#timeoutMs = options.timeoutMs ?? 1_000;
    this.#offline = options.offline ?? false;
    if (!Number.isSafeInteger(this.port) || this.port < 1 || this.port > 65_535) {
      throw new RangeError("Redis port must be between 1 and 65535");
    }
    if (!Number.isSafeInteger(this.#timeoutMs) || this.#timeoutMs < 1) {
      throw new RangeError("Redis timeout must be a positive integer");
    }
    const host = this.hostname.includes(":") ? `[${this.hostname}]` : this.hostname;
    this.#url =
      options.url ??
      (options.hostname === undefined && options.port === undefined
        ? (process.env.VALKEY_URL ?? process.env.REDIS_URL ?? `redis://${host}:${this.port}`)
        : `redis://${host}:${this.port}`);
  }

  get isConnected(): boolean {
    return this.#native?.connected ?? false;
  }

  async #bounded<T>(operation: Promise<T>, native: RedisClient): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            native.close();
            reject(new RedisUnavailableError());
          }, this.#timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async connect(): Promise<this> {
    if (this.#offline) throw new RedisUnavailableError();
    if (this.isConnected) return this;
    if (this.#connecting) return this.#connecting;
    this.#closed = false;
    const native = new RedisClient(this.#url, {
      connectionTimeout: this.#timeoutMs,
      autoReconnect: false,
      maxRetries: 0,
      enableOfflineQueue: false,
    });
    this.#native = native;
    this.#connecting = (async () => {
      try {
        await this.#bounded(native.connect(), native);
        if (this.#closed || this.#native !== native) throw new RedisUnavailableError();
        return this;
      } catch {
        native.close();
        throw new RedisUnavailableError();
      } finally {
        this.#connecting = null;
      }
    })();
    return this.#connecting;
  }

  async sendCommand<T = any>(command: string, ...args: Array<string | number>): Promise<T> {
    if (this.#closed || this.#offline) throw new RedisUnavailableError();
    await this.connect();
    const native = this.#native;
    if (!native) throw new RedisUnavailableError();
    try {
      return await this.#bounded(native.send(command, args.map(String)), native);
    } catch (error) {
      // Server/type/script errors must remain visible rather than become offline writes.
      if (error instanceof Error && "code" in error && error.code === "ERR_REDIS_SERVER_ERROR") {
        throw error;
      }
      throw new RedisUnavailableError();
    }
  }

  async ping(): Promise<string> {
    return this.sendCommand("PING");
  }
  async set(key: string, value: string, exSeconds?: number): Promise<string> {
    if (exSeconds !== undefined && exSeconds > 0)
      return this.sendCommand("SET", key, value, "EX", exSeconds);
    return this.sendCommand("SET", key, value);
  }
  async get(key: string): Promise<string | null> {
    return this.sendCommand("GET", key);
  }
  async del(...keys: string[]): Promise<number> {
    return keys.length ? this.sendCommand("DEL", ...keys) : 0;
  }
  async hset(
    key: string,
    fieldOrRecord: string | Record<string, string>,
    value?: string,
  ): Promise<number> {
    const pairs =
      typeof fieldOrRecord === "string"
        ? [fieldOrRecord, value ?? ""]
        : Object.entries(fieldOrRecord).flat();
    return pairs.length ? this.sendCommand("HSET", key, ...pairs) : 0;
  }
  async hget(key: string, field: string): Promise<string | null> {
    return this.sendCommand("HGET", key, field);
  }
  async hgetall(key: string): Promise<Record<string, string>> {
    const raw = await this.sendCommand<string[] | Record<string, string>>("HGETALL", key);
    if (!Array.isArray(raw)) return raw;
    const entries: Array<[string, string]> = [];
    for (let index = 0; index < raw.length; index += 2) {
      const field = raw[index];
      const value = raw[index + 1];
      if (field !== undefined && value !== undefined) entries.push([field, value]);
    }
    return Object.fromEntries(entries);
  }
  async sadd(key: string, ...members: string[]): Promise<number> {
    return members.length ? this.sendCommand("SADD", key, ...members) : 0;
  }
  async smembers(key: string): Promise<string[]> {
    return this.sendCommand("SMEMBERS", key);
  }
  async srem(key: string, ...members: string[]): Promise<number> {
    return members.length ? this.sendCommand("SREM", key, ...members) : 0;
  }
  async scard(key: string): Promise<number> {
    return this.sendCommand("SCARD", key);
  }
  async publish(channel: string, message: string): Promise<number> {
    return this.sendCommand("PUBLISH", channel, message);
  }
  async keys(pattern = "*"): Promise<string[]> {
    return this.sendCommand("KEYS", pattern);
  }
  async flushdb(): Promise<string> {
    return this.sendCommand("FLUSHDB");
  }

  /** Explicit close prevents implicit reconnect. Call connect() to reopen. */
  close(): void {
    this.#closed = true;
    this.#native?.close();
    this.#native = null;
  }
}
