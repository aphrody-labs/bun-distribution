/**
 * export-data.ts — Exporte TOUTE la data du bot (tables db_* + métier) en gros
 * JSON par table + un index. Sert de dump portable / source pour le RAG / debug.
 *
 * Sortie : apps/bot/data/export/<table>.json + index.json
 * Usage : bun apps/bot/scripts/export-data.ts
 */
import { Database } from "bun:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";

const DB = new URL("../data/bot.db", import.meta.url).pathname;
const OUT = new URL("../data/export/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const db = new Database(DB, { readonly: true });

const SKIP = new Set([
	"__drizzle_migrations",
	"db_search",
	"db_search_idx",
	"db_search_docsize",
	"db_search_content",
	"db_search_data",
	"db_search_config",
	"ba_user",
	"ba_session",
	"ba_account",
	"ba_verification",
]);

const tables = (
	db
		.query(
			`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
		)
		.all() as { name: string }[]
)
	.map((r) => r.name)
	// Les tables shadow de `vec_chunks` (extension sqlite-vec) ne se lisent pas
	// sans charger le module vec0 : les exporter faisait planter tout le dump.
	.filter((n) => !SKIP.has(n) && !n.startsWith("vec_chunks"));

const index: { table: string; rows: number; bytes: number }[] = [];

for (const t of tables) {
	const rows = db.query(`SELECT * FROM "${t}"`).all();
	const json = JSON.stringify(rows);
	writeFileSync(`${OUT}${t}.json`, json);
	index.push({ table: t, rows: rows.length, bytes: json.length });
	console.log(`✓ ${t}: ${rows.length} lignes (${(json.length / 1024).toFixed(0)} KB)`);
}

writeFileSync(
	`${OUT}index.json`,
	JSON.stringify({ generatedAt: new Date().toISOString(), tables: index }, null, 2)
);
const totalRows = index.reduce((s, r) => s + r.rows, 0);
console.log(`\n${tables.length} tables, ${totalRows} lignes → ${OUT}`);
db.close();
