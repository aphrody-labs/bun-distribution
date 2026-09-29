import { ReflectMetadataProvider } from "@mikro-orm/decorators/legacy";
import { EntityGenerator } from "@mikro-orm/entity-generator";
import { Migrator } from "@mikro-orm/migrations";
import type { Options } from "@mikro-orm/postgresql";
import { PostgreSqlDriver } from "@mikro-orm/postgresql";
import { SqlHighlighter } from "@mikro-orm/sql-highlighter";
import { ACHILLEA_SCHEMA, getAchilleaDatabaseUrl } from "@rosegriffon/db/achillea";

// eslint-disable-next-line unused-imports/no-unused-imports
import { env } from "@/env";
import { resolvePostgresConnection } from "./postgres";
// AuditLogSubscriber is registered at ORM init time in Database.ts (not here)
// to avoid circular import issues with the CLI config loader.

type Config = {
	production: Options;
	development?: Options;
	test?: Options;
};

function connectionOptions(
	connectionUrl: string | undefined,
	legacy: {
		host?: string;
		port?: string | number;
		database?: string;
		user?: string;
		password?: string;
	}
) {
	const connection = resolvePostgresConnection({ connectionUrl, ...legacy });
	return {
		dbName: connection.database,
		host: connection.host,
		port: connection.port,
		user: connection.user,
		password: connection.password,
		// Les certificats Supabase sont publics et vérifiables : ne jamais désactiver
		// rejectUnauthorized, qui masquerait une interception TLS.
		driverOptions: {
			...(connection.tls ? { ssl: { rejectUnauthorized: true } } : {}),
			options: `-c search_path=${ACHILLEA_SCHEMA},public`,
		},
	};
}

const unifiedDatabaseUrl = env.DATABASE_URL ?? env.DATABASE_URL_DEV ?? getAchilleaDatabaseUrl();

const productionConnection = connectionOptions(unifiedDatabaseUrl, {
	host: env.DATABASE_HOST ?? env.DATABASE_HOST_DEV,
	port: env.DATABASE_PORT ?? env.DATABASE_PORT_DEV,
	database: env.DATABASE_NAME ?? env.DATABASE_NAME_DEV,
	user: env.DATABASE_USER ?? env.DATABASE_USER_DEV,
	password: env.DATABASE_PASSWORD ?? env.DATABASE_PASSWORD_DEV,
});

const developmentConnection = connectionOptions(env.DATABASE_URL_DEV ?? unifiedDatabaseUrl, {
	host: env.DATABASE_HOST_DEV ?? env.DATABASE_HOST,
	port: env.DATABASE_PORT_DEV ?? env.DATABASE_PORT,
	database: env.DATABASE_NAME_DEV ?? env.DATABASE_NAME,
	user: env.DATABASE_USER_DEV ?? env.DATABASE_USER,
	password: env.DATABASE_PASSWORD_DEV ?? env.DATABASE_PASSWORD,
});

const testConnection = connectionOptions(
	env.TEST_DATABASE_URL ?? env.DATABASE_URL_DEV ?? unifiedDatabaseUrl,
	{
		host: env.DATABASE_HOST_DEV ?? env.DATABASE_HOST,
		port: env.DATABASE_PORT_DEV ?? env.DATABASE_PORT,
		database: env.DATABASE_NAME_DEV ?? env.DATABASE_NAME,
		user: env.DATABASE_USER_DEV ?? env.DATABASE_USER,
		password: env.DATABASE_PASSWORD_DEV ?? env.DATABASE_PASSWORD,
	}
);

const envMikroORMConfig = {
	production: {
		/**
		 * PostgreSQL
		 */
		driver: PostgreSqlDriver,
		...productionConnection,

		highlighter: new SqlHighlighter(),
		// Pas de log SQL en prod (tableau vide = aucun debug → journal non noyé) ;
		// le Logger applicatif suffit. Debug détaillé conservé en dev/test.
		debug: [],
		logger: (message) => console.info(message),

		migrations: {
			path: "./database/migrations",
			emit: "ts",
			snapshot: true,
		},

		extensions: [Migrator, EntityGenerator],

		metadataProvider: ReflectMetadataProvider,

		// Supabase pooler session mode (port 5432) limite souvent à ~15 clients.
		// Sans plafond MikroORM ouvre trop de connexions → EMAXCONNSESSION → 500 API.
		// Laisser de la place au pool ranked Bun.SQL (BUN_SQL_MAX, défaut 5).
		pool: {
			min: 0,
			max: 8,
			idleTimeoutMillis: 30_000,
		},
	},

	development: {
		/**
		 * PostgreSQL
		 */
		driver: PostgreSqlDriver,
		...developmentConnection,

		highlighter: new SqlHighlighter(),
		debug: ["query", "info"],
		logger: (message) => console.info(message),

		migrations: {
			path: "./database/migrations",
			emit: "ts",
			snapshot: true,
		},

		extensions: [Migrator, EntityGenerator],

		// v7 : le provider par défaut n'infère plus les types via reflect-metadata.
		// On le réactive (décorateurs legacy + emitDecoratorMetadata + import reflect-metadata).
		metadataProvider: ReflectMetadataProvider,
	},
	test: {
		driver: PostgreSqlDriver,
		...testConnection,

		highlighter: new SqlHighlighter(),
		debug: ["query", "info"],
		logger: (message) => console.info(message),

		migrations: {
			path: "./database/migrations",
			emit: "ts",
			snapshot: true,
		},

		extensions: [Migrator, EntityGenerator],

		// v7 : le provider par défaut n'infère plus les types via reflect-metadata.
		// On le réactive (décorateurs legacy + emitDecoratorMetadata + import reflect-metadata).
		metadataProvider: ReflectMetadataProvider,
	},
} satisfies Config;

if (!envMikroORMConfig.development || Object.keys(envMikroORMConfig.development).length === 0)
	envMikroORMConfig.development = envMikroORMConfig.production;

export const mikroORMConfig = envMikroORMConfig as {
	production: (typeof envMikroORMConfig)["production"];
	development: (typeof envMikroORMConfig)["development"];
	test: (typeof envMikroORMConfig)["test"];
};
