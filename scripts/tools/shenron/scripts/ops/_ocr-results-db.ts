// SPDX-License-Identifier: Apache-2.0
/**
 * _ocr-results-db.ts — Read-side guard for the Aphrody OCR corpus (`~/.aphrody/ocr/results.db`).
 *
 * The corpus is produced on the Windows GPU host (PP-OCRv5) and shipped to the VPS.
 * On 2026-09-14 a raw `ssh dbfr "cat > results.db"` truncated the live file while it was
 * being read: every reader must therefore open it read-only AND check it before use.
 *
 *   import { openOcrResultsReadonly } from "./_ocr-results-db";
 *   const db = openOcrResultsReadonly(); // throws OcrResultsCorruptError when unusable
 *
 * Writers must never stream over the live file: use `scripts/ops/recoit-ocr-results.ts`.
 */
import { Database } from "bun:sqlite";
import { existsSync, openSync, readSync, closeSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type SqliteCheckMode = "quick" | "integrity" | "none";

export interface OcrResultsReport {
	path: string;
	ok: boolean;
	bytes: number;
	/** First messages returned by quick_check / integrity_check (["ok"] when healthy). */
	messages: string[];
	pages: number | null;
	blocks: number | null;
	byStatus: Record<string, number>;
	journalMode: string | null;
}

export class OcrResultsCorruptError extends Error {
	constructor(
		message: string,
		readonly report: OcrResultsReport,
	) {
		super(message);
		this.name = "OcrResultsCorruptError";
	}
}

const SQLITE_MAGIC = "SQLite format 3\u0000";
const REQUIRED_TABLES = ["ocr_pages", "ocr_blocks"] as const;

/** Default corpus location: `$OCR_RESULTS_DB`, else `~/.aphrody/ocr/results.db`. */
export function resolveOcrResultsPath(): string {
	return process.env.OCR_RESULTS_DB || join(homedir(), ".aphrody", "ocr", "results.db");
}

/** True when the first 16 bytes carry the SQLite 3 magic header. */
export function hasSqliteHeader(path: string): boolean {
	const fd = openSync(path, "r");
	try {
		const buf = Buffer.alloc(16);
		const n = readSync(fd, buf, 0, 16, 0);
		return n === 16 && buf.toString("latin1") === SQLITE_MAGIC;
	} finally {
		closeSync(fd);
	}
}

/**
 * Inspects a results.db candidate without ever writing to it.
 * Never throws for a damaged file: `ok` is false and `messages` explains why.
 */
export function inspectOcrResults(path: string, mode: SqliteCheckMode = "quick"): OcrResultsReport {
	const report: OcrResultsReport = {
		path,
		ok: false,
		bytes: 0,
		messages: [],
		pages: null,
		blocks: null,
		byStatus: {},
		journalMode: null,
	};
	if (!existsSync(path)) {
		report.messages.push("file not found");
		return report;
	}
	report.bytes = statSync(path).size;
	if (report.bytes < 512 || !hasSqliteHeader(path)) {
		report.messages.push("not a SQLite 3 file (bad header or truncated)");
		return report;
	}
	let db: Database | null = null;
	try {
		db = new Database(path, { readonly: true });
		report.journalMode = db.query<{ journal_mode: string }, []>("PRAGMA journal_mode").get()?.journal_mode ?? null;
		if (mode !== "none") {
			const pragma = mode === "integrity" ? "PRAGMA integrity_check(20)" : "PRAGMA quick_check(20)";
			const rows = db.query<Record<string, string>, []>(pragma).all();
			report.messages = rows.map((r) => String(Object.values(r)[0]));
			if (report.messages.length !== 1 || report.messages[0] !== "ok") return report;
		}
		const tables = new Set(
			db
				.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'")
				.all()
				.map((r) => r.name),
		);
		const missing = REQUIRED_TABLES.filter((t) => !tables.has(t));
		if (missing.length > 0) {
			report.messages = [`missing tables: ${missing.join(", ")}`];
			return report;
		}
		report.pages = db.query<{ c: number }, []>("SELECT count(*) AS c FROM ocr_pages").get()?.c ?? 0;
		report.blocks = db.query<{ c: number }, []>("SELECT count(*) AS c FROM ocr_blocks").get()?.c ?? 0;
		for (const r of db
			.query<{ status: string; c: number }, []>("SELECT status, count(*) AS c FROM ocr_pages GROUP BY status")
			.all()) {
			report.byStatus[r.status] = r.c;
		}
		if (mode === "none") report.messages = ["unchecked"];
		report.ok = true;
		return report;
	} catch (error) {
		report.ok = false;
		report.messages.push(error instanceof Error ? error.message : String(error));
		return report;
	} finally {
		db?.close();
	}
}

/**
 * Opens the corpus read-only after a structural check. Throws `OcrResultsCorruptError`
 * instead of handing back a database that would fail (or lie) halfway through a scan.
 */
export function openOcrResultsReadonly(
	path: string = resolveOcrResultsPath(),
	mode: SqliteCheckMode = "quick",
): Database {
	const report = inspectOcrResults(path, mode);
	if (!report.ok) {
		throw new OcrResultsCorruptError(`results.db unusable (${path}): ${report.messages.slice(0, 3).join(" | ")}`, report);
	}
	return new Database(path, { readonly: true });
}
