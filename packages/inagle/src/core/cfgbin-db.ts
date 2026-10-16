/**
 * @file cfgbin-db.ts
 * @description Accès cfg.bin unifié : PostgreSQL JSONB en durable, SQLite
 * produit par `iecode cfgbin-db build` uniquement pour extraction/dev.
 *
 * Remplace les centaines de milliers de loose `.cfg.bin.json` du
 * filesystem par une seule DB ~2.3 GB lue en O(1) via index PK.
 *
 * Schema attendu :
 *   CREATE TABLE cfgbin (
 *     path   TEXT PRIMARY KEY,    -- ex: "data/common/gamedata/character/chara_param_1.03.66.00.cfg.bin"
 *     cpk    TEXT NOT NULL,
 *     size   INTEGER NOT NULL,
 *     parsed INTEGER NOT NULL,    -- 1=ok, 0=erreur, 2=timeout
 *     format TEXT,                -- "T2B" | "RDBN" | NULL
 *     error  TEXT,
 *     json   TEXT
 *   );
 *   CREATE INDEX idx_cfgbin_cpk ON cfgbin(cpk);
 *
 * Mapping path :
 *   inagle:  loadConfig("character", "chara_param_X.cfg.bin.json")
 *   DB path: "data/common/gamedata/character/chara_param_X.cfg.bin"
 *
 * Selected through IEVR_CFGBIN_DB; the default is the IECODE-local var/cfgbin.sqlite.
 *
 * PostgreSQL requires INAGLE_DATA_SOURCE=postgres or IEVR_CFGBIN_POSTGRES=1.
 * Unrelated database credentials never select a game-data source.
 */

import { join } from "node:path";
import { statSync } from "node:fs";
import type { Database } from "bun:sqlite";
import { createRequire } from "node:module";

import type { Database as SqlDatabase } from "@rosegriffon/db/schema";
import {
  configuredDataSource,
  localMirrorPath,
  selectDataSource,
} from "./data-source.js";
import { decodeProjectionJson } from "../sql/projection-json.js";

const require = createRequire(import.meta.url);
const DB = typeof Bun !== "undefined" ? (require("bun:sqlite").Database as typeof Database) : null;

const DEFAULT_DB_PATH = join(process.env.IECODE_ROOT || process.cwd(), "var", "cfgbin.sqlite");

let _db: Database | null = null;
let _enabled: boolean | null = null;
let _selectedDbPath: string | undefined;
let _cfgbinTable: "cfgbin" | "inagle_cfgbin" = "cfgbin";
let _jsonColumn: "json" | "data" = "json";
let _findStmt: ReturnType<Database["prepare"]> | null = null;
let _loadStmt: ReturnType<Database["prepare"]> | null = null;
let _listStmt: ReturnType<Database["prepare"]> | null = null;

/**
 * Returns the configured DB path (env override or default).
 */
export function cfgbinDbPath(): string {
  if (process.env.IEVR_CFGBIN_DB) return process.env.IEVR_CFGBIN_DB;
  const source = configuredDataSource();
  if (source !== "vfs" && source !== "postgres") {
    const mirror = localMirrorPath();
    if (mirror) return mirror;
  }
  return DEFAULT_DB_PATH;
}

export function cfgbinDataSource() {
  const available = cfgbinDbAvailable();
  const selected = selectDataSource({
    explicit: configuredDataSource(),
    sqliteAvailable: available,
    postgresDisabled: process.env.IEVR_CFGBIN_POSTGRES === "0",
  });
  // A service mirror and a cfg.bin extraction cache have different schemas.
  return selected === "sqlite" && !available ? "vfs" : selected;
}

/** Explicit profile selection owns PostgreSQL activation; foreign URLs never select it. */
export function cfgbinPostgresEnabled(): boolean {
  if (process.env.IEVR_CFGBIN_POSTGRES === "0") return false;
  const selected = configuredDataSource();
  if (selected === "vfs" || selected === "sqlite") return false;
  return process.env.IEVR_CFGBIN_POSTGRES === "1" || selected === "postgres";
}

async function postgresDb() {
  const { createInagleSql } = await import("@rosegriffon/db/inagle-sql");
  return createInagleSql<SqlDatabase>();
}

export async function cfgbinPostgresFindLatest(
  category: string,
  prefix: string,
): Promise<string | null> {
  if (!cfgbinPostgresEnabled()) return null;
  try {
    const row = await (
      await postgresDb()
    )
      .selectFrom("inagle_cfgbin")
      .select("path")
      .where("path", "like", `data/common/gamedata/${category}/${prefix}%cfg.bin`)
      .where("parsed", "=", 1)
      .orderBy("path", "desc")
      .limit(1)
      .executeTakeFirst();
    const base = row?.path.split("/").pop();
    return base ? `${base}.json` : null;
  } catch {
    return null;
  }
}

