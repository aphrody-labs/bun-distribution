import { Database } from "bun:sqlite";

const db = new Database(process.env.BXC_SMOKE_DB_PATH ?? "/srv/aphrody/shared/bxc/bxc.sqlite", { readonly: true });
const count = (sql: string, ...args: unknown[]) => (db.query(sql).get(...args) as { count: number }).count;
const official = db.query("SELECT length(markdown) AS markdownChars, length(content) AS contentChars FROM scrapes WHERE url = ? ORDER BY id DESC LIMIT 1").get("https://dragon-ball-official.com/") as { markdownChars: number; contentChars: number } | null;
console.log(JSON.stringify({
	scrapes: count("SELECT count(*) AS count FROM scrapes"),
	chunks: count("SELECT count(*) AS count FROM chunks"),
	officialScrapes: count("SELECT count(*) AS count FROM scrapes WHERE url = ?", "https://dragon-ball-official.com/"),
	officialChunks: count("SELECT count(*) AS count FROM chunks WHERE url = ?", "https://dragon-ball-official.com/"),
	markdownChars: official?.markdownChars ?? 0,
	contentChars: official?.contentChars ?? 0,
}));
db.close();
