export interface PostgresConnectionInput {
	connectionUrl?: string;
	host?: string;
	port?: string | number;
	database?: string;
	user?: string;
	password?: string;
}

export interface ResolvedPostgresConnection {
	host: string;
	port: number;
	database: string;
	user: string;
	password: string;
	tls: boolean;
}

const SUPABASE_HOST = /(?:^|\.)supabase\.(?:co|com)$/i;

function hasValue(value: string | number | undefined): value is string | number {
	return value !== undefined && String(value).trim().length > 0;
}

function parsePort(value: string | number | undefined): number {
	const port = Number(value ?? 5432);
	if (!Number.isInteger(port) || port < 1 || port > 65_535) {
		throw new Error("Port PostgreSQL invalide");
	}
	return port;
}

function requiresTls(host: string, sslMode?: string | null): boolean {
	if (SUPABASE_HOST.test(host)) {
		if (sslMode === "disable") {
			throw new Error("TLS ne peut pas être désactivé pour une base Supabase");
		}
		return true;
	}

	return ["require", "verify-ca", "verify-full"].includes(sslMode ?? "");
}

/**
 * Résout une configuration PostgreSQL sans jamais journaliser l'URL ni les identifiants.
 * `DATABASE_URL` est prioritaire ; les variables historiques restent prises en charge.
 */
export function resolvePostgresConnection(
	input: PostgresConnectionInput
): ResolvedPostgresConnection {
	if (hasValue(input.connectionUrl)) {
		let parsed: URL;
		try {
			parsed = new URL(String(input.connectionUrl));
		} catch {
			throw new Error("DATABASE_URL PostgreSQL invalide");
		}

		if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
			throw new Error("DATABASE_URL doit utiliser postgres:// ou postgresql://");
		}

		const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
		if (!parsed.hostname || !parsed.username || !database) {
			throw new Error("DATABASE_URL doit contenir hôte, utilisateur et base");
		}

		return {
			host: parsed.hostname,
			port: parsePort(parsed.port || 5432),
			database,
			user: decodeURIComponent(parsed.username),
			password: decodeURIComponent(parsed.password),
			tls: requiresTls(parsed.hostname, parsed.searchParams.get("sslmode")),
		};
	}

	if (![input.host, input.database, input.user].every(hasValue)) {
		throw new Error(
			"Configuration PostgreSQL absente: fournir DATABASE_URL ou DATABASE_HOST/DATABASE_NAME/DATABASE_USER"
		);
	}

	const host = String(input.host);
	return {
		host,
		port: parsePort(input.port),
		database: String(input.database),
		user: String(input.user),
		password: String(input.password ?? ""),
		tls: requiresTls(host),
	};
}
