import { Kysely } from "kysely";
import { createInaglePgDialect } from "./pg";

export { sql } from "kysely";
export type { Insertable } from "kysely";

let database: Kysely<never> | undefined;

/** Typed queries stay on the gameplay store, with connection deferred until execution. */
export function createInagleSql<DB extends object = never>(): Kysely<DB> {
  database ??= new Kysely<never>({ dialect: createInaglePgDialect({ searchPath: "public" }) });
  return database as unknown as Kysely<DB>;
}

export async function destroyInagleSql(): Promise<void> {
  const previous = database;
  database = undefined;
  await previous?.destroy();
}
