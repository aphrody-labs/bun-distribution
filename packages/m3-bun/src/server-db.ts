// SPDX-License-Identifier: Apache-2.0
// The database of an app's API: one `bun:sqlite` file next to the server, opened ready for a web server (WAL,
// foreign keys, a busy timeout, strict named parameters) and migrated forward with `PRAGMA user_version`.
//
//   const db = m3Db({ path: "data/app.sqlite", migrations: ["CREATE TABLE notes (id INTEGER PRIMARY KEY, text TEXT)"] });
//   export default defineM3Api({ "/api/notes": () => Response.json(db.query("SELECT * FROM notes").all()) });
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface M3DbOptions {
  /** Database file (default `:memory:`); its directory is created. */
  path?: string;
  /** Schema steps, in order, each applied once in its own transaction: step `i` brings `user_version` to `i + 1`. */
  migrations?: readonly (string | ((db: Database) => void))[];
  readonly?: boolean;
  /** Milliseconds a writer waits for a lock (default 5000). */
  busyTimeout?: number;
}

/** Open and migrate the API database. */
export function m3Db(options: M3DbOptions | string = {}): Database {
  const {
    path = ":memory:",
    migrations = [],
    readonly = false,
    busyTimeout = 5000,
  } = typeof options === "string" ? { path: options } : options;
  const memory = path === ":memory:" || path === "";
  if (!memory && !readonly) mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, readonly ? { readonly: true, strict: true } : { create: true, strict: true });
  db.run(`PRAGMA busy_timeout = ${Math.max(0, Math.trunc(busyTimeout))}`);
  db.run("PRAGMA foreign_keys = ON");
  if (readonly) return db;
  if (!memory) db.run("PRAGMA journal_mode = WAL");
  const current = (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
  if (current > migrations.length)
    throw new Error(
      `m3Db: ${path} is at schema version ${current}, newer than the ${migrations.length} migrations of this build`,
    );
  for (let version = current; version < migrations.length; version++) {
    const step = migrations[version]!;
    try {
      db.transaction(() => {
        if (typeof step === "string") db.run(step);
        else step(db);
        db.run(`PRAGMA user_version = ${version + 1}`);
      })();
    } catch (error) {
      db.close();
      throw new Error(`m3Db: migration ${version + 1} of ${path} failed`, { cause: error });
    }
  }
  return db;
}
