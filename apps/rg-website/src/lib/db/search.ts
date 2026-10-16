import { getInaglePgPool, getPgPool } from "@rosegriffon/db/pg";
import type { ExecuteursSql } from "@rosegriffon/search";

export const searchExecutors: ExecuteursSql = {
  rg: async (text, parameters) => (await getPgPool().query(text, parameters)).rows,
  inagle: async (text, parameters) => (await getInaglePgPool().query(text, parameters)).rows,
};
