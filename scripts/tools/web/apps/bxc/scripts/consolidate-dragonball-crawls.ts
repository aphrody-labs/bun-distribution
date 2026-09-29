#!/usr/bin/env bun
/** Build a non-destructive, deduplicated local read-model of Dragon Ball crawls. */
import { Database } from "bun:sqlite";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { exportDragonBallJsonl } from "../src/archive/dragonball-export.ts";

const home = homedir();
const crawlRoot = process.env.BXC_DRAGONBALL_CRAWLS_DIR ?? join(home, "bxc-crawls");
const outputDir = process.env.BXC_DRAGONBALL_CONSOLIDATED_DIR ?? join(crawlRoot, "dragonball-consolidated");
const outputDb = join(outputDir, "bxc.sqlite");

async function files(root: string, pattern: string): Promise<string[]> {
	const glob = new Bun.Glob(pattern);
	const found: string[] = [];
	for await (const path of glob.scan({ cwd: root, absolute: true, onlyFiles: true })) found.push(path);
	return found.sort();
}

function hasTable(database: Database, table: string): boolean {
	return Boolean(database.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
}

await mkdir(outputDir, { recursive: true });
if (await Bun.file(outputDb).exists()) throw new Error(`Refusing to overwrite existing consolidated database: ${outputDb}`);

const inputs = (await files(crawlRoot, "*/bxc.sqlite")).filter(
	(path) => !path.startsWith(`${outputDir}/`) && !/\/dragonball-consolidated(?:-|\/|$)/.test(path),
);
if (inputs.length === 0) throw new Error(`No BXC crawl databases found under ${crawlRoot}`);

const output = new Database(outputDb, { create: true });
output.exec(`
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
CREATE TABLE scrapes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL UNIQUE, profile TEXT NOT NULL, status INTEGER,
  content TEXT, metadata TEXT, markdown TEXT, json_data TEXT,
  openapi_spec TEXT, vector TEXT, timestamp DATETIME NOT NULL
);
CREATE INDEX idx_scrapes_timestamp ON scrapes(timestamp);
CREATE VIRTUAL TABLE scrapes_fts USING fts5(url, title, markdown);
`);
const upsert = output.prepare(`
INSERT INTO scrapes (url, profile, status, content, metadata, markdown, json_data, openapi_spec, vector, timestamp)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(url) DO UPDATE SET
  profile=excluded.profile, status=excluded.status, content=excluded.content,
  metadata=excluded.metadata, markdown=excluded.markdown, json_data=excluded.json_data,
  openapi_spec=excluded.openapi_spec, vector=excluded.vector, timestamp=excluded.timestamp
WHERE excluded.timestamp >= scrapes.timestamp`);

let rowsRead = 0;
for (const path of inputs) {
	const source = new Database(path, { readonly: true });
	if (!hasTable(source, "scrapes")) { source.close(); continue; }
	const rows = source.query<any, []>("SELECT url, profile, status, content, metadata, markdown, json_data, openapi_spec, vector, timestamp FROM scrapes").all();
	for (const row of rows) {
		if (typeof row.url !== "string" || row.url.length === 0) continue;
		let metadata: Record<string, unknown> = {};
		try { metadata = JSON.parse(row.metadata ?? "{}"); } catch {}
		metadata.crawlSource = path;
		upsert.run(
			row.url, row.profile ?? "unknown", row.status, row.content,
			JSON.stringify(metadata), row.markdown, row.json_data, row.openapi_spec,
			row.vector, row.timestamp ?? new Date(0).toISOString(),
		);
	}
	rowsRead += rows.length;
	source.close();
}
output.exec(`INSERT INTO scrapes_fts(rowid, url, title, markdown)
SELECT id, url, coalesce(json_extract(metadata, '$.title'), ''), coalesce(markdown, '') FROM scrapes;`);
const records = Number((output.query("SELECT count(*) AS count FROM scrapes").get() as { count: number }).count);
output.close();

const jsonl = join(outputDir, "shenron-documents.jsonl");
const exportedDocuments = await exportDragonBallJsonl(outputDb, jsonl);
const manifest = {
	schema: "bxc-dragonball-consolidated/v1",
	generatedAt: new Date().toISOString(),
	inputs,
	rowsRead,
	records,
	database: outputDb,
	jsonl,
	exportedDocuments,
};
await Bun.write(join(outputDir, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest));
