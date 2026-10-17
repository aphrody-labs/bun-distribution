import { Database, type SQLQueryBindings } from "bun:sqlite";
import { configuredDataSource, localMirrorPath, postgresConfigured, selectDataSource } from "../core/data-source.js";

export function projectionSource() {
  const selected = configuredDataSource();
  return selectDataSource({
    explicit: selected,
    sqliteAvailable: selected === "vfs" || selected === "postgres" ? false : !!localMirrorPath(),
    postgresAvailable: postgresConfigured(),
    postgresDisabled: process.env.IEVR_CFGBIN_POSTGRES === "0",
  });
}

/** Thin Bun-native read binding for the existing mirror; no create, restore or migration. */
export function sqliteRows<T>(sql: string, bindings: SQLQueryBindings[] = []): T[] {
  const path = localMirrorPath();
  if (!path) throw new Error("An existing IECODE SQLite mirror is required");
  const db = new Database(path, { readonly: true });
  try {
    return db.query(sql).all(...bindings) as T[];
  } finally {
    db.close();
  }
}
