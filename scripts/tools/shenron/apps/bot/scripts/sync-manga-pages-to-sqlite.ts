#!/usr/bin/env bun
/**
 * sync-manga-pages-to-sqlite.ts — Synchronise bot.db_manga_pages (PostgreSQL)
 * vers la table db_manga_pages du réplica local SQLite (apps/bot/data/bot.db).
 */
import { Database } from "bun:sqlite";
import { join } from "node:path";
import postgres from "postgres";
import { urlBase } from "../../site/scripts/_databooks-base";

const BOT_ROOT = join(import.meta.dir, "..");
const SQLITE_PATH = process.env.BOT_DB ?? join(BOT_ROOT, "data", "bot.db");
const DRY = process.argv.includes("--dry-run");

const sqlite = new Database(SQLITE_PATH);
sqlite.exec("PRAGMA busy_timeout = 10000");

const url = await urlBase();
const sql = postgres(url, { max: 2, prepare: false, onnotice: () => {} });

try {
	console.log("Lecture de bot.db_manga_pages depuis PostgreSQL…");
	const pgRows = await sql<Record<string, unknown>[]>`
		SELECT id, series, tome, planche, lines, text, lang, has_ja, line_count, char_count
		FROM bot.db_manga_pages
		ORDER BY series, tome, planche
	`;

	const existingCount = (sqlite.query("SELECT count(*) as count FROM db_manga_pages").get() as { count: number }).count;
	console.log(`PostgreSQL: ${pgRows.length} planches | SQLite actuel: ${existingCount} planches`);

	if (pgRows.length === 0 && existingCount > 0) {
		throw new Error("Garde anti-truncate déclenchée : 0 ligne dans PostgreSQL alors que SQLite a des données !");
	}

	if (DRY) {
		console.log("Mode --dry-run : aucune écriture effectuée.");
		process.exit(0);
	}

	const sqliteCols = new Set((sqlite.query("PRAGMA table_info(db_manga_pages)").all() as { name: string }[]).map((c) => c.name));
	const targetCols = ["id", "series", "tome", "planche", "lines", "text", "lang", "has_ja", "line_count", "char_count"].filter(
		(col) => sqliteCols.has(col)
	);

	const placeholders = targetCols.map(() => "?").join(", ");
	const insertSql = `INSERT OR REPLACE INTO db_manga_pages (${targetCols.map((c) => `"${c}"`).join(", ")}) VALUES (${placeholders})`;

	console.log(`Synchronisation de ${pgRows.length} planches vers SQLite…`);

	sqlite.exec("BEGIN IMMEDIATE");
	try {
		const stmt = sqlite.prepare(insertSql);
		for (const row of pgRows) {
			const values = targetCols.map((col) => {
				const val = row[col];
				if (typeof val === "boolean") return val ? 1 : 0;
				if (typeof val === "bigint") return Number(val);
				return val ?? null;
			});
			stmt.run(...(values as (string | number | null)[]));
		}
		sqlite.exec("COMMIT");
	} catch (err) {
		sqlite.exec("ROLLBACK");
		throw err;
	}

	const finalCount = (sqlite.query("SELECT count(*) as count FROM db_manga_pages").get() as { count: number }).count;
	console.log(`✓ Synchronisation terminée avec succès : ${finalCount} planches dans SQLite.`);
} finally {
	await sql.end();
}
