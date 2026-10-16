#!/usr/bin/env bun
/**
 * @file restore-dump-to-sqlite.ts
 * @description Ingests PostgreSQL dump data into SQLite mirror (var/mirror.sqlite)
 * for all canonical inagle_* tables.
 */

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import * as readline from "node:readline";

const root = resolve(process.env.NIE_REPO_ROOT ?? join(import.meta.dir, "../../.."));
const sqliteSchemaPath = join(root, "packages/inagle/src/sql/schema.sqlite.sql");
const defaultDumpPath = join(root, "var/rg-latest.dump");
const defaultSqlitePath = join(root, "var/mirror.sqlite");

const args = Bun.argv.slice(2);

function getArgValue(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length && !args[idx + 1].startsWith("-")) {
    return args[idx + 1];
  }
  return undefined;
}

export async function pullLatestDump(destPath: string): Promise<void> {
  console.log("📥 Pulling freshest PostgreSQL dump from production VPS (vps:/var/backups/postgres/)...");
  const dir = dirname(destPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const proc = Bun.spawn(["scp", "vps:/var/backups/postgres/rg-2026-10-01T03-15.dump", destPath], {
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`Failed to scp dump from VPS (exit code ${exitCode})`);
  }
  const sizeMb = (statSync(destPath).size / 1024 / 1024).toFixed(1);
  console.log(`✅ Freshest production dump downloaded successfully: ${destPath} (${sizeMb} MB)`);
}

function unescapePgValue(val: string): string | null {
  if (val === "\\N") return null;
  return val.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t").replace(/\\\\/g, "\\");
}

export async function restoreDumpToSqlite(
  dumpPath: string,
  sqlitePath: string,
): Promise<{ tableCounts: Record<string, number>; totalRows: number }> {
  console.log(`🔄 Restoring PostgreSQL dump to SQLite mirror...`);
  console.log(`   Source: ${dumpPath}`);
  console.log(`   Target: ${sqlitePath}`);

  if (!existsSync(dumpPath)) {
    throw new Error(`Dump file does not exist: ${dumpPath}`);
  }

  const dir = dirname(sqlitePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  // 1. Initialize SQLite schema
  const db = new Database(sqlitePath);
  db.run("PRAGMA journal_mode = WAL;");
  db.run("PRAGMA synchronous = NORMAL;");

  const schemaSql = readFileSync(sqliteSchemaPath, "utf-8");
  db.run(schemaSql);

  // Discover valid SQLite tables and columns
  const tableRows = db
    .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'inagle_%'")
    .all();
  const knownTables = new Set(tableRows.map(r => r.name));

  const tableColumns = new Map<string, Set<string>>();
  for (const t of knownTables) {
    const cols = db.query<{ name: string }, []>(`PRAGMA table_info(${t})`).all();
    tableColumns.set(t, new Set(cols.map(c => c.name)));
  }

  console.log(`   Found ${knownTables.size} canonical target tables in SQLite schema.`);

  // 2. Stream pg_restore output
  const restoreProc = spawn("pg_restore", ["-a", "-f", "-", dumpPath]);

  const rl = readline.createInterface({
    input: restoreProc.stdout,
    crlfDelay: Infinity,
  });

  let currentTable: string | null = null;
  let copyColumns: string[] = [];
  let colIndicesToKeep: number[] = [];
  let targetSqliteCols: string[] = [];
  let insertStmt: ReturnType<Database["prepare"]> | null = null;
  let pendingRows: (string | null)[][] = [];
  const tableCounts: Record<string, number> = {};
  let totalRows = 0;

  const flushRows = db.transaction((rows: (string | null)[][]) => {
    if (!insertStmt || rows.length === 0) return;
    for (const r of rows) {
      insertStmt.run(...r);
    }
  });

  const finishCurrentTable = () => {
    if (currentTable && pendingRows.length > 0) {
      flushRows(pendingRows);
      tableCounts[currentTable] = (tableCounts[currentTable] ?? 0) + pendingRows.length;
      totalRows += pendingRows.length;
      pendingRows = [];
    }
    currentTable = null;
    insertStmt = null;
  };

  for await (const line of rl) {
    if (line.startsWith("COPY public.")) {
      finishCurrentTable();

      const copyMatch = line.match(/^COPY public\.([a-zA-Z0-9_]+)\s*\((.+)\)\s*FROM stdin;$/);
      if (!copyMatch) continue;

      const tableName = copyMatch[1];
      if (!knownTables.has(tableName)) {
        // Skip tables not in the canonical inagle schema
        continue;
      }

      currentTable = tableName;
      copyColumns = copyMatch[2].split(",").map(c => c.trim().replace(/^"|"$/g, ""));
      const availableCols = tableColumns.get(tableName)!;

      colIndicesToKeep = [];
      targetSqliteCols = [];

      for (let i = 0; i < copyColumns.length; i++) {
        const col = copyColumns[i];
        if (availableCols.has(col)) {
          colIndicesToKeep.push(i);
          targetSqliteCols.push(`"${col}"`);
        }
      }

      if (targetSqliteCols.length > 0) {
        const placeholders = targetSqliteCols.map(() => "?").join(", ");
        const sql = `INSERT OR REPLACE INTO ${tableName} (${targetSqliteCols.join(", ")}) VALUES (${placeholders})`;
        insertStmt = db.prepare(sql);
      }
      continue;
    }

    if (line === "\\.") {
      finishCurrentTable();
      continue;
    }

    if (currentTable && insertStmt) {
      const parts = line.split("\t");
      const rowValues: (string | null)[] = [];
      for (const idx of colIndicesToKeep) {
        const raw = parts[idx] ?? "\\N";
        rowValues.push(unescapePgValue(raw));
      }
      pendingRows.push(rowValues);

      if (pendingRows.length >= 2000) {
        flushRows(pendingRows);
        tableCounts[currentTable] = (tableCounts[currentTable] ?? 0) + pendingRows.length;
        totalRows += pendingRows.length;
        pendingRows = [];
      }
    }
  }

  finishCurrentTable();
  db.close();

  console.log(`\n🎉 Data restoration complete!`);
  console.log(`   Total tables populated: ${Object.keys(tableCounts).length}`);
  console.log(`   Total rows imported: ${totalRows.toLocaleString()}`);

  const sample = Object.entries(tableCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);
  console.log("\nTop populated tables:");
  for (const [tbl, count] of sample) {
    console.log(`   - ${tbl.padEnd(25)}: ${count.toLocaleString()} rows`);
  }

  return { tableCounts, totalRows };
}

async function main(): Promise<void> {
  const dumpPath = getArgValue("--dump") || process.env.PG_DUMP_PATH || defaultDumpPath;
  const sqlitePath =
    getArgValue("--sqlite") || process.env.SQLITE_DB_PATH || process.env.NIE_MIRROR_DB || defaultSqlitePath;

  if (args.includes("--pull") || !existsSync(dumpPath)) {
    await pullLatestDump(dumpPath);
  }

  await restoreDumpToSqlite(dumpPath, sqlitePath);
}

if (import.meta.main) {
  main().catch(err => {
    console.error("❌ Restore error:", err);
    process.exit(1);
  });
}
