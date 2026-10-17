// SPDX-License-Identifier: Apache-2.0
/**
 * `bun:sqlite` open policy (ADR sql-convergence D5/D6/D10), identical to the
 * Rust `aphrody-sql` crate:
 *
 * - `journal_mode=WAL` (skipped for read-only and in-memory databases);
 * - `busy_timeout=5000`, `foreign_keys=ON`, `temp_store=MEMORY`;
 * - `PRAGMA optimize=0x10002` at open (skipped for read-only connections),
 *   and `PRAGMA optimize` again in {@link closeSqlite};
 * - optional `vec0` through the npm `sqlite-vec` package (`load(db)`).
 *
 * macOS: the system SQLite cannot load extensions; call
 * `Database.setCustomSQLite()` before opening when `vec` is needed there.
 */
import { Database } from "bun:sqlite";
import * as sqliteVec from "sqlite-vec";

export { Database } from "bun:sqlite";

export const SQLITE_BUSY_TIMEOUT_MS = 5000;

export interface OpenSqliteOptions {
  /** Open read-only (no WAL switch, no optimize at open). Default false. */
  readonly?: boolean;
  /** Create the file when missing (ignored when read-only). Default true. */
  create?: boolean;
  /** Load the sqlite-vec extension (`vec0`, `vec_version()`). Default false. */
  vec?: boolean;
  /** `busy_timeout` in milliseconds. Default 5000. */
  busyTimeoutMs?: number;
  /** bun:sqlite strict binding (`$name` without prefix, errors on missing params). Default true. */
  strict?: boolean;
  /** Return INTEGER values as `bigint`. Default false. */
  safeIntegers?: boolean;
}

function isMemoryPath(path: string): boolean {
  return path === "" || path === ":memory:" || path.includes("mode=memory");
}

/** Opens a SQLite database with the Aphrody pragmas applied. */
export function openSqlite(path: string, options: OpenSqliteOptions = {}): Database {
  const readonly = options.readonly ?? false;
  const db = readonly
    ? new Database(path, {
        readonly: true,
        strict: options.strict ?? true,
        safeIntegers: options.safeIntegers ?? false,
      })
    : new Database(path, {
        readwrite: true,
        create: options.create ?? true,
        strict: options.strict ?? true,
        safeIntegers: options.safeIntegers ?? false,
      });
  try {
    const busy = options.busyTimeoutMs ?? SQLITE_BUSY_TIMEOUT_MS;
    if (!Number.isInteger(busy) || busy < 0) {
      throw new RangeError(`busyTimeoutMs must be a non-negative integer (got ${busy}).`);
    }
    db.run(`PRAGMA busy_timeout = ${busy}`);
    if (!readonly && !isMemoryPath(path)) db.run("PRAGMA journal_mode = WAL");
    db.run("PRAGMA foreign_keys = ON");
    db.run("PRAGMA temp_store = MEMORY");
    if (options.vec) loadSqliteVec(db);
    if (!readonly) db.run("PRAGMA optimize = 0x10002");
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

/** Loads sqlite-vec into an open connection (npm `sqlite-vec` `load(db)`). */
export function loadSqliteVec(db: Database): void {
  sqliteVec.load(db);
}

/** Version string of the loaded sqlite-vec extension, or `null` when it is not loaded. */
export function sqliteVecVersion(db: Database): string | null {
  try {
    const row = db.query<{ v: string }, []>("SELECT vec_version() AS v").get();
    return row?.v ?? null;
  } catch {
    return null;
  }
}

/**
 * Consistent online copy of `db` into a new file (`VACUUM INTO`). The target
 * must not exist or must be empty; SQLite refuses to overwrite a database.
 */
export function vacuumInto(db: Database, path: string): void {
  db.run("VACUUM INTO ?", [path]);
}

/** Runs `PRAGMA optimize` (writable connections) and closes the database. */
export function closeSqlite(db: Database): void {
  try {
    db.run("PRAGMA optimize");
  } catch {
    // read-only or already closed: optimize is best effort
  }
  db.close();
}
