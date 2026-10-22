// Per-game profiles of the Bun OS console shell (crates/bun-os-shell): frame limit, scaler,
// borderless orchestration, instant resume and performance overlay, keyed `steam:<appid>`,
// `bep:<library id>` or `web:<core>`. The shell writes the same usr/var/lib/bep/shell.db file
// through rusqlite with this schema.
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { usrRoot } from "../usr";

export interface Profile {
  key: string;
  title: string;
  fps_limit: number;
  scaler: "sharp" | "smooth" | "fsr1";
  borderless: number;
  instant_resume: number;
  hud: number;
  updated_at: string;
}

const schema = `
CREATE TABLE IF NOT EXISTS profiles (
  key TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  fps_limit INTEGER NOT NULL DEFAULT 0,
  scaler TEXT NOT NULL DEFAULT 'sharp',
  borderless INTEGER NOT NULL DEFAULT 1,
  instant_resume INTEGER NOT NULL DEFAULT 1,
  hud INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  key TEXT NOT NULL,
  kind TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  seconds REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS settings (name TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

const fields = new Set(["title", "fps_limit", "scaler", "borderless", "instant_resume", "hud"]);

export function shellDatabasePath(): string {
  return join(usrRoot(), "var", "lib", "bep", "shell.db");
}

export function openProfiles(path = shellDatabasePath()): Database {
  const db = new Database(path, { create: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run(schema);
  return db;
}

export function listProfiles(db = openProfiles()): Profile[] {
  return db.query("SELECT * FROM profiles ORDER BY key").all() as Profile[];
}

export function getProfile(key: string, db = openProfiles()): Profile | null {
  return db.query("SELECT * FROM profiles WHERE key = ?1").get(key) as Profile | null;
}

/** Inserts or updates `key` with `values` (only known fields; numbers for the flags). */
export function setProfile(
  key: string,
  values: Partial<Omit<Profile, "key" | "updated_at">>,
  db = openProfiles(),
): Profile {
  const entries = Object.entries(values).filter(([name]) => fields.has(name));
  db.query("INSERT OR IGNORE INTO profiles (key) VALUES (?1)").run(key);
  for (const [name, value] of entries) {
    db.query(`UPDATE profiles SET ${name} = ?2, updated_at = datetime('now') WHERE key = ?1`).run(
      key,
      value as string | number,
    );
  }
  return getProfile(key, db)!;
}

/** `field=value` pairs from the command line, numbers where the column is numeric. */
export function parseAssignments(args: string[]): Partial<Omit<Profile, "key" | "updated_at">> {
  const values: Record<string, string | number> = {};
  for (const arg of args) {
    const at = arg.indexOf("=");
    if (at <= 0) continue;
    const name = arg.slice(0, at);
    const raw = arg.slice(at + 1);
    if (!fields.has(name)) throw new Error(`unknown profile field ${name}`);
    values[name] = name === "title" || name === "scaler" ? raw : Number(raw === "on" ? 1 : raw === "off" ? 0 : raw);
  }
  return values;
}

/** Shell settings the web frontend shares with `crates/bun-os-shell` (same keys, same values). */
export const shellSettings = {
  hud: { values: ["0", "1"], fallback: "0" },
  motion: { values: ["system", "reduced", "full"], fallback: "system" },
  /** Interface sounds: "auto" plays them unless motion is reduced, "on" always, "off" never. */
  sounds: { values: ["auto", "on", "off"], fallback: "auto" },
} as const;

export type ShellSetting = keyof typeof shellSettings;

export function readShellSettings(): Record<ShellSetting, string> {
  const db = openProfiles();
  try {
    const rows = db.query("SELECT name, value FROM settings").all() as Array<{ name: string; value: string }>;
    const stored = new Map(rows.map(row => [row.name, row.value]));
    return {
      hud: stored.get("hud") ?? shellSettings.hud.fallback,
      motion: stored.get("motion") ?? shellSettings.motion.fallback,
      sounds: stored.get("sounds") ?? shellSettings.sounds.fallback,
    };
  } finally {
    db.close();
  }
}

export function writeShellSetting(name: string, value: string): Record<ShellSetting, string> {
  const spec = shellSettings[name as ShellSetting];
  if (!spec) throw new Error(`unknown setting ${name}`);
  if (!(spec.values as readonly string[]).includes(value)) throw new Error(`${name} is one of ${spec.values.join(", ")}`);
  const db = openProfiles();
  try {
    db.query(
      "INSERT INTO settings (name, value) VALUES (?1, ?2) ON CONFLICT(name) DO UPDATE SET value = excluded.value",
    ).run(name, value);
  } finally {
    db.close();
  }
  return readShellSettings();
}
