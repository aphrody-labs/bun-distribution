// Source: packages/shenron/db/src/types.ts at 8172f535ce (preserved Git history).
// SPDX-License-Identifier: Apache-2.0
/** Type-only surface of `@shenron/db`. Runtime class: `pure`. */
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { FullSchema } from "./full-schema";
import type { AgentAuditRow, AgentKeyRow } from "./schema";

export type { FullSchema } from "./full-schema";
export type { AgentAuditRow, AgentKeyRow } from "./schema";
export type { AgentScope, FeedbackStatus, GoalPriority, WikiCategoryName } from "./constants";
export type { EnvSource } from "./config";

/** Any Drizzle PostgreSQL database (postgres-js, Bun.SQL, mock) over schema `S`. */
export type ShenronPgDatabase<S extends Record<string, unknown> = FullSchema> = PgDatabase<PgQueryResultHKT, S>;

/** Raw parameterised query function (`$1`, `$2`… placeholders). */
export type SqlQuery = <T = Record<string, unknown>>(text: string, params?: readonly unknown[]) => Promise<T[]>;

/** Row types re-exported for consumers that only need shapes. */
export type AgentKeyRecord = AgentKeyRow;
export type AgentAuditRecord = AgentAuditRow;
