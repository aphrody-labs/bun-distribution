#!/usr/bin/env bun
/**
 * Copies the rows of an Inagle SQLite mirror into the Neon `inagle` database whose schema was
 * created by `apply-inagle-schema.ts --postgres`. Only tables present on both sides are copied;
 * each target table is truncated first, so a run replaces the Neon content with the mirror.
 *
 *   INAGLE_DATABASE_URL=postgres://…/inagle bun scripts/iecode/migration/import-sqlite-to-neon.ts [mirror.sqlite]
 *
 * IMPORT_FROM_TABLE=<table> resumes an interrupted run at that table (alphabetical order).
 */

import { Database } from "bun:sqlite";

type Column = { name: string; type: string; element: string | null };

const source = Bun.argv[2] ?? "var/mirror.sqlite";
const url = process.env.INAGLE_DATABASE_URL?.trim();
if (!url) throw new Error("INAGLE_DATABASE_URL is required");
if (!new URL(url).pathname.endsWith("/inagle")) throw new Error("the target must be the inagle database");

const lite = new Database(source, { readonly: true });
const pg = new Bun.SQL(url, { max: 4 });
const BATCH = 500;

const liteTables = new Set(
  lite
    .query<{ name: string }, []>("select name from sqlite_master where type = 'table' and name like 'inagle_%'")
    .all()
    .map(row => row.name),
);
const pgTables: string[] = (
  await pg`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' and table_name like 'inagle_%' order by table_name`
).map((row: { table_name: string }) => row.table_name);

function convert(value: unknown, column: Column): unknown {
  if (value === null || value === undefined) return null;
  if (column.type === "boolean") return value === 1 || value === "1" || value === true || value === "true";
  if (column.type === "json" || column.type === "jsonb") {
    if (typeof value !== "string") return JSON.stringify(value);
    try {
      JSON.parse(value);
      return value;
    } catch {
      return JSON.stringify(value);
    }
  }
  if (column.type === "ARRAY") {
    if (Array.isArray(value)) return value;
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) return parsed;
      } catch {}
      return [value];
    }
    return [value];
  }
  if (value instanceof Uint8Array) return column.type === "bytea" ? value : new TextDecoder().decode(value);
  if (column.type === "bytea" && typeof value === "string") return new TextEncoder().encode(value);
  if (typeof value === "bigint") return value.toString();
  return value;
}

const from = process.env.IMPORT_FROM_TABLE ?? "";
let total = 0;
for (const table of pgTables) {
  if (!liteTables.has(table) || table < from) continue;
  const columns: Column[] = (
    await pg`select column_name as name, data_type as type, udt_name from information_schema.columns where table_schema = 'public' and table_name = ${table} order by ordinal_position`
  ).map((row: { name: string; type: string; udt_name: string }) => ({
    name: row.name,
    type: row.type,
    element: row.type === "ARRAY" ? row.udt_name.replace(/^_/, "") : null,
  }));
  const liteColumns = new Set(
    lite
      .query<{ name: string }, []>(`select name from pragma_table_info('${table.replaceAll("'", "''")}')`)
      .all()
      .map(row => row.name),
  );
  const shared = columns.filter(column => liteColumns.has(column.name));
  if (shared.length === 0) continue;

  // Hashes and CRCs land in columns the Postgres migrations typed `integer`/`smallint`:
  // widen such a column to bigint when the mirror holds a value outside its range.
  const numeric = new Set(["smallint", "integer", "bigint", "numeric", "real", "double precision"]);
  for (const column of shared) {
    if (!numeric.has(column.type)) continue;
    const text = lite
      .query<{ n: number }, []>(
        `select count(*) as n from "${table}" where typeof("${column.name}") = 'text' and (trim("${column.name}") glob '*[^0-9.eE+-]*' or trim("${column.name}") = '')`,
      )
      .get();
    if ((text?.n ?? 0) > 0) {
      await pg.unsafe(`alter table "${table}" alter column "${column.name}" type text using "${column.name}"::text`);
      column.type = "text";
      console.log(`${table}.${column.name}: holds text in the mirror, retyped to text`);
    }
  }
  for (const column of shared) {
    const limit = column.type === "integer" ? 2147483647 : column.type === "smallint" ? 32767 : 0;
    if (limit === 0) continue;
    const bounds = lite
      .query<{ low: number | null; high: number | null }, []>(
        `select min("${column.name}") as low, max("${column.name}") as high from "${table}" where typeof("${column.name}") = 'integer'`,
      )
      .get();
    if ((bounds?.high ?? 0) > limit || (bounds?.low ?? 0) < -limit - 1) {
      await pg.unsafe(`alter table "${table}" alter column "${column.name}" type bigint`);
      column.type = "bigint";
      console.log(`${table}.${column.name}: widened to bigint`);
    }
  }

  // The mirror carries its ids: accept them in GENERATED ALWAYS identity columns, then move each
  // identity sequence past the copied rows.
  const identities: string[] = (
    await pg`select column_name from information_schema.columns where table_schema = 'public' and table_name = ${table} and is_identity = 'YES'`
  ).map((row: { column_name: string }) => row.column_name);
  for (const name of identities)
    await pg.unsafe(`alter table "${table}" alter column "${name}" set generated by default`);

  await pg.unsafe(`truncate table "${table}" cascade`);
  const select = lite.query(`select ${shared.map(column => `"${column.name}"`).join(", ")} from "${table}"`);
  let batch: Record<string, unknown>[] = [];
  let copied = 0;
  const flush = async () => {
    if (batch.length === 0) return;
    await pg`insert into ${pg(table)} ${pg(batch, ...shared.map(column => column.name))} on conflict do nothing`;
    copied += batch.length;
    batch = [];
  };
  for (const row of select.iterate() as Iterable<Record<string, unknown>>) {
    const converted: Record<string, unknown> = {};
    for (const column of shared) converted[column.name] = convert(row[column.name], column);
    // SQLite tolerates NULL in a TEXT primary key; Postgres does not. Fall back to the row's
    // natural key (`<x>_id`, then `code`).
    if (converted.id === null && "id" in converted) {
      const natural = shared.find(column => column.name !== "id" && /(_id|^code)$/.test(column.name) && row[column.name] != null);
      if (natural) converted.id = String(row[natural.name]);
    }
    batch.push(converted);
    if (batch.length >= BATCH) await flush();
  }
  await flush();
  for (const name of identities)
    await pg.unsafe(
      `select setval(pg_get_serial_sequence('"${table}"', '${name}'), coalesce((select max("${name}") from "${table}"), 0) + 1, false)`,
    );
  total += copied;
  console.log(`${table}: ${copied}`);
}

console.log(`copied ${total} rows from ${source}`);
await pg.close();
lite.close();
