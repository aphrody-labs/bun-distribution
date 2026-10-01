import { Elysia } from "elysia";
import { createAchilleaSql } from "@rosegriffon/db/achillea-sql";
import type { Database } from "@rosegriffon/db/schema";
import type { Kysely } from "kysely";

export const db = createAchilleaSql<Database>() as Kysely<Database>;

export const dbPlugin = new Elysia({ name: "db" })
	.decorate("db", db);
