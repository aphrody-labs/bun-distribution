import { Client, Pool } from "pg";

export type { PoolClient, QueryResultRow } from "pg";

export interface PgPoolOptions {
	applicationName?: string;
	keepAlive?: boolean;
	max?: number;
	searchPath?: string;
	ssl?: boolean | { rejectUnauthorized?: boolean };
}

export function getDatabaseURL(): string {
	const url = process.env.DATABASE_URL;
	if (!url || url.startsWith("eyJ2Ijo") || url === "undefined" || url === "null") {
		throw new Error("DATABASE_URL absent ou corrompu : une chaîne Postgres valide est requise.");
	}
	return url;
}

export function isDatabaseConfigured(): boolean {
	const url = process.env.DATABASE_URL;
	return Boolean(url && !url.startsWith("eyJ2Ijo") && url !== "undefined" && url !== "null");
}

let sharedPool: Pool | null = null;

/** Crée un pool PostgreSQL isolé pour les CLI/imports qui fournissent leur URL. */
export function createPgPool(connectionString = getDatabaseURL(), options: PgPoolOptions = {}): Pool {
	const configuredMax = Number.parseInt(process.env.DATABASE_POOL_MAX ?? "", 10);
	const max = options.max ?? (configuredMax > 0 ? Math.min(configuredMax, 4) : 4);
	const pool = new Pool({
		application_name: options.applicationName ?? "rosegriffon",
		connectionString,
		connectionTimeoutMillis: 5_000,
		idleTimeoutMillis: 30_000,
		keepAlive: options.keepAlive,
		max,
		options: options.searchPath ? `-c search_path=${options.searchPath}` : undefined,
		ssl: options.ssl,
	});
	pool.on("error", (error) => console.error("[pg] Erreur inattendue sur le pool partagé :", error));
	return pool;
}

/** Crée une connexion PostgreSQL isolée pour LISTEN/NOTIFY ou un flux long. */
export function createPgClient(connectionString = getDatabaseURL()): Client {
	const client = new Client({
		application_name: "rosegriffon",
		connectionString,
		connectionTimeoutMillis: 5_000,
	});
	client.on("error", (error) => console.error("[pg] Erreur inattendue sur la connexion :", error));
	return client;
}

/** Singleton pg pool for server-side SQL consumers across the monorepo. */
export function getPgPool(options: PgPoolOptions = {}): Pool {
	if (!sharedPool) {
		sharedPool = createPgPool(getDatabaseURL(), options);
	}
	return sharedPool;
}

export function getPgPoolOrNull(): Pool | null {
	if (!isDatabaseConfigured()) return null;
	try {
		return getPgPool();
	} catch {
		return null;
	}
}

export async function closePgPool(): Promise<void> {
	if (!sharedPool) return;
	const pool = sharedPool;
	sharedPool = null;
	await pool.end();
}
