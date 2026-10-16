/**
 * Kysely/PostgreSQL boundary for Achillea.
 *
 * This is the replacement seam for MikroORM: SQL migrations remain the source
 * of truth, transactions and row locks are explicit, and the connection is
 * always pinned to the unified `rg.achillea` schema. Keep the DB shape in the
 * generated/contract layer as tables are migrated one service at a time.
 */
import { Kysely, PostgresDialect } from "kysely";

import { ACHILLEA_SCHEMA, getAchilleaDatabaseUrl } from "./achillea";
import { createPgPool } from "./pg";

/** SQL template shared by packages without a direct Kysely dependency. */
export { sql } from "kysely";

export interface AchilleaSqlOptions {
	url?: string;
	maxConnections?: number;
}

// The cache stores instances without inventing a fake shared schema. Every
// caller passes its own explicit Kysely database interface and the cast is
// only for the runtime cache, never for query construction.
const clients = new Map<string, Kysely<never>>();

export function createAchilleaSql<DB extends object = never>(
	options: AchilleaSqlOptions = {},
): Kysely<DB> {
	const url = options.url ?? getAchilleaDatabaseUrl();
	const maxConnections = options.maxConnections ?? 8;
	const key = `${url}\u0000${maxConnections}`;
	const existing = clients.get(key);
	if (existing) return existing as unknown as Kysely<DB>;

	const sslConfig = url.includes("sslmode=disable")
		? false
		: { rejectUnauthorized: false };

	const pool = createPgPool(url, {
		applicationName: "rosegriffon-achillea",
		keepAlive: true,
		max: maxConnections,
		searchPath: `${ACHILLEA_SCHEMA},public`,
		ssl: sslConfig,
	});

	const database = new Kysely<DB>({
		dialect: new PostgresDialect({ pool }),
	});
	clients.set(key, database as unknown as Kysely<never>);
	return database;
}

/** Ferme les pools partagés (arrêt propre du bot, workers et tests). */
export async function destroyAchilleaSql(): Promise<void> {
	const openClients = [...clients.values()];
	clients.clear();
	await Promise.all(openClients.map((client) => client.destroy()));
}