export async function cfgbinPostgresLoadByPath(path: string): Promise<unknown> {
  if (!cfgbinPostgresEnabled()) throw new Error("cfgbin-postgres: disabled");
  const row = await (
    await postgresDb()
  )
    .selectFrom("inagle_cfgbin")
    .select(["data", "error"])
    .where("path", "=", path)
    .executeTakeFirst();
  if (!row) throw new Error(`cfgbin-postgres: row not found '${path}'`);
  if (row.data == null)
    throw new Error(`cfgbin-postgres: parse failed '${path}': ${row.error ?? "?"}`);
  return row.data;
}

export function cfgbinPostgresLoad(category: string, filename: string): Promise<unknown> {
  return cfgbinPostgresLoadByPath(cfgbinDbPathFor(category, filename));
}

export function cfgbinPostgresLoadText(locale: string, filename: string): Promise<unknown> {
  return cfgbinPostgresLoadByPath(cfgbinDbTextPathFor(locale, filename));
}

/**
 * True if the DB exists and is usable. Cached after first check.
 * Discovery inspects file metadata and never creates a database.
 */
export function cfgbinDbAvailable(): boolean {
  const p = cfgbinDbPath();
  if (_selectedDbPath !== p) {
    _findStmt?.finalize();
    _loadStmt?.finalize();
    _listStmt?.finalize();
    _db?.close();
    _db = null;
    _findStmt = _loadStmt = _listStmt = null;
    _enabled = null;
    _selectedDbPath = p;
  }
  try {
    const metadata = statSync(p);
    _enabled = metadata.isFile() && metadata.size > 0;
  } catch {
    _enabled = false;
  }
  return _enabled;
}

/**
 * Lazy-open the DB in read-only mode. Returns null if unavailable.
 * Subsequent calls reuse the same handle.
 */
function getDb(): Database | null {
  if (!cfgbinDbAvailable()) return null;
  if (_db) return _db;
  _db = new DB!(cfgbinDbPath(), { readonly: true });
  const table = _db
    .query(
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name IN ('cfgbin', 'inagle_cfgbin') ORDER BY name LIMIT 1",
    )
    .get() as { name: "cfgbin" | "inagle_cfgbin" } | null;
  if (!table) {
    _db.close();
    _db = null;
    throw new Error("cfgbin-db: the selected SQLite source has no cfg.bin projection");
  }
  _cfgbinTable = table.name;
  _jsonColumn = table.name === "inagle_cfgbin" ? "data" : "json";
  _db.exec("PRAGMA temp_store=MEMORY");
  _db.exec("PRAGMA cache_size=-65536");
  return _db;
}

function findStmt(db: Database) {
  if (!_findStmt) {
    _findStmt = db.prepare<{ path: string }, [string]>(
      `SELECT path FROM ${_cfgbinTable}
       WHERE path LIKE ? AND parsed = 1
       ORDER BY path DESC
       LIMIT 1`,
    );
  }
  return _findStmt;
}

function loadStmt(db: Database) {
  if (!_loadStmt) {
    _loadStmt = db.prepare<{ json: string | null; error: string | null }, [string]>(
      `SELECT ${_jsonColumn} AS json, error FROM ${_cfgbinTable} WHERE path = ?`,
    );
  }
  return _loadStmt;
}

function listStmt(db: Database) {
  if (!_listStmt) {
    _listStmt = db.prepare<{ path: string }, [string]>(
      `SELECT path FROM ${_cfgbinTable} WHERE path LIKE ? AND parsed = 1`,
    );
  }
  return _listStmt;
}

/**
 * Internal path inside the CPK for a (category, filename) pair.
 * Strips `.json` since the DB stores the original `.cfg.bin` paths.
 */
export function cfgbinDbPathFor(category: string, filename: string): string {
  const stripped = filename.endsWith(".json") ? filename.slice(0, -".json".length) : filename;
  return `data/common/gamedata/${category}/${stripped}`;
}

/**
 * Internal path for a localized text file.
 *   inagle: textRoot/<locale>/chara_text.cfg.bin.json
 *   DB:     data/common/text/<locale>/chara_text.cfg.bin
 */
export function cfgbinDbTextPathFor(locale: string, filename: string): string {
  const stripped = filename.endsWith(".json") ? filename.slice(0, -".json".length) : filename;
  return `data/common/text/${locale}/${stripped}`;
}

