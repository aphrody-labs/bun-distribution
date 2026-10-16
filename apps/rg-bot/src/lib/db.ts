/** Unique PostgreSQL SQL connection for the bot runtime. */
import { createBunSql, createInagleBunSql } from "@rosegriffon/db/bun-sql";

export const sql = createBunSql();
export const inagleSql = createInagleBunSql();
