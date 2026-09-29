/**
 * Test setup — isolate DB et env.
 * Importer ce module **en premier**, avant toute classe du bot.
 */
import "reflect-metadata";
import { mkdirSync, unlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

Bun.env.NODE_ENV = "test";
Bun.env.DISCORD_TOKEN ??= "test-token";
Bun.env.DISCORD_TOKEN_BEERUS ??= "test-token";
Bun.env.DISCORD_TOKEN_WHIS ??= "test-token";
Bun.env.DISCORD_TOKEN_GRAND_PRETRE ??= "test-token";
Bun.env.DISCORD_TOKEN_ENMA ??= "test-token";
Bun.env.DISCORD_TOKEN_KAIO ??= "test-token";
Bun.env.GUILD_ID ??= "1497167233280118896";
Bun.env.OWNER_ID ??= "11111111111111111";
// Rôle de cachot : le re-cachot au rejoin est conditionné à cette variable.
// Sans elle, `JoinLeave.onJoin` ne réapplique rien — et le test correspondant
// échouait pour cette seule raison, en attendant un identifiant de repli que le
// code de production ne connaît pas. (En production, la variable EST définie.)
Bun.env.JAIL_ROLE_ID ??= "1405635615827034194";
Bun.env.DATABASE_PATH = join(tmpdir(), `shenron-bot-test-${process.pid}.db`);
Bun.env.LOG_LEVEL = "error"; // silence pino pendant les tests

const dbPath = Bun.env.DATABASE_PATH;
mkdirSync(tmpdir(), { recursive: true });
for (const ext of ["", "-journal", "-wal", "-shm"]) {
	const p = `${dbPath}${ext}`;
	if (existsSync(p)) unlinkSync(p);
}

// Applique les migrations sur la DB fraîche
const { drizzle } = await import("drizzle-orm/bun-sqlite");
const { migrate } = await import("drizzle-orm/bun-sqlite/migrator");
const { Database } = await import("bun:sqlite");
const sqlite = new Database(dbPath);
sqlite.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
const db = drizzle(sqlite);

// BXC 0.9.13 no longer ships the retired DragonBallCN CLI. Tests use the
// bridge's metadata-only fixture, never an ignored runtime crawl snapshot.
Bun.env.DRAGONBALLCN_SNAPSHOT_DIR = resolve(
	import.meta.dir,
	"../../../../packages/shenron/pipeline/test/bxc/fixtures/dragonballcn"
);
// The bot unit tier must not depend on an installed BXC binary (absent on CI
// runners). Route the bridge to the deterministic CLI fixture; the real binary
// is exercised by the @shenron/pipeline/bxc live tier (`test-all --live`).
Bun.env.BXC_BIN = resolve(
	import.meta.dir,
	"../../../../packages/shenron/pipeline/test/bxc/fixtures/bxc-frames-stats.mjs"
);
const migrationsFolder = join(import.meta.dir, "../src/db/migrations");
console.log("Migrations folder:", migrationsFolder);
migrate(db, { migrationsFolder });
for (const statement of [
	"ALTER TABLE users ADD COLUMN equipped_banner TEXT;",
	"ALTER TABLE users ADD COLUMN zeni_frozen INTEGER NOT NULL DEFAULT 0;",
	"ALTER TABLE level_rewards ADD COLUMN banner_url TEXT;",
]) {
	try {
		sqlite.exec(statement);
	} catch {
		// Existing migration already includes the compatibility column.
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
	);`);
sqlite.close();
