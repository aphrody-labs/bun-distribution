import { Database } from "bun:sqlite";
import { join } from "node:path";

const CHANNEL_ID = "1547974508327997460";

const dbPath = join(import.meta.dir, "..", "data", "bot.db");
const db = new Database(dbPath);
db.run(
	`INSERT INTO guild_settings (key, value) VALUES ('channel.commands', ?)
	 ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
	[CHANNEL_ID]
);

const row = db.query("SELECT * FROM guild_settings WHERE key = 'channel.commands'").get();
console.log("✓ Setting channel.commands mis à jour :", row);
