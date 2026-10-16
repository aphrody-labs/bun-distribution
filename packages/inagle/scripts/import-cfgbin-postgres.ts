/** Import the SQLite extraction cache into the durable PostgreSQL cfgbin table.
 *
 * This is intentionally one-way and resumable: SQLite remains untouched, rows
 * are upserted by their canonical internal path, and malformed rows are kept
 * with parsed=0/error instead of being silently discarded.
 */
import { Database } from "bun:sqlite";
import { createInagleSql } from "@rosegriffon/db/inagle-sql";
import type { Database as SqlDatabase } from "@rosegriffon/db/schema";

const sourcePath = process.env.IEVR_CFGBIN_DB;
if (!sourcePath) throw new Error("IEVR_CFGBIN_DB must point to the SQLite extraction cache");

const source = new Database(sourcePath, { readonly: true });
const target = createInagleSql<SqlDatabase>();
const batchSize = Number(process.env.CFGBIN_IMPORT_BATCH ?? 500);
let offset = 0;
let imported = 0;

try {
  while (true) {
    const rows = source
      .query(
        "SELECT path, cpk, size, parsed, format, error, json FROM cfgbin ORDER BY path LIMIT ? OFFSET ?",
      )
      .all(batchSize, offset) as Array<{
      path: string;
      cpk: string;
      size: number;
      parsed: number;
      format: string | null;
      error: string | null;
      json: string | null;
    }>;
    if (rows.length === 0) break;
    await target
      .insertInto("inagle_cfgbin")
      .values(
        rows.map((row) => ({
          path: row.path,
          cpk: row.cpk,
          size: row.size,
          parsed: row.parsed,
          format: row.format,
          error: row.error,
          data: row.json ? JSON.parse(row.json) : null,
        })),
      )
      .onConflict((oc) =>
        oc.column("path").doUpdateSet(({ ref }) => ({
          cpk: ref("excluded.cpk"),
          size: ref("excluded.size"),
          parsed: ref("excluded.parsed"),
          format: ref("excluded.format"),
          error: ref("excluded.error"),
          data: ref("excluded.data"),
        })),
      )
      .execute();
    imported += rows.length;
    offset += rows.length;
    console.log(`cfgbin import: ${imported} rows`);
  }
} finally {
  source.close();
}
