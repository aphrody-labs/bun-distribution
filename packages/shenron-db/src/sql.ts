// Source: packages/shenron/db/src/sql.ts at 8172f535ce (preserved Git history).
// SPDX-License-Identifier: Apache-2.0
/**
 * Raw postgres-js client. Runtime class: `server`.
 *
 * The client returned here is NEVER handed to `drizzle()`: the Drizzle
 * postgres-js driver replaces the json/jsonb/timestamptz serializers of the
 * client it wraps with identity functions. Raw SQL callers need the postgres-js
 * defaults, hence a distinct pool.
 */
import postgres from "postgres";
import { type EnvSource, resolveDatabaseUrl, resolvePoolMax } from "./config";

export interface PgClientOptions {
  /** Explicit URL; defaults to `env.DATABASE_URL`, read at call time. */
  url?: string;
  /** Environment source; defaults to `process.env` at call time. */
  env?: EnvSource;
  /** Pool size; defaults to `resolvePoolMax(DATABASE_POOL_MAX)`, capped at 20. */
  max?: number;
  /** `application_name` reported to PostgreSQL (one per process). */
  applicationName: string;
  /** Default 30. */
  idleTimeoutSeconds?: number;
  /** Default 5. */
  connectTimeoutSeconds?: number;
  /** Default true (local PostgreSQL, no pgbouncer). */
  prepare?: boolean;
}

export interface ResolvedPgClientOptions {
  url: string;
  max: number;
  applicationName: string;
  idleTimeoutSeconds: number;
  connectTimeoutSeconds: number;
  prepare: boolean;
}

/** Resolves URL and pool size; environment read inside the call only. */
export function resolvePgClientOptions(options: PgClientOptions): ResolvedPgClientOptions {
  const env = options.env ?? process.env;
  const max = options.max !== undefined ? resolvePoolMax(String(options.max)) : resolvePoolMax(env.DATABASE_POOL_MAX);
  return {
    url: resolveDatabaseUrl(options.url ?? env.DATABASE_URL),
    max,
    applicationName: options.applicationName,
    idleTimeoutSeconds: options.idleTimeoutSeconds ?? 30,
    connectTimeoutSeconds: options.connectTimeoutSeconds ?? 5,
    prepare: options.prepare ?? true,
  };
}

/** postgres-js options derived from {@link PgClientOptions}. */
export function postgresJsOptions(resolved: ResolvedPgClientOptions): postgres.Options<{}> {
  return {
    prepare: resolved.prepare,
    max: resolved.max,
    idle_timeout: resolved.idleTimeoutSeconds,
    connect_timeout: resolved.connectTimeoutSeconds,
    connection: { application_name: resolved.applicationName },
  };
}

/** Raw postgres-js pool (connects lazily on first query). */
export function createSql(options: PgClientOptions): postgres.Sql {
  const resolved = resolvePgClientOptions(options);
  return postgres(resolved.url, postgresJsOptions(resolved));
}
