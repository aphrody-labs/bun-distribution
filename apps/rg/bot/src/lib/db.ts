/** Unique PostgreSQL SQL connection for the bot runtime. */
import { createBunSql } from "@rosegriffon/db/bun-sql";

export const sql = createBunSql();
