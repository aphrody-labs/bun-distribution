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

function getOrCreateDb(): { client: postgres.Sql; db: ShenronDb } {
	if (!globalForDb.pgClient || !globalForDb.pgDb) {
		const created = createDb({ applicationName: DB_APPLICATION_NAME });
		globalForDb.pgClient = created.client;
		globalForDb.pgDb = created.db;
	}
	return { client: globalForDb.pgClient, db: globalForDb.pgDb };
}

// Proxies defer createDb until first access, so importing db does not throw when DATABASE_URL is unset
const client: postgres.Sql = new Proxy({} as postgres.Sql, {
	get(_target, prop, receiver) {
		const actual = getOrCreateDb().client;
		const value = Reflect.get(actual as any, prop, receiver);
		return typeof value === "function" ? value.bind(actual) : value;
	},
	apply(_target, thisArg, argArray) {
		const actual = getOrCreateDb().client;
		return Reflect.apply(actual as any, thisArg, argArray);
	},
});

export const db: ShenronDb = new Proxy({} as ShenronDb, {
	get(_target, prop, receiver) {
		const actual = getOrCreateDb().db;
		const value = Reflect.get(actual as any, prop, receiver);
		return typeof value === "function" ? value.bind(actual) : value;
	},
});

export { schema };

/** Gracefully drains the shared pool (scripts, tests, shutdown hooks). */
export async function closeDb(timeoutSeconds = 5): Promise<void> {
	if (!globalForDb.pgClient) return;
	const active = globalForDb.pgClient;
	globalForDb.pgClient = undefined;
	globalForDb.pgDb = undefined;
	await active.end({ timeout: timeoutSeconds });
}