/**
 * Find the latest version of a cfg.bin matching `prefix*` in `category`.
 * Returns the basename (with `.json` suffix added back so callers stay drop-in
 * compatible with the filesystem `findConfigFile`).
 *
 * Returns null if DB unavailable or no match.
 */
export function cfgbinDbFindLatest(category: string, prefix: string): string | null {
  const db = getDb();
  if (!db) return null;
  // Pattern : data/common/gamedata/<category>/<prefix>%cfg.bin
  const pattern = `data/common/gamedata/${category}/${prefix}%cfg.bin`;
  const row = findStmt(db).get(pattern) as { path: string } | null;
  if (!row) return null;
  // Reconstruct filename + .json suffix to stay compatible with loadConfig() callers
  const base = row.path.split("/").pop() ?? "";
  return base ? `${base}.json` : null;
}

/**
 * Returns parsed JSON for a cfg.bin in `category` with `filename`.
 * Throws if the row is absent OR if parsed=0 (the DB knows it failed).
 */
export function cfgbinDbLoad(category: string, filename: string): unknown {
  const db = getDb();
  if (!db) throw new Error("cfgbin-db: DB unavailable");
  const path = cfgbinDbPathFor(category, filename);
  const row = loadStmt(db).get(path) as {
    json: string | null;
    error: string | null;
  } | null;
  if (!row) throw new Error(`cfgbin-db: row not found '${path}'`);
  if (row.json === null) {
    throw new Error(`cfgbin-db: parse failed '${path}': ${row.error ?? "?"}`);
  }
  return decodeProjectionJson(row.json);
}

/**
 * Returns parsed JSON for a localized text cfg.bin (chara_text, skill_text...).
 *
 * Note : par defaut on **bypass** la DB pour les fichiers `text/*` car le parser
 * cfg.bin actuel corrompt les chaines (vars[N] = null au lieu du nom localise,
 * cf. NOUN_INFO_*). Le filesystem fallback (`~/data/common/text/<locale>/*.cfg.bin.json`)
 * a la version correcte. Pour re-activer apres fix parser, exporter
 * `IEVR_CFGBIN_DB_TEXT=1`.
 */
export function cfgbinDbLoadText(locale: string, filename: string): unknown {
  const db = getDb();
  if (!db) throw new Error("cfgbin-db: DB unavailable");
  if (_cfgbinTable === "cfgbin" && process.env.IEVR_CFGBIN_DB_TEXT !== "1") {
    throw new Error(
      "cfgbin-db: text loading disabled (parser bug). Set IEVR_CFGBIN_DB_TEXT=1 to opt in.",
    );
  }
  const path = cfgbinDbTextPathFor(locale, filename);
  const row = loadStmt(db).get(path) as {
    json: string | null;
    error: string | null;
  } | null;
  if (!row) throw new Error(`cfgbin-db: row not found '${path}'`);
  if (row.json === null) {
    throw new Error(`cfgbin-db: parse failed '${path}': ${row.error ?? "?"}`);
  }
  return decodeProjectionJson(row.json);
}

/**
 * Returns parsed JSON for an arbitrary internal_path. Useful for paths that
 * don't fit the (category, filename) shape (e.g., direct `data/common/...`).
 */
export function cfgbinDbLoadByPath(internalPath: string): unknown {
  const db = getDb();
  if (!db) throw new Error("cfgbin-db: DB unavailable");
  const row = loadStmt(db).get(internalPath) as {
    json: string | null;
    error: string | null;
  } | null;
  if (!row) throw new Error(`cfgbin-db: row not found '${internalPath}'`);
  if (row.json === null) {
    throw new Error(`cfgbin-db: parse failed '${internalPath}': ${row.error ?? "?"}`);
  }
  return decodeProjectionJson(row.json);
}

/**
 * Lists all internal_path matching a SQL LIKE pattern. Useful to discover all
 * `chara_param_*.cfg.bin` for a category.
 */
export function cfgbinDbList(pathPattern: string): string[] {
  const db = getDb();
  if (!db) return [];
  const rows = listStmt(db).all(pathPattern) as { path: string }[];
  return rows.map((r) => r.path);
}

/**
 * Closes the DB. Pas obligatoire (le process exit close de toute facon),
 * mais utile pour les tests.
 */
export function cfgbinDbClose(): void {
  if (_db) {
    _db.close();
    _db = null;
    _findStmt = null;
    _loadStmt = null;
    _listStmt = null;
  }
}
