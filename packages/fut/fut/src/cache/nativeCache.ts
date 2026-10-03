// SPDX-License-Identifier: Apache-2.0
import { closeSqlite, openSqlite, type Database } from "@aphrody/sql/sqlite";

/** FUT payload policy over the shared native Bun SQLite persistence owner. */
export class FutNativeCache {
  readonly #db: Database;
  readonly #now: () => number;
  #closed = false;

  constructor(path = ":memory:", options: { now?: () => number } = {}) {
    this.#now = options.now ?? Date.now;
    this.#db = openSqlite(path);
    this.#db.run(`CREATE TABLE IF NOT EXISTS fut_cache (
      key TEXT PRIMARY KEY, hash TEXT NOT NULL, payload BLOB NOT NULL,
      compressed INTEGER NOT NULL, expires_at INTEGER NOT NULL
    )`);
  }

  set(key: string, value: unknown, ttlMs = 3_600_000): void {
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 0)
      throw new RangeError("ttlMs must be a non-negative safe integer");
    const expiresAt = this.#now() + ttlMs;
    if (!Number.isSafeInteger(expiresAt))
      throw new RangeError("cache expiration exceeds safe integer range");
    const json = JSON.stringify(value);
    if (json === undefined) throw new TypeError("cache values must be JSON serializable");
    const bytes = new TextEncoder().encode(json);
    const compressed = bytes.byteLength >= 1024;
    this.#db
      .query(`INSERT INTO fut_cache (key, hash, payload, compressed, expires_at)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET
      hash=excluded.hash, payload=excluded.payload, compressed=excluded.compressed,
      expires_at=excluded.expires_at`)
      .run(
        key,
        Bun.hash.wyhash(key).toString(),
        compressed ? Bun.gzipSync(bytes) : bytes,
        compressed ? 1 : 0,
        expiresAt,
      );
  }

  get<T>(key: string): T | null {
    const row = this.#db
      .query<{ payload: Uint8Array; compressed: number; expires_at: number }, [string]>(
        "SELECT payload, compressed, expires_at FROM fut_cache WHERE key = ?",
      )
      .get(key);
    if (!row) return null;
    if (row.expires_at <= this.#now()) {
      this.delete(key);
      return null;
    }
    const bytes = row.compressed ? Bun.gunzipSync(new Uint8Array(row.payload)) : row.payload;
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  }

  delete(key: string): void {
    this.#db.query("DELETE FROM fut_cache WHERE key = ?").run(key);
  }
  clear(): void {
    this.#db.run("DELETE FROM fut_cache");
  }
  close(): void {
    if (this.#closed) return;
    closeSqlite(this.#db);
    this.#closed = true;
  }
  [Symbol.dispose](): void {
    this.close();
  }
}

/** Compatibility benchmark: measured Bun wyhash/SQLite operations, not Rust FFI availability. */
export function runNativeFfiBenchmark(iterations = 1000): {
  iterations: number;
  wyhashOpsPerSec: number;
  sqliteOpsPerSec: number;
} {
  if (!Number.isSafeInteger(iterations) || iterations < 1)
    throw new RangeError("iterations must be a positive safe integer");
  const cache = new FutNativeCache();
  try {
    const hashStart = performance.now();
    for (let i = 0; i < iterations; i++) Bun.hash.wyhash(`fut:${i}`);
    const hashTime = performance.now() - hashStart;
    const sqliteStart = performance.now();
    for (let i = 0; i < iterations; i++) {
      cache.set(`fut:${i}`, { id: i });
      if (cache.get<{ id: number }>(`fut:${i}`)?.id !== i)
        throw new Error("cache benchmark round-trip failed");
    }
    const sqliteTime = performance.now() - sqliteStart;
    return {
      iterations,
      wyhashOpsPerSec: (iterations * 1000) / Math.max(hashTime, Number.EPSILON),
      sqliteOpsPerSec: (iterations * 2 * 1000) / Math.max(sqliteTime, Number.EPSILON),
    };
  } finally {
    cache.close();
  }
}
