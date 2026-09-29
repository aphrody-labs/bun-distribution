declare module "@rosegriffon/db/postgres-client" {
	export function createPostgresClient(connectionString?: string): any;
}

declare module "@rosegriffon/db/achillea" {
	export const ACHILLEA_SCHEMA: "achillea";
	export function getAchilleaDatabaseUrl(): string;
}

declare module "@rosegriffon/db/achillea-sql" {
	export function createAchilleaSql<DB extends object = never>(
		options?: { url?: string; maxConnections?: number },
	): import("kysely").Kysely<DB>;
	export function destroyAchilleaSql(): Promise<void>;
}
