import "server-only";
import type postgres from "postgres";
import { createDb, type ShenronDb } from "@shenron/db/postgres-js";
import * as schema from "@shenron/db/schema";

export {
	DEFAULT_POOL_MAX,
	POOL_MAX_CEILING,
	resolveDatabaseUrl,
	resolvePoolMax,
} from "@shenron/db/config";

export const DB_APPLICATION_NAME = "shenron-site";

const globalForDb = globalThis as unknown as {
	pgClient?: postgres.Sql;
	pgDb?: ShenronDb;
};

const { client, db } =
	globalForDb.pgClient && globalForDb.pgDb
		? { client: globalForDb.pgClient, db: globalForDb.pgDb }
		: createDb({ applicationName: DB_APPLICATION_NAME });

// Reuse the pool across hot reloads / module re-evaluations.
globalForDb.pgClient = client;
globalForDb.pgDb = db;
export { db };
export { schema };

/** Gracefully drains the shared pool (scripts, tests, shutdown hooks). */
export async function closeDb(timeoutSeconds = 5): Promise<void> {
	if (globalForDb.pgClient !== client) return;
	globalForDb.pgClient = undefined;
	globalForDb.pgDb = undefined;
	await client.end({ timeout: timeoutSeconds });
}
