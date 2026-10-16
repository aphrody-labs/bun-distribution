// SPDX-License-Identifier: Apache-2.0
/**
 * Native Bun SQLite cache for Aphrody UI runtime and tooling.
 *
 * Backed by Bun's built-in `bun:sqlite` with WAL mode:
 * - Ultra-low latency (<100µs)
 * - Zero external dependencies
 * - High-concurrency safe via WAL journal mode
 * - Used for caching theme palettes, icon SVGs, CSS tokens, and UI session state.
 */
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface CacheEntry<T = unknown> {
  key: string;
  namespace: string;
  value: T;
  updatedAt: number;
}

export interface CacheStats {
  totalEntries: number;
  namespaces: Record<string, number>;
  databasePath: string;
}

export class M3UiCache {
  private db: Database;
  private path: string;

  constructor(dbPath: string = ":memory:") {
    this.path = dbPath;
    if (dbPath !== ":memory:") {
      mkdirSync(dirname(dbPath), { recursive: true });
    }

    this.db = new Database(dbPath, { create: true });
    this.init();
  }

  private init(): void {
    this.db.run("PRAGMA journal_mode = WAL;");
    this.db.run("PRAGMA synchronous = NORMAL;");
    this.db.run("PRAGMA temp_store = MEMORY;");

    this.db.run(`
      CREATE TABLE IF NOT EXISTS ui_cache (
        key TEXT NOT NULL,
        namespace TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (namespace, key)
      );
    `);

    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_ui_cache_ns ON ui_cache (namespace);
    `);
  }

  /**
   * Retrieves a cached value, or returns null if not found.
   */
  get<T = unknown>(namespace: string, key: string): T | null {
    const row = this.db
      .query<{ value: string }, [string, string]>(
        "SELECT value FROM ui_cache WHERE namespace = ? AND key = ? LIMIT 1",
      )
      .get(namespace, key);

    if (!row) return null;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return row.value as unknown as T;
    }
  }

  /**
   * Stores a value in the cache under namespace and key.
   */
  set<T = unknown>(namespace: string, key: string, value: T): void {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new TypeError("M3UiCache: value must be JSON serializable");
    const now = Date.now();

    this.db
      .query(
        `INSERT INTO ui_cache (key, namespace, value, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (namespace, key) DO UPDATE SET
           value = excluded.value,
           updated_at = excluded.updated_at`,
      )
      .run(key, namespace, serialized, now);
  }

  /**
   * Removes a specific key from the cache.
   */
  delete(namespace: string, key: string): boolean {
    const result = this.db
      .query("DELETE FROM ui_cache WHERE namespace = ? AND key = ?")
      .run(namespace, key);
    return result.changes > 0;
  }

  /**
   * Clears an entire namespace, or all entries if no namespace specified.
   */
  clear(namespace?: string): number {
    if (namespace !== undefined) {
      const result = this.db.query("DELETE FROM ui_cache WHERE namespace = ?").run(namespace);
      return result.changes;
    }
    const result = this.db.query("DELETE FROM ui_cache").run();
    return result.changes;
  }

  /**
   * Returns cache metrics and entry counts.
   */
  stats(): CacheStats {
    const totalRow = this.db
      .query<{ total: number }, []>("SELECT COUNT(*) AS total FROM ui_cache")
      .get();
    const total = totalRow?.total ?? 0;

    const nsRows = this.db
      .query<{ namespace: string; count: number }, []>(
        "SELECT namespace, COUNT(*) AS count FROM ui_cache GROUP BY namespace",
      )
      .all();

    const namespaces: Record<string, number> = Object.create(null);
    for (const r of nsRows) {
      namespaces[r.namespace] = r.count;
    }

    return {
      totalEntries: total,
      namespaces,
      databasePath: this.path,
    };
  }

  /**
   * Closes the underlying SQLite database connection.
   */
  close(): void {
    this.db.close();
  }
}

/** Global shared instance for in-process UI caching */
let defaultInstance: M3UiCache | null = null;

export function getSharedUiCache(path?: string): M3UiCache {
  if (!defaultInstance) {
    const defaultPath =
      path ??
      process.env.APHRODY_UI_CACHE_PATH ??
      (process.env.HOME ? `${process.env.HOME}/.aphrody/cache/ui.sqlite` : ":memory:");
    defaultInstance = new M3UiCache(defaultPath);
  }
  return defaultInstance;
}
