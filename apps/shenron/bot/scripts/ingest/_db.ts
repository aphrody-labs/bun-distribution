import "../../src/db/wiki-write-guard"; // refuse l'écriture wiki SQLite sauf override
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";
import * as schema from "../../src/db/schema";

const path = Bun.env.DATABASE_PATH ?? "./data/bot.db";
const sqlite = new Database(path);
sqlite.exec("PRAGMA foreign_keys = ON");
export const db = drizzle(sqlite, { schema });
export { sqlite };
