// SPDX-License-Identifier: Apache-2.0
/** Shared operations behind the `re-steam` CLI and the Steam MCP server. */
import type { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { statePath } from "@aphrody/paths";
import { type ScanSummary, scanSteam } from "./scan.js";
import { openSteamDb, tableCounts } from "./db.js";
import { runPipeline } from "../pipeline/runner.js";
import { detectFile } from "./filetype.js";
import { extname } from "node:path";

export interface CommonOptions {
  db?: string | undefined;
  root?: string | undefined;
  hashMax?: number | undefined;
}

export const withDb = <T>(
  path: string | undefined,
  fn: (db: Database) => T,
): T => {
  const db = openSteamDb(path);
  try {
    return fn(db);
  } finally {
    db.close();
  }
};

export async function opScan(
  o: CommonOptions,
  log?: (m: string) => void,
): Promise<ScanSummary> {
  const db = openSteamDb(o.db);
  try {
    return await scanSteam({ db, root: o.root, hashMax: o.hashMax, log });
  } finally {
    db.close();
  }
}

export const opStats = (o: CommonOptions) =>
  withDb(o.db, (db) => tableCounts(db));

const READONLY = /^\s*(select|with|pragma\s+table_info|explain)\b/i;

/** Runs a read-only SQL statement (single statement, SELECT/WITH only). */
export function opSql(o: CommonOptions, sql: string, limit = 200): unknown[] {
  if (
    !READONLY.test(sql) ||
    sql.includes(";", sql.indexOf(";") + 1) ||
    /;\s*\S/.test(sql)
  ) {
    throw new Error("only a single read-only SELECT/WITH statement is allowed");
  }
  return withDb(o.db, (db) => db.query(sql).all().slice(0, limit));
}

export async function opClassify(path: string) {
  return { path, ...(await detectFile(path, extname(path).slice(1))) };
}

/** Runs the RE pipeline (`bunre pipeline`) on the executable of an installed app. */
export async function opRea(o: CommonOptions, appid: number, outdir?: string) {
  const row = withDb(
    o.db,
    (db) =>
      db.query("SELECT name, exe_path FROM app WHERE appid = ?").get(appid) as {
        name: string;
        exe_path: string | null;
      } | null,
  );
  if (!row?.exe_path)
    throw new Error(`app ${appid}: no scanned executable (run scan first)`);
  const out = outdir ?? statePath("re", "steam", String(appid));
  mkdirSync(out, { recursive: true });
  const report = await runPipeline(row.exe_path, {
    target: "os",
    outdir: out,
    trace: false,
  });
  return { appid, name: row.name, exe: row.exe_path, outdir: out, report };
}
