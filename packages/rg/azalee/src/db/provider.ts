import { createPostgresClient } from "@rosegriffon/db/postgres-client";

export type DatabaseClient = { from(table: string): any };
export type DatabaseClientFactory = () => DatabaseClient | Promise<DatabaseClient>;
let factory: DatabaseClientFactory | null = null;
export function setDatabaseProvider(next: DatabaseClientFactory | null): void { factory = next; }
export function hasDatabaseProvider(): boolean { return factory !== null; }
export async function createClient(): Promise<DatabaseClient> {
	if (factory) return await factory();
	const connectionString = process.env.DATABASE_URL ?? process.env.ROSE_GRIFFON_DATABASE_URL ?? process.env.RG_DATABASE_URL;
	return createPostgresClient(connectionString);
}
