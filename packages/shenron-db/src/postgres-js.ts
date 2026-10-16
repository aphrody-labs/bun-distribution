// Source: packages/shenron/db/src/postgres-js.ts at 8172f535ce (preserved Git history).
// SPDX-License-Identifier: Apache-2.0
/** postgres-js pool + Drizzle. Runtime class: `server`. */
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { fullSchema, type FullSchema } from "./full-schema";
import * as schema from "./schema";
import { type PgClientOptions, postgresJsOptions, resolvePgClientOptions } from "./sql";

export type { PgClientOptions } from "./sql";
export type ShenronDb = PostgresJsDatabase<typeof schema>;
export type ShenronFullDb = PostgresJsDatabase<FullSchema>;

/** Legacy options of the root `createDb` (kept byte-compatible). */
export interface CreateDbOptions extends PgClientOptions {
  /** Defaults to `process.env.DATABASE_URL`. */
  url?: string;
  /** Defaults to `process.env.DATABASE_POOL_MAX` (capped). */
  max?: number;
  /** `application_name` reported to PostgreSQL (pg_stat_activity). */
  applicationName: string;
  /** Relational schema given to Drizzle: `public` (default) or `full` (public + bot). */
  schema?: "public" | "full";
}

/**
 * postgres-js pool + Drizzle, usable from Next, Bun scripts and the API.
 * Local PostgreSQL (no pgbouncer): prepared statements are safe.
 * postgres-js queues queries beyond `max`, it never fails on it.
 * The returned client has Drizzle's identity serializers: use `createSql` for raw SQL.
 */
export function createDb(options: CreateDbOptions & { schema: "full" }): {
  db: ShenronFullDb;
  client: postgres.Sql;
};
export function createDb(options: CreateDbOptions): { db: ShenronDb; client: postgres.Sql };
export function createDb(options: CreateDbOptions): {
  db: ShenronDb | ShenronFullDb;
  client: postgres.Sql;
} {
  const resolved = resolvePgClientOptions(options);
  const client = postgres(resolved.url, postgresJsOptions(resolved));
  if (options.schema === "full") {
    return { db: drizzle(client, { schema: fullSchema, logger: false }), client };
  }
  return { db: drizzle(client, { schema, logger: false }), client };
}
