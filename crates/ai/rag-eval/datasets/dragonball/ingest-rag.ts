#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

/**
 * Historical Bun reference for the old lexical `bxc corpus` ingestion contract.
 *
 * The operational ingester is now `aphrody rag ingest-shenron <jsonl> --db <store>` (Rust,
 * `crates/aphrody-rag/src/shenron.rs`), which also computes dense vectors when an
 * embedder is configured. This script writes the same schema (`docs`, `chunks`,
 * `chunks_fts` via the schema triggers) with the same document rules (path = URL,
 * single chunk up to 1200 characters, heading chunks above) so a crawl can be
 * ingested and evaluated (`aphrody-rag-eval --target local --db <store>`) without
 * building the `aphrody` binary. Runtime workflows now use the Rust CLI and do
 * not invoke this script; this remains a parity oracle for the former output.
 * Re-running is idempotent: unchanged documents
 * (same SHA-256 of their text) are skipped, changed ones are re-chunked.
 *
 * Usage: bun ingest-rag.ts --db <store.sqlite> <corpus.jsonl>...
 */

import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";

/** Document contract shared with `ShenronCorpusDoc` (Rust) and `CorpusDoc` (bxc). */
export interface CorpusDoc {
	id: string;
	name?: string | null;
	url: string;
	markdown?: string | null;
	lang?: string | null;
	entity?: string | null;
	kind?: string | null;
}

export interface Chunk {
	heading: string | null;
	text: string;
	startLine: number;
	endLine: number;
}

export interface IngestStats {
	totalDocsRead: number;
	docsIngested: number;
	unchanged: number;
	chunksCreated: number;
	skipped: number;
	errors: string[];
}

const SINGLE_CHUNK_MAX = 1200;
const TARGET_CHUNK_CHARS = 1500;
const MIN_CONTENT_LEN = 12;

/** Same statements as `aphrody_rag::schema::initialize_schema` (kept byte-compatible). */
const SCHEMA = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
CREATE TABLE IF NOT EXISTS docs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL UNIQUE,
    hash TEXT NOT NULL,
    title TEXT,
    language TEXT,
    mtime_ms INTEGER NOT NULL,
    size_bytes INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id INTEGER NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    heading TEXT,
    symbol TEXT,
    content TEXT NOT NULL,
    start_line INTEGER NOT NULL,
    end_line INTEGER NOT NULL,
    token_count INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(doc_id, chunk_index)
);
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
    content,
    heading,
    symbol,
    content=chunks,
    content_rowid=id,
    tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
    INSERT INTO chunks_fts(rowid, content, heading, symbol)
    VALUES (new.id, new.content, new.heading, new.symbol);
END;
CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
    INSERT INTO chunks_fts(chunks_fts, rowid, content, heading, symbol)
    VALUES ('delete', old.id, old.content, old.heading, old.symbol);
END;
CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
    INSERT INTO chunks_fts(chunks_fts, rowid, content, heading, symbol)
    VALUES ('delete', old.id, old.content, old.heading, old.symbol);
    INSERT INTO chunks_fts(rowid, content, heading, symbol)
    VALUES (new.id, new.content, new.heading, new.symbol);
