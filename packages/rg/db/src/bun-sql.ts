import { SQL } from "bun";

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
	const url = options.url ?? Bun.env.DATABASE_URL;
	if (!url) throw new Error("DATABASE_URL is required for the Bun PostgreSQL client");

	const configuredMax = Number.parseInt(Bun.env.DATABASE_POOL_MAX ?? "", 10);
	const max = options.max ?? (configuredMax > 0 ? Math.min(configuredMax, 4) : 4);
	return new SQL({
		url,
		max,
		idleTimeout: options.idleTimeout ?? 30,
		maxLifetime: options.maxLifetime ?? 1_800,
		connectionTimeout: options.connectionTimeout ?? 10,
	});
}

/** Adaptateur client minimal pour les scripts historiques connect/query/end. */
export function createBunPgClient(connectionString: string): BunPgClient {
	const sql = createBunSql({ url: connectionString, max: 1 });
	return {
		async connect(): Promise<void> {},
		async query<Row = Record<string, unknown>>(
			text: string,
			params: unknown[] = []
		): Promise<BunPgQueryResult<Row>> {
			const rows = (await sql.unsafe(text, params)) as Row[];
			return { rows, rowCount: rows.length };
		},
		async end(): Promise<void> {
			await sql.end();
		},
	};
}
