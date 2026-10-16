import { createPostgresClient } from "@rosegriffon/db/postgres-client";
import { isDatabaseConfigured, isInagleDatabaseConfigured } from "@rosegriffon/db/pg";
import { createSqliteClient } from "./sqlite-client";

export type DatabaseClient = { from(table: string): any };
export type DatabaseClientFactory = () => DatabaseClient | Promise<DatabaseClient>;
let factory: DatabaseClientFactory | null = null;
export function setDatabaseProvider(next: DatabaseClientFactory | null): void {
  factory = next;
}
export function hasDatabaseProvider(): boolean {
  return factory !== null;
}
export async function createClient(): Promise<DatabaseClient> {
  if (factory) return await factory();
  if (isInagleDatabaseConfigured() || isDatabaseConfigured()) {
    return createPostgresClient();
  }
  return createSqliteClient() as unknown as DatabaseClient;
}
