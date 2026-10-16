import { resolvePoolSize } from "@aphrody/sql/env";
import { createSql } from "@aphrody/sql/postgres";
import type { SQL } from "bun";
import { getDatabaseURL, getInagleDatabaseURL } from "./pg";

export interface BunSqlOptions {
  url?: string;
  max?: number;
  idleTimeout?: number;
  maxLifetime?: number;
  connectionTimeout?: number;
}

export interface BunPgQueryResult<Row = Record<string, unknown>> {
  rows: Row[];
  rowCount: number;
}

export interface BunPgClient {
  connect(): Promise<void>;
  query<Row = Record<string, unknown>>(text: string, params?: unknown[]): Promise<BunPgQueryResult<Row>>;
  end(): Promise<void>;
}

/** Build the canonical Bun PostgreSQL client used by Bun workers and bots. */
export function createBunSql(options: BunSqlOptions = {}): SQL {
  const url = options.url ?? getDatabaseURL();

  const max = options.max ?? resolvePoolSize(Bun.env.DATABASE_POOL_MAX, { fallback: 4, ceiling: 4 });
  // TLS and prepare stay with the URL and Bun's defaults (historical contract).
  return createSql(url, {
    max,
    idleTimeout: options.idleTimeout ?? 30,
    maxLifetime: options.maxLifetime ?? 1_800,
    connectionTimeout: options.connectionTimeout ?? 10,
    tls: "inherit",
    prepare: "inherit",
  });
}

export function createInagleBunSql(options: Omit<BunSqlOptions, "url"> = {}): SQL {
  return createBunSql({ ...options, url: getInagleDatabaseURL() });
}

/** Adaptateur client minimal pour les scripts historiques connect/query/end. */
export function createBunPgClient(connectionString: string): BunPgClient {
  const sql = createBunSql({ url: connectionString, max: 1 });
  return {
    async connect(): Promise<void> {},
    async query<Row = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<BunPgQueryResult<Row>> {
      const rows = (await sql.unsafe(text, params)) as Row[];
      return { rows, rowCount: rows.length };
    },
    async end(): Promise<void> {
      await sql.end();
    },
  };
}
