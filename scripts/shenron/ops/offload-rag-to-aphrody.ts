// SPDX-License-Identifier: Apache-2.0
/** Idempotently copy Shenron's existing RAG chunks into Aphrody's private corpus. */
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { AphrodyComputeClient } from "@shenron/pipeline/aphrody";

interface Chunk {
	rowid: number;
	title: string;
	url: string;
	content: string;
	kind: string;
	lang: string | null;
	source_id: string | null;
	entity: string | null;
}

function sourceUrl(row: Chunk): string {
	const raw = row.url?.trim();
	if (!raw) throw new Error(`RAG row ${row.rowid} has no source URL`);
	const url = raw.startsWith("/") ? new URL(raw, "https://dragonballfr.com") : new URL(raw);
	if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`RAG row ${row.rowid} has an unsupported source URL`);
	return url.href;
}

function validate(row: Chunk): string {
	if (!row.title?.trim() || !row.content?.trim()) throw new Error(`RAG row ${row.rowid} has no title or content`);
	const url = sourceUrl(row);
	if (Buffer.byteLength(row.title) > 1024 || Buffer.byteLength(row.content) > 512 * 1024 || Buffer.byteLength(url) > 2048 ||
		!row.kind?.trim() || Buffer.byteLength(row.kind) > 64 ||
		(row.lang !== null && Buffer.byteLength(row.lang) > 32) ||
		(row.source_id !== null && Buffer.byteLength(row.source_id) > 256) ||
		(row.entity !== null && Buffer.byteLength(row.entity) > 256)) {
		throw new Error(`RAG row ${row.rowid} exceeds the Aphrody ingestion contract`);
	}
	return url;
}

function argument(name: string): string | undefined {
	const index = process.argv.indexOf(name);
	return index >= 0 ? process.argv[index + 1] : undefined;
}

const path = argument("--db");
if (!path) throw new Error("Usage: bun scripts/ops/offload-rag-to-aphrody.ts --db <sqlite> [--apply | --pg-csv <output>] [--limit N]");
const dbPath = resolve(path);
if (!existsSync(dbPath)) throw new Error("RAG SQLite database does not exist");
const rawLimit = argument("--limit");
const limit = rawLimit === undefined ? Number.MAX_SAFE_INTEGER : Number(rawLimit);
if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("--limit must be a positive integer");
const apply = process.argv.includes("--apply");
const csvOutput = argument("--pg-csv");
if (apply && csvOutput) throw new Error("--apply and --pg-csv are mutually exclusive");
const db = new Database(dbPath, { readonly: true });

try {
	const total = (db.query("SELECT count(*) AS count FROM rag_chunks").get() as { count: number }).count;
	const target = Math.min(total, limit);
	const select = db.query<Chunk, [number, number]>(
		"SELECT rowid, title, url, content, kind, lang, source_id, entity FROM rag_chunks WHERE rowid > ? ORDER BY rowid LIMIT ?",
	);
	let previewCursor = 0;
	let valid = 0;
	while (valid < target) {
		const rows = select.all(previewCursor, Math.min(500, target - valid));
		if (rows.length === 0) break;
		for (const row of rows) { validate(row); valid++; previewCursor = row.rowid; }
	}
	if (valid !== target) throw new Error(`RAG preview incomplete: ${valid}/${target}`);
	if (csvOutput) {
		const output = resolve(csvOutput);
		if (existsSync(output)) throw new Error("PostgreSQL CSV target already exists");
		const writer = Bun.file(output).writer({ highWaterMark: 1024 * 1024 });
		const digest = createHash("sha256");
		const write = (line: string) => { writer.write(line); digest.update(line); };
		const csv = (value: string) => `"${value.replaceAll('"', '""')}"`;
		write("corpus,entity_id,title,url,content,metadata\n");
		let cursor = 0;
		let exported = 0;
		while (exported < target) {
			const rows = select.all(cursor, Math.min(500, target - exported));
			if (rows.length === 0) break;
			for (const row of rows) {
				const metadata = {
					kind: row.kind,
					...(row.lang ? { lang: row.lang } : {}),
					...(row.source_id ? { originSourceId: row.source_id } : {}),
					...(row.entity ? { entity: row.entity } : {}),
				};
				write(["shenron", `shenron:${row.rowid}`, row.title, validate(row), row.content, JSON.stringify(metadata)].map(csv).join(",") + "\n");
				exported++;
				cursor = row.rowid;
			}
		}
		await writer.end();
		if (exported !== target) throw new Error(`PostgreSQL CSV export incomplete: ${exported}/${target}`);
		console.log(JSON.stringify({ status: "exported", output, exported, target, sha256: digest.digest("hex") }));
	} else if (!apply) {
		console.log(JSON.stringify({ status: "planned", db: dbPath, total, target, validated: valid, writes: 0 }));
	} else {
		const client = new AphrodyComputeClient();
		const health = await client.health();
		if (!health.rag) throw new Error("Aphrody RAG ingestion is unavailable");
		let cursor = 0;
		let indexed = 0;
		while (indexed < target) {
			const rows = select.all(cursor, Math.min(50, target - indexed));
			if (rows.length === 0) break;
			for (const row of rows) {
				const url = validate(row);
				await client.ragIngest({
					sourceId: `shenron:${row.rowid}`,
					title: row.title,
					url,
					content: row.content,
					kind: row.kind,
					...(row.lang ? { lang: row.lang } : {}),
					...(row.source_id ? { originSourceId: row.source_id } : {}),
					...(row.entity ? { entity: row.entity } : {}),
				});
				indexed++;
				cursor = row.rowid;
			}
			console.log(JSON.stringify({ status: "working", indexed, target, lastRowid: cursor }));
		}
		if (indexed !== target) throw new Error(`RAG export incomplete: ${indexed}/${target}`);
		console.log(JSON.stringify({ status: "complete", indexed, target, lastRowid: cursor }));
	}
} finally {
	db.close();
}
