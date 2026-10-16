// Source: packages/shenron/db/src/bun-sql.ts at 8172f535ce (preserved Git history).
// SPDX-License-Identifier: Apache-2.0
/**
 * Bun-native driver (Bun.SQL, zero dependency) for scripts, the bot and the
 * standalone API. Same schema and URL rules as the postgres-js entry point.
 * Runtime class: `bun`.
 */
import { createSql } from "@aphrody/sql/postgres";
import type { SQL } from "bun";
import { drizzle, type BunSQLDatabase } from "drizzle-orm/bun-sql";
import { fullSchema, type FullSchema } from "./full-schema";
import * as schema from "./schema";
import { type PgClientOptions, resolvePgClientOptions } from "./sql";

export { schema };
export type { PgClientOptions } from "./sql";
export type ShenronBunDb = BunSQLDatabase<typeof schema>;
export type ShenronFullBunDb = BunSQLDatabase<FullSchema>;

/** Default connection lifetime (seconds) before Bun.SQL recycles it. */
export const DEFAULT_MAX_LIFETIME_SECONDS = 1800;

export interface BunSqlOptions extends PgClientOptions {
  /** Default 1800 s. */
  maxLifetimeSeconds?: number;
}

/** Bun.SQL constructor options derived from {@link BunSqlOptions} (no connection). */
export function bunSqlOptions(options: BunSqlOptions) {
  const resolved = resolvePgClientOptions(options);
  return {
    url: resolved.url,
    max: resolved.max,
    idleTimeout: resolved.idleTimeoutSeconds,
    connectionTimeout: resolved.connectTimeoutSeconds,
    maxLifetime: options.maxLifetimeSeconds ?? DEFAULT_MAX_LIFETIME_SECONDS,
    prepare: resolved.prepare,
    connection: { application_name: resolved.applicationName },
  };
}

/**
 * Raw Bun.SQL pool (connects lazily). Built by `@aphrody/sql/postgres` with
 * every option explicit; TLS stays with the URL (historical contract).
 */
export function createBunSql(options: BunSqlOptions): SQL {
  const { url, ...rest } = bunSqlOptions(options);
  return createSql(url, { ...rest, tls: "inherit" });
}

export interface CreateBunDbOptions extends Partial<BunSqlOptions> {
  schema?: "public" | "full";
}

export function createBunDb(options: CreateBunDbOptions & { schema: "full" }): {
  db: ShenronFullBunDb;
  client: SQL;
};
export function createBunDb(options?: CreateBunDbOptions): { db: ShenronBunDb; client: SQL };
export function createBunDb(options: CreateBunDbOptions = {}): {
  db: ShenronBunDb | ShenronFullBunDb;
  client: SQL;
} {
  const client = createBunSql({
    ...options,
    applicationName: options.applicationName ?? "shenron-bun",
  });
  if (options.schema === "full") return { db: drizzle({ client, schema: fullSchema }), client };
  return { db: drizzle({ client, schema }), client };
}