END;
CREATE TABLE IF NOT EXISTS vectors (
    chunk_id INTEGER PRIMARY KEY REFERENCES chunks(id) ON DELETE CASCADE,
    model_id TEXT NOT NULL,
    dim INTEGER NOT NULL,
    quant TEXT NOT NULL DEFAULT 'f32',
    embedding BLOB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vectors_model_id ON vectors(model_id);
CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
`;

/**
 * Split Markdown into heading sections, then pack paragraphs up to
 * {@link TARGET_CHUNK_CHARS}. Line numbers are 1-based and inclusive.
 */
export function chunkMarkdown(text: string, title: string): Chunk[] {
	if (text.length <= SINGLE_CHUNK_MAX) return [{ heading: title, text, startLine: 1, endLine: 1 }];
	const lines = text.split("\n");
	const chunks: Chunk[] = [];
	let heading: string | null = title;
	let buf: string[] = [];
	let start = 1;
	const flush = (end: number) => {
		const body = buf.join("\n").trim();
		if (body) chunks.push({ heading, text: body, startLine: start, endLine: Math.max(start, end) });
		buf = [];
	};
	let size = 0;
	lines.forEach((line, i) => {
		const lineNo = i + 1;
		const h = /^#{1,6}\s+(.+?)\s*#*$/.exec(line);
		const paragraphEnd = line.trim() === "" && size >= TARGET_CHUNK_CHARS;
		const hardCap = size + line.length > TARGET_CHUNK_CHARS * 2;
		if (h || paragraphEnd || (hardCap && buf.length > 0)) {
			flush(lineNo - 1);
			size = 0;
			start = lineNo;
			if (h) heading = h[1] ?? title;
		}
		buf.push(line);
		size += line.length + 1;
	});
	flush(lines.length);
	return chunks;
}

export function openStore(path: string): Database {
	const db = new Database(path, { create: true });
	db.exec(SCHEMA);
	return db;
}

/** Ingest documents into an open store (one transaction per document). */
export function ingestDocs(db: Database, docs: Iterable<CorpusDoc>): IngestStats {
	const stats: IngestStats = {
		totalDocsRead: 0,
		docsIngested: 0,
		unchanged: 0,
		chunksCreated: 0,
		skipped: 0,
		errors: [],
	};
	const findDoc = db.query<{ id: number; hash: string }, [string]>("SELECT id, hash FROM docs WHERE path = ?");
	const upsertDoc = db.query<{ id: number }, [string, string, string, string, number]>(
		`INSERT INTO docs (path, hash, title, language, mtime_ms, size_bytes) VALUES (?1, ?2, ?3, ?4, 0, ?5)
		 ON CONFLICT(path) DO UPDATE SET hash = excluded.hash, title = excluded.title,
		   language = excluded.language, size_bytes = excluded.size_bytes, created_at = datetime('now')
		 RETURNING id`,
	);
	const clearChunks = db.query("DELETE FROM chunks WHERE doc_id = ?");
	const insertChunk = db.query(
		`INSERT INTO chunks (doc_id, chunk_index, heading, symbol, content, start_line, end_line, token_count)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
	);
	const one = db.transaction((doc: CorpusDoc, path: string, hash: string, text: string) => {
		const title = doc.name?.trim() || doc.id;
		const row = upsertDoc.get(path, hash, title, doc.lang || "fr", Buffer.byteLength(text));
		if (!row) throw new Error(`upsert returned no row for ${path}`);
		clearChunks.run(row.id);
		const chunks = chunkMarkdown(text, title);
		chunks.forEach((c, i) => {
			insertChunk.run(row.id, i, c.heading ?? title, doc.entity ?? null, c.text, c.startLine, c.endLine, Math.max(1, Math.floor(c.text.length / 4)));
		});
		return chunks.length;
	});
	const seen = new Set<string>();
	for (const doc of docs) {
		stats.totalDocsRead++;
		const text = (doc.markdown ?? "").trim();
		if (text.length < MIN_CONTENT_LEN) {
			stats.skipped++;
			continue;
		}
		let path = doc.url.trim() || `/corpus/${doc.id}`;
		if (seen.has(path)) path = `${path}#${doc.id}`;
		seen.add(path);
		const hash = createHash("sha256").update(text).digest("hex");
		if (findDoc.get(path)?.hash === hash) {
			stats.unchanged++;
			continue;
		}
		try {
			stats.chunksCreated += one(doc, path, hash, text);
			stats.docsIngested++;
		} catch (err) {
			stats.errors.push(`${doc.id}: ${err instanceof Error ? err.message : String(err)}`);
		}
	}
	return stats;
}

export function* readJsonl(text: string): Generator<CorpusDoc> {
	for (const line of text.split("\n")) {
		const t = line.trim();
		if (!t) continue;
		yield JSON.parse(t) as CorpusDoc;
	}
}

if (import.meta.main) {
	const args = Bun.argv.slice(2);
	const dbIndex = args.indexOf("--db");
	const dbPath = dbIndex >= 0 ? args[dbIndex + 1] : undefined;
	const inputs = args.filter((_, i) => i !== dbIndex && i !== dbIndex + 1);
	if (!dbPath || inputs.length === 0) {
		console.error("usage: bun ingest-rag.ts --db <store.sqlite> <corpus.jsonl>...");
		process.exit(2);
	}
	const db = openStore(dbPath);
	const total: Record<string, IngestStats> = {};
	for (const input of inputs) {
		// Sequential on purpose: one SQLite writer.
		// oxlint-disable-next-line no-await-in-loop
		total[input] = ingestDocs(db, readJsonl(await Bun.file(input).text()));
	}
	db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
	const counts = db.query<{ docs: number; chunks: number }, []>(
		"SELECT (SELECT COUNT(*) FROM docs) AS docs, (SELECT COUNT(*) FROM chunks) AS chunks",
	).get();
	db.close();
	console.log(JSON.stringify({ inputs: total, store: { path: dbPath, ...counts } }, null, 2));
	if (Object.values(total).some((s) => s.errors.length > 0)) process.exit(1);
}
