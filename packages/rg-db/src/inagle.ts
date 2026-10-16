import { createInagleSql, sql } from "./inagle-sql";

const INAGLE_TABLES = new Set(["inagle_characters", "inagle_events", "inagle_items"]);

/** Read-only SQL projection access for the durable Inagle catalog. */
export async function selectInagle<T extends object>(table: string, columns: string): Promise<T[]> {
  if (!INAGLE_TABLES.has(table)) {
    throw new Error(`Table Inagle non autorisée: ${table}`);
  }

  const database = createInagleSql();
  const result = await sql<T>`select ${sql.raw(columns)} from public.${sql.raw(table)}`.execute(database);
  return result.rows;
}
