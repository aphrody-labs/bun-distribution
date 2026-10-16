import { Client, Pool } from "pg";
import { PostgresDialect } from "kysely";

export type { PoolClient, QueryResultRow } from "pg";

export interface PgPoolOptions {
  applicationName?: string;
  keepAlive?: boolean;
  max?: number;
  searchPath?: string;
  ssl?: boolean | { rejectUnauthorized?: boolean };
}

function requireDatabaseURL(name: string, url: string | undefined): string {
  if (!url || url.startsWith("eyJ2Ijo") || url === "undefined" || url === "null") {
    throw new Error(`${name} absent ou corrompu : une chaîne Postgres valide est requise.`);
  }
  try {
    const parsed = new URL(url);
    if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !parsed.hostname || parsed.pathname.length <= 1)
      throw new Error();
  } catch {
    throw new Error(`${name} must identify a PostgreSQL host and database`);
  }
  return url;
}

/** Supabase PostgreSQL owns RG, Achillea and Better Auth. */
export function getDatabaseURL(): string {
  return requireDatabaseURL(
    "RG_DATABASE_URL/DATABASE_URL",
    process.env.RG_DATABASE_URL ?? process.env.DATABASE_URL ?? process.env.ROSE_GRIFFON_DATABASE_URL,
  );
}

/** Gameplay never falls back to the RG PostgreSQL connection. */
export function getInagleDatabaseURL(): string {
  return requireDatabaseURL(
    "INAGLE_DATABASE_URL/NIE_PG_URL",
    process.env.INAGLE_DATABASE_URL ?? process.env.NIE_PG_URL,
  );
}

export function isDatabaseConfigured(): boolean {
  try {
    getDatabaseURL();
    return true;
  } catch {
    return false;
  }
}

export function isInagleDatabaseConfigured(): boolean {
  try {
    getInagleDatabaseURL();
    return true;
  } catch {
    return false;
  }
}

let sharedPool: Pool | null = null;
let inaglePool: Pool | null = null;

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
  pool.on("error", error => console.error("[pg] Erreur inattendue sur le pool partagé :", error));
  return pool;
}

/** Crée une connexion PostgreSQL isolée pour LISTEN/NOTIFY ou un flux long. */
export function createPgClient(connectionString = getDatabaseURL()): Client {
  const client = new Client({
    application_name: "rosegriffon",
    connectionString,
    connectionTimeoutMillis: 5_000,
  });
  client.on("error", error => console.error("[pg] Erreur inattendue sur la connexion :", error));
  return client;
}

/** Singleton pg pool for server-side SQL consumers across the monorepo. */
export function getPgPool(options: PgPoolOptions = {}): Pool {
  if (!sharedPool) {
    sharedPool = createPgPool(getDatabaseURL(), options);
  }
  return sharedPool;
}

export function createPgDialect(options: PgPoolOptions = {}): PostgresDialect {
  return new PostgresDialect({ pool: async () => getPgPool(options) });
}

export function getInaglePgPool(options: PgPoolOptions = {}): Pool {
  if (!inaglePool)
    inaglePool = createPgPool(getInagleDatabaseURL(), {
      applicationName: "iecode-inagle",
      ...options,
    });
  return inaglePool;
}

export function createInaglePgDialect(options: PgPoolOptions = {}): PostgresDialect {
  return new PostgresDialect({
    pool: async () => ({
      get options() {
        return getInaglePgPool(options).options;
      },
      get Client() {
        return Reflect.get(getInaglePgPool(options), "Client");
      },
      connect: () => getInaglePgPool(options).connect(),
      end: () => closeInaglePgPool(),
    }),
  });
}

export async function closeInaglePgPool(): Promise<void> {
  const pool = inaglePool;
  inaglePool = null;
  await pool?.end();
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
  const pool = sharedPool;
  sharedPool = null;
  await Promise.all([pool?.end(), closeInaglePgPool()]);
}
