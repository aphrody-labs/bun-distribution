/**
 * ingest-manga-db.ts — Intègre les transcriptions OCR manga (.md) dans la DB
 * SQLite de façon durable et type-safe :
 *   - table Drizzle `db_manga_pages` (une ligne par planche, `lines` json + `text`),
 *   - index FTS5 `manga_pages_fts` (recherche plein-texte bilingue FR+JP, rowid =
 *     db_manga_pages.id pour le join).
 *
 * Source : assets/manga/transcripts/*.md (générés par scripts/transcribe-manga.py).
 * Idempotent : reconstruit intégralement (DELETE + INSERT). Le JP n'est PAS du bruit.
 *
 * Usage : bun apps/bot/scripts/ingest-manga-db.ts
 */
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { readdirSync, readFileSync } from "node:fs";
import * as schema from "../src/db/schema";
import { dbMangaPages, type NewDbMangaPage } from "../src/db/schema";

const ROOT = new URL("..", import.meta.url).pathname; // apps/bot/
const TDIR = `${ROOT}assets/manga/transcripts`;
const DBP = process.env.DATABASE_PATH ?? `${ROOT}data/bot.db`;

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

function seriesTome(file: string): { series: string; tome: string } {
	const base = file.replace(/\.md$/, "");
	const series = base.split("-")[0];
	const tome = base.split("-").slice(1).join("-");
	return { series, tome };
}

/** Nettoyage léger d'une bulle OCR : garde le JP (kanji/kana isolé = mot), drop le bruit pur. */
function cleanLine(l: string): string | null {
	const t = l
		.replace(/^[-*]\s*/, "")
		.replace(/\s+/g, " ")
		.trim();
	if (!t) return null;
	if (CJK.test(t)) return t;
	const alnum = (t.match(/[\p{L}\p{N}]/gu) || []).length;
	if (alnum < 2) return null;
	return t;
}

/** Langue dominante de la planche : "ja" si massivement CJK, sinon "fr". */
function detectLang(text: string): string {
	const cjk = (text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu) || []).length;
	const latin = (text.match(/[A-Za-zÀ-ÿ]/g) || []).length;
	return cjk > 8 && cjk >= latin ? "ja" : "fr";
}

const files = readdirSync(TDIR)
	.filter((f) => f.endsWith(".md"))
	.toSorted();

const rows: NewDbMangaPage[] = [];
for (const file of files) {
	const { series, tome } = seriesTome(file);
	const raw = readFileSync(`${TDIR}/${file}`, "utf-8");
	const parts = raw.split(/\n##\s+Planche\s+(\d+)\s*\n/);
	for (let i = 1; i < parts.length; i += 2) {
		const planche = Number(parts[i]);
		const body = parts[i + 1] ?? "";
		const lines = body
			.split("\n")
			.map(cleanLine)
			.filter((x): x is string => x !== null);
		if (!lines.length) continue;
		const text = lines.join(" ");
		rows.push({
			series,
			tome,
			planche,
			lines,
			text,
			lang: detectLang(text),
			hasJa: CJK.test(text),
			lineCount: lines.length,
			charCount: text.length,
		});
	}
}

const sqlite = new Database(DBP);
const db = drizzle(sqlite, { schema });

// Reconstruction idempotente de la table.
sqlite.run("DELETE FROM db_manga_pages");
const BATCH = 400;
const tx = sqlite.transaction(() => {
	for (let i = 0; i < rows.length; i += BATCH) {
		db.insert(dbMangaPages)
			.values(rows.slice(i, i + BATCH))
			.run();
	}
});
tx();

// Index FTS5 bilingue (rowid = db_manga_pages.id pour join).
sqlite.run("DROP TABLE IF EXISTS manga_pages_fts");
sqlite.run(
	`CREATE VIRTUAL TABLE manga_pages_fts USING fts5(
		text, series UNINDEXED, tome UNINDEXED, planche UNINDEXED, lang UNINDEXED,
		tokenize='unicode61 remove_diacritics 2'
	)`
);
const allRows = sqlite
	.query("SELECT id, series, tome, planche, text, lang FROM db_manga_pages")
	.all() as {
	id: number;
	series: string;
	tome: string;
	planche: number;
	text: string;
	lang: string;
}[];
const insFts = sqlite.query(
	"INSERT INTO manga_pages_fts(rowid, text, series, tome, planche, lang) VALUES (?,?,?,?,?,?)"
);
const txFts = sqlite.transaction(() => {
	for (const r of allRows) insFts.run(r.id, r.text, r.series, r.tome, r.planche, r.lang);
});
txFts();

const tomes = new Set(rows.map((r) => `${r.series}-${r.tome}`)).size;
const ja = rows.filter((r) => r.hasJa).length;
console.log(
	`✓ db_manga_pages : ${rows.length} planches (${tomes} tomes, ${ja} avec JP) + manga_pages_fts construit`
);
sqlite.close();
