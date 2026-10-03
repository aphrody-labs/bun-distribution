import "reflect-metadata";
import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";
import { getTableName } from "drizzle-orm";
import { users, levelRewards } from "../src/db/schema";

Bun.env.NODE_ENV = "test";
Bun.env.DISCORD_TOKEN ??= "test-token";
Bun.env.GUILD_ID ??= "1497167233280118896";
Bun.env.OWNER_ID ??= "11111111111111111";
Bun.env.JAIL_ROLE_ID ??= "1405635615827034194";
Bun.env.DATABASE_PATH = join(
	tmpdir(),
	`shenron-bot-training-${process.pid}-${Bun.main.slice(-24).replaceAll(/[^a-zA-Z0-9]/g, "_")}.db`
);
Bun.env.LOG_LEVEL = "error";

const dbPath = Bun.env.DATABASE_PATH;
for (const suffix of ["", "-journal", "-wal", "-shm"]) {
	const path = `${dbPath}${suffix}`;
	if (existsSync(path)) unlinkSync(path);
}
const sqlite = new Database(dbPath);
sqlite.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
const db = drizzle(sqlite);
migrate(db, { migrationsFolder: join(import.meta.dir, "../src/db/migrations") });
for (const [table, column, definition] of [
	[users, "equipped_banner", "TEXT"],
	[users, "zeni_frozen", "INTEGER NOT NULL DEFAULT 0"],
	[levelRewards, "banner_url", "TEXT"],
] as const) {
	const tableName = getTableName(table);
	const columns = sqlite.prepare(`PRAGMA table_info("${tableName}")`).all() as { name: string }[];
	if (!columns.some((columnInfo) => columnInfo.name === column)) {
		sqlite.exec(`ALTER TABLE "${tableName}" ADD COLUMN "${column}" ${definition}`);
	}
}
sqlite.exec(`CREATE TABLE IF NOT EXISTS economy_flags (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id TEXT NOT NULL,
	severity TEXT NOT NULL DEFAULT 'medium',
	code TEXT NOT NULL,
	reason TEXT NOT NULL,
	meta TEXT,
	status TEXT NOT NULL DEFAULT 'open',
	created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch() * 1000 AS INTEGER)),
	resolved_at INTEGER,
	resolved_by TEXT,
	resolve_note TEXT
)`);
sqlite.close();
