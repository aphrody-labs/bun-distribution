// SPDX-License-Identifier: Apache-2.0
/** Steam index database (bun:sqlite). One schema version, WAL, rebuilt per scan inside a transaction. */
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { statePath } from "@aphrody/paths";

export const SCHEMA_VERSION = 1;

/** Default location: `<APHRODY_HOME>/db/steam.sqlite`. */
export const defaultSteamDbPath = (): string => statePath("db", "steam.sqlite");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS scan (
  id INTEGER PRIMARY KEY, started_at TEXT NOT NULL, finished_at TEXT, host TEXT NOT NULL,
  steam_root TEXT NOT NULL, file_count INTEGER DEFAULT 0, byte_total INTEGER DEFAULT 0, notes TEXT);
CREATE TABLE IF NOT EXISTS root (
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL, path TEXT NOT NULL UNIQUE, exists_ INTEGER NOT NULL,
  file_count INTEGER DEFAULT 0, byte_total INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS file (
  id INTEGER PRIMARY KEY, root_id INTEGER NOT NULL REFERENCES root(id), rel_path TEXT NOT NULL,
  top_dir TEXT, ext TEXT, size INTEGER NOT NULL, mtime INTEGER NOT NULL, kind TEXT NOT NULL,
  mime TEXT, owner_appid INTEGER, sensitive INTEGER NOT NULL DEFAULT 0, sha256 TEXT,
  UNIQUE(root_id, rel_path));
CREATE INDEX IF NOT EXISTS file_kind ON file(kind);
CREATE INDEX IF NOT EXISTS file_owner ON file(owner_appid);
CREATE INDEX IF NOT EXISTS file_ext ON file(ext);
CREATE TABLE IF NOT EXISTS dir_size (
  root_id INTEGER NOT NULL REFERENCES root(id), rel_path TEXT NOT NULL, depth INTEGER NOT NULL,
  file_count INTEGER NOT NULL, byte_total INTEGER NOT NULL, PRIMARY KEY(root_id, rel_path));
CREATE TABLE IF NOT EXISTS library (
  idx INTEGER PRIMARY KEY, path TEXT NOT NULL, label TEXT, contentid TEXT, total_size INTEGER,
  update_clean_bytes_tally INTEGER, time_last_update_verified INTEGER, app_count INTEGER);
CREATE TABLE IF NOT EXISTS app (
  appid INTEGER PRIMARY KEY, library_idx INTEGER, name TEXT, universe INTEGER, state_flags INTEGER,
  installdir TEXT, install_path TEXT, last_updated INTEGER, last_played INTEGER, size_on_disk INTEGER,
  staging_size INTEGER, buildid INTEGER, target_buildid INTEGER, bytes_to_download INTEGER,
  bytes_downloaded INTEGER, bytes_to_stage INTEGER, bytes_staged INTEGER, auto_update_behavior INTEGER,
  scheduled_auto_update INTEGER, language TEXT, betakey TEXT, manifest_path TEXT NOT NULL,
  downloading_bytes INTEGER, exe_path TEXT);
CREATE TABLE IF NOT EXISTS app_depot (
  appid INTEGER NOT NULL, depotid INTEGER NOT NULL, state TEXT NOT NULL, manifest TEXT, size INTEGER,
  dlcappid INTEGER, owner_appid INTEGER, PRIMARY KEY(appid, depotid, state));
CREATE TABLE IF NOT EXISTS app_info (
  appid INTEGER PRIMARY KEY, info_state INTEGER, last_updated INTEGER, pics_token TEXT, change_number INTEGER,
  sha1 TEXT, binary_sha1 TEXT, name TEXT, type TEXT, oslist TEXT, osarch TEXT, developer TEXT, publisher TEXT,
  homepage TEXT, installdir TEXT, release_state TEXT, steam_release_date INTEGER, parent INTEGER,
  depot_count INTEGER, branch_count INTEGER, launch_count INTEGER, kv_json TEXT);
CREATE INDEX IF NOT EXISTS app_info_type ON app_info(type);
CREATE TABLE IF NOT EXISTS app_info_depot (
  appid INTEGER NOT NULL, depotid INTEGER NOT NULL, name TEXT, oslist TEXT, osarch TEXT, language TEXT,
  dlcappid INTEGER, depotfromapp INTEGER, shared_install INTEGER, public_gid TEXT, public_size INTEGER,
  public_download INTEGER, max_size INTEGER, encrypted_manifests INTEGER, PRIMARY KEY(appid, depotid));
CREATE TABLE IF NOT EXISTS app_info_branch (
  appid INTEGER NOT NULL, branch TEXT NOT NULL, buildid INTEGER, timeupdated INTEGER, description TEXT,
  pwdrequired INTEGER, PRIMARY KEY(appid, branch));
CREATE TABLE IF NOT EXISTS app_info_launch (
  appid INTEGER NOT NULL, idx TEXT NOT NULL, executable TEXT, arguments TEXT, type TEXT, oslist TEXT,
  osarch TEXT, description TEXT, workingdir TEXT, PRIMARY KEY(appid, idx));
CREATE TABLE IF NOT EXISTS package (
  packageid INTEGER PRIMARY KEY, sha1 TEXT, change_number INTEGER, token TEXT, billingtype INTEGER,
  licensetype INTEGER, status INTEGER, app_count INTEGER, depot_count INTEGER, kv_json TEXT);
CREATE TABLE IF NOT EXISTS package_app (packageid INTEGER NOT NULL, appid INTEGER NOT NULL, PRIMARY KEY(packageid, appid));
CREATE TABLE IF NOT EXISTS package_depot (packageid INTEGER NOT NULL, depotid INTEGER NOT NULL, PRIMARY KEY(packageid, depotid));
CREATE TABLE IF NOT EXISTS depot_manifest (
  depotid INTEGER NOT NULL, gid TEXT NOT NULL, path TEXT NOT NULL, bytes INTEGER NOT NULL, creation_time INTEGER,
  filenames_encrypted INTEGER, cb_disk_original INTEGER, cb_disk_compressed INTEGER, unique_chunks INTEGER,
  file_count INTEGER, dir_count INTEGER, chunk_count INTEGER, signature_bytes INTEGER, PRIMARY KEY(depotid, gid));
CREATE TABLE IF NOT EXISTS depot_file (
  depotid INTEGER NOT NULL, gid TEXT NOT NULL, filename TEXT NOT NULL, size INTEGER NOT NULL, flags INTEGER NOT NULL,
  sha_content TEXT, sha_filename TEXT, link_target TEXT, chunk_count INTEGER NOT NULL, PRIMARY KEY(depotid, gid, filename));
CREATE INDEX IF NOT EXISTS depot_file_sha ON depot_file(sha_content);
CREATE TABLE IF NOT EXISTS pe_file (
  file_id INTEGER PRIMARY KEY REFERENCES file(id), kind TEXT, machine TEXT, bits INTEGER, subsystem TEXT,
  timestamp INTEGER, image_size INTEGER, entry_rva INTEGER, is_dotnet INTEGER, file_version TEXT,
  product_version TEXT, company TEXT, product TEXT, description TEXT, original_filename TEXT, signer TEXT,
  issuer TEXT, certificates INTEGER, import_count INTEGER, export_count INTEGER, imports_steam_api INTEGER,
  imports_json TEXT, warnings TEXT);
CREATE TABLE IF NOT EXISTS user (
  steamid3 INTEGER PRIMARY KEY, steamid64 TEXT, path TEXT NOT NULL, has_localconfig INTEGER, app_count INTEGER,
  cloud_app_count INTEGER, byte_total INTEGER);
CREATE TABLE IF NOT EXISTS app_user (
  steamid3 INTEGER NOT NULL, appid INTEGER NOT NULL, last_played INTEGER, playtime INTEGER,
  playtime_disconnected INTEGER, cloud_enabled INTEGER, PRIMARY KEY(steamid3, appid));
CREATE TABLE IF NOT EXISTS cloud_file (
  steamid3 INTEGER NOT NULL, appid INTEGER NOT NULL, root TEXT, path TEXT NOT NULL, size INTEGER, sha TEXT,
  time INTEGER, syncstate INTEGER, persiststate INTEGER, local_present INTEGER, local_size INTEGER,
  PRIMARY KEY(steamid3, appid, path));
CREATE TABLE IF NOT EXISTS cloud_app (
  steamid3 INTEGER NOT NULL, appid INTEGER NOT NULL, change_number TEXT, ostype INTEGER, file_count INTEGER,
  byte_total INTEGER, PRIMARY KEY(steamid3, appid));
CREATE TABLE IF NOT EXISTS librarycache (
  steamid3 INTEGER, appid INTEGER NOT NULL, source TEXT NOT NULL, keys TEXT, bytes INTEGER, PRIMARY KEY(steamid3, appid, source));
CREATE TABLE IF NOT EXISTS secret_artifact (
  root_id INTEGER NOT NULL REFERENCES root(id), rel_path TEXT NOT NULL, category TEXT NOT NULL,
  size INTEGER NOT NULL, mtime INTEGER NOT NULL, note TEXT, PRIMARY KEY(root_id, rel_path));
CREATE TABLE IF NOT EXISTS reg_value (
  hive TEXT NOT NULL, key TEXT NOT NULL, name TEXT NOT NULL, type TEXT, value TEXT, PRIMARY KEY(hive, key, name));
CREATE TABLE IF NOT EXISTS reg_app (appid INTEGER PRIMARY KEY, name TEXT, installed INTEGER, updating INTEGER, running INTEGER);
CREATE TABLE IF NOT EXISTS process (pid INTEGER PRIMARY KEY, ppid INTEGER, name TEXT NOT NULL, path TEXT);
CREATE TABLE IF NOT EXISTS log_event (
  id INTEGER PRIMARY KEY, log TEXT NOT NULL, ts TEXT, line INTEGER NOT NULL, message TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS log_event_log ON log_event(log, ts);
CREATE VIRTUAL TABLE IF NOT EXISTS log_event_fts USING fts5(message, content='log_event', content_rowid='id');
CREATE TABLE IF NOT EXISTS api_interface (name TEXT PRIMARY KEY, method_count INTEGER NOT NULL, fetched_at TEXT NOT NULL, source TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS api_method (
  interface TEXT NOT NULL, name TEXT NOT NULL, version INTEGER NOT NULL, httpmethod TEXT, url TEXT NOT NULL,
  needs_key INTEGER, param_count INTEGER, description TEXT, PRIMARY KEY(interface, name, version));
CREATE TABLE IF NOT EXISTS api_param (
  interface TEXT NOT NULL, method TEXT NOT NULL, version INTEGER NOT NULL, name TEXT NOT NULL, type TEXT,
  optional INTEGER, description TEXT, PRIMARY KEY(interface, method, version, name));
CREATE TABLE IF NOT EXISTS api_endpoint (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, url TEXT NOT NULL, auth TEXT NOT NULL, description TEXT, params TEXT);
CREATE TABLE IF NOT EXISTS store_app (
  appid INTEGER PRIMARY KEY, fetched_at TEXT NOT NULL, success INTEGER NOT NULL, type TEXT, name TEXT,
  is_free INTEGER, developers TEXT, publishers TEXT, release_date TEXT, coming_soon INTEGER, metacritic INTEGER,
  recommendations INTEGER, price_initial INTEGER, price_final INTEGER, currency TEXT, dlc_count INTEGER,
  categories TEXT, genres TEXT, platforms TEXT, website TEXT, json TEXT);
CREATE TABLE IF NOT EXISTS applist (appid INTEGER PRIMARY KEY, name TEXT NOT NULL, fetched_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS auth_session (
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL, steamid64 TEXT, realm TEXT, return_to TEXT, created_at TEXT NOT NULL,
  verified_at TEXT, nonce TEXT);
`;

/** Tables rebuilt by every local scan (API/store tables persist across scans). */
export const SCAN_TABLES = [
  "pe_file",
  "file",
  "dir_size",
  "root",
  "library",
  "app",
  "app_depot",
  "app_info",
  "app_info_depot",
  "app_info_branch",
  "app_info_launch",
  "package",
  "package_app",
  "package_depot",
  "depot_manifest",
  "depot_file",
  "user",
  "app_user",
  "cloud_file",
  "cloud_app",
  "librarycache",
  "secret_artifact",
  "reg_value",
  "reg_app",
  "process",
  "log_event",
];

export function openSteamDb(path = defaultSteamDbPath()): Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA synchronous = NORMAL");
  db.run("PRAGMA temp_store = MEMORY");
  const version = (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
  if (version !== 0 && version < SCHEMA_VERSION) {
    // Single schema version so far: older files are rebuilt from scratch.
    for (const t of SCAN_TABLES) db.run(`DROP TABLE IF EXISTS ${t}`);
    db.run("DROP TABLE IF EXISTS log_event_fts");
  }
  db.exec(SCHEMA);
  db.run(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  return db;
}

/** Clears the scan tables (API catalog and store cache stay). Call inside a transaction. */
export function clearScanTables(db: Database): void {
  for (const t of SCAN_TABLES) db.run(`DELETE FROM ${t}`);
  db.run("INSERT INTO log_event_fts(log_event_fts) VALUES ('rebuild')");
}

export interface TableCount {
  table: string;
  rows: number;
}
export function tableCounts(db: Database): TableCount[] {
  const names = db
    .query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'log_event_fts%' ORDER BY name",
    )
    .all() as { name: string }[];
  return names.map(({ name }) => ({
    table: name,
    rows: (db.query(`SELECT count(*) AS n FROM ${name}`).get() as { n: number }).n,
  }));
}
