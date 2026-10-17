// SPDX-License-Identifier: Apache-2.0
/** Shared index operations behind the `bun-steam` CLI and the Steam MCP tools. */
import type { Database } from "bun:sqlite";
import { type ScanSummary, scanSteam } from "./scan.js";
import { openSteamDb, tableCounts } from "./db.js";
import { detectFile } from "./filetype.js";
import { extname } from "node:path";

export interface CommonOptions {
  db?: string | undefined;
  root?: string | undefined;
  hashMax?: number | undefined;
}

export const withDb = <T>(path: string | undefined, fn: (db: Database) => T): T => {
  const db = openSteamDb(path);
  try {
    return fn(db);
  } finally {
    db.close();
  }
};

export async function opScan(o: CommonOptions, log?: (m: string) => void): Promise<ScanSummary> {
  const db = openSteamDb(o.db);
  try {
    return await scanSteam({ db, root: o.root, hashMax: o.hashMax, log });
  } finally {
    db.close();
  }
}

export const opStats = (o: CommonOptions) => withDb(o.db, db => tableCounts(db));

const READONLY = /^\s*(select|with|pragma\s+table_info|explain)\b/i;

/** Runs a read-only SQL statement (single statement, SELECT/WITH only). */
export function opSql(o: CommonOptions, sql: string, limit = 200): unknown[] {
  if (!READONLY.test(sql) || sql.includes(";", sql.indexOf(";") + 1) || /;\s*\S/.test(sql)) {
    throw new Error("only a single read-only SELECT/WITH statement is allowed");
  }
  return withDb(o.db, db => db.query(sql).all().slice(0, limit));
}

export async function opClassify(path: string) {
  return { path, ...(await detectFile(path, extname(path).slice(1))) };
}
