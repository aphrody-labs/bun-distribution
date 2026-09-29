#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * recoit-ocr-results.ts — Atomic, verified reception of the OCR corpus `results.db` on the VPS.
 *
 * Why: on 2026-09-14 the Windows GPU host shipped its corpus with
 * `ssh dbfr "cat > ~/.aphrody/ocr/results.db"`. `cat >` truncates the live file first and
 * rewrites it in place, so any reader (nourrir-shenron.ts) or a dropped connection sees a
 * half-written B-tree: "Tree 4 page 9823 cell 0: invalid page number 10386".
 *
 * Protocol (never touches the live file until the new one is proven good):
 *   1. receive into `<target>.incoming.<pid>` (same directory => same filesystem);
 *   2. fsync, check SQLite header + PRAGMA integrity_check + required tables;
 *   3. refuse a corpus with fewer pages than the current one (unless --force);
 *   4. hard-link the current file to `<target>.prev` (instant rollback), then rename() over.
 *   Readers that already had the old file open keep their inode and finish cleanly.
 *
 * Sender side (Windows GPU host) — take a consistent snapshot, never copy a live DB:
 *   sqlite3 <ocr-workspace>/results.db "VACUUM INTO '<ocr-workspace>/results.snapshot.db'"
 *   # binary-safe (Git Bash / cmd, NOT Windows PowerShell 5 which mangles `<` binary pipes):
 *   ssh dbfr "cd shenron && bun scripts/ops/recoit-ocr-results.ts" < <ocr-workspace>/results.snapshot.db
 *   # or, from PowerShell: upload beside the target, then hand it over
 *   scp <ocr-workspace>/results.snapshot.db dbfr:.aphrody/ocr/results.db.upload
 *   ssh dbfr "cd shenron && bun scripts/ops/recoit-ocr-results.ts --depuis ~/.aphrody/ocr/results.db.upload"
 *
 * Options:
 *   --depuis <file>   take an already uploaded file instead of stdin (it is moved, not copied)
 *   --cible <file>    target database (default: $OCR_RESULTS_DB or ~/.aphrody/ocr/results.db)
 *   --force           accept a corpus with fewer pages than the current one
 *   --verifier        only inspect the target (read-only) and exit 0 when healthy
 *
 * Exit codes: 0 swapped / healthy, 2 usage, 3 invalid incoming, 4 regression refused, 5 busy/lock.
 * Output: one JSON line on stdout (machine) + human lines on stderr.
 */
import { closeSync, existsSync, fsyncSync, linkSync, openSync, readdirSync, readlinkSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { inspectOcrResults, resolveOcrResultsPath, type OcrResultsReport } from "./_ocr-results-db";

const args = process.argv.slice(2);

function option(name: string): string | undefined {
	const i = args.indexOf(name);
	if (i === -1) return undefined;
	const value = args[i + 1];
	if (!value || value.startsWith("--")) fail(2, `option ${name} needs a value`);
	return value;
}

function expandHome(p: string): string {
	return p === "~" || p.startsWith("~/") ? homedir() + p.slice(1) : p;
}

function log(message: string): void {
	process.stderr.write(`[recoit-ocr-results] ${message}\n`);
}

function emit(result: Record<string, unknown>): void {
	process.stdout.write(`${JSON.stringify(result)}\n`);
}

function fail(code: number, message: string, extra: Record<string, unknown> = {}): never {
	log(`ECHEC: ${message}`);
	emit({ ok: false, code, error: message, ...extra });
	process.exit(code);
}

function fsyncPath(path: string, flags: "r" | "r+" = "r"): void {
	const fd = openSync(path, flags);
	try {
		fsyncSync(fd);
	} finally {
		closeSync(fd);
	}
}

/** PIDs holding one of `paths` open (Linux /proc scan; unreadable processes are skipped). */
function holders(paths: string[]): number[] {
	const wanted = new Set(paths.map((p) => resolve(p)));
	const found = new Set<number>();
	let pids: string[] = [];
	try {
		pids = readdirSync("/proc").filter((d) => /^\d+$/.test(d));
	} catch {
		return [];
	}
	for (const pid of pids) {
		if (Number(pid) === process.pid) continue;
		let fds: string[] = [];
		try {
			fds = readdirSync(`/proc/${pid}/fd`);
		} catch {
			continue;
		}
		for (const fd of fds) {
			try {
				const target = readlinkSync(`/proc/${pid}/fd/${fd}`).replace(/ \(deleted\)$/, "");
				if (wanted.has(target)) {
					found.add(Number(pid));
					break;
				}
			} catch {
				// fd closed meanwhile
			}
		}
	}
	return [...found];
}

function summary(r: OcrResultsReport) {
	return { bytes: r.bytes, pages: r.pages, blocks: r.blocks, byStatus: r.byStatus, check: r.messages.slice(0, 5) };
}

const target = resolve(expandHome(option("--cible") ?? resolveOcrResultsPath()));
const force = args.includes("--force");

if (args.includes("--verifier")) {
	const report = inspectOcrResults(target, "integrity");
	log(`${target}: ${report.ok ? "OK" : "CORROMPU"} — ${report.pages ?? "?"} pages, ${report.blocks ?? "?"} blocs`);
	emit({ ok: report.ok, target, ...summary(report) });
	process.exit(report.ok ? 0 : 3);
}

const dir = dirname(target);
const incoming = `${target}.incoming.${process.pid}`;
const lockPath = `${target}.recv.lock`;
let lockFd: number | null = null;

function cleanup(): void {
	// Inspecting a WAL-mode candidate may leave -wal/-shm next to it: remove them with it.
	for (const suffix of ["", "-wal", "-shm", "-journal"]) {
		if (existsSync(incoming + suffix)) {
			try {
				unlinkSync(incoming + suffix);
			} catch {}
		}
	}
	if (lockFd !== null) {
		try {
			closeSync(lockFd);
			unlinkSync(lockPath);
		} catch {}
		lockFd = null;
	}
}
process.on("exit", cleanup);
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
	process.on(sig, () => {
		cleanup();
		process.exit(130);
	});
}

// 0. Single receiver at a time (stale lock = owner PID gone).
try {
	lockFd = openSync(lockPath, "wx");
} catch {
	const owner = Number((await Bun.file(lockPath).text().catch(() => "")).trim());
	let alive = false;
	if (owner > 0) {
		try {
			process.kill(owner, 0);
			alive = true;
		} catch {}
	}
	if (alive) fail(5, `another reception is running (pid ${owner}, lock ${basename(lockPath)})`);
	unlinkSync(lockPath);
	lockFd = openSync(lockPath, "wx");
}
writeSync(lockFd, `${process.pid}\n`);

// 1. Receive next to the target.
const source = option("--depuis");
if (source) {
	const src = resolve(expandHome(source));
	if (!existsSync(src)) fail(2, `--depuis: ${src} not found`);
	if (dirname(src) !== dir) fail(2, `--depuis must live in ${dir} so the final rename stays atomic`);
	renameSync(src, incoming);
	log(`fichier repris : ${basename(src)} -> ${basename(incoming)}`);
} else {
	if (process.stdin.isTTY) fail(2, "nothing on stdin (pipe the database, or use --depuis <file>)");
	const bytes = await Bun.write(incoming, Bun.stdin);
	log(`reçu sur stdin : ${bytes} octets -> ${basename(incoming)}`);
}
fsyncPath(incoming);

// 2. Validate the incoming corpus (full integrity_check: the file is private, time is not critical).
const fresh = inspectOcrResults(incoming, "integrity");
if (!fresh.ok) {
	fail(3, `incoming corpus rejected: ${fresh.messages.slice(0, 3).join(" | ")}`, { target, incoming: summary(fresh) });
}
if (fresh.journalMode === "wal") {
	// A WAL-mode file shipped alone is only consistent if it was checkpointed (VACUUM INTO is);
	// switch it to rollback mode so a read-only opener never needs a -shm next to it.
	const { Database } = await import("bun:sqlite");
	const db = new Database(incoming);
	db.exec("PRAGMA journal_mode = DELETE");
	db.close();
	fsyncPath(incoming);
}

// 3. Compare with the current corpus.
const current = existsSync(target) ? inspectOcrResults(target, "quick") : null;
if (current?.ok && (fresh.pages ?? 0) < (current.pages ?? 0) && !force) {
	fail(4, `regression refused: ${fresh.pages} pages incoming < ${current.pages} current (use --force)`, {
		target,
		incoming: summary(fresh),
		current: summary(current),
	});
}

// 4. Keep the previous file as an instant rollback. Its -wal/-journal/-shm belong to the OLD inode:
//    SQLite would replay a stale -wal or hot -journal into the new file, so they move with it
//    (`results.db-wal` -> `results.db.prev-wal`, the name SQLite looks for next to `.prev`).
//    Processes still reading the old file keep their descriptors on both and finish cleanly.
const prev = `${target}.prev`;
for (const suffix of ["", "-journal", "-wal", "-shm"]) {
	if (existsSync(prev + suffix)) unlinkSync(prev + suffix);
}
if (existsSync(target)) linkSync(target, prev);
const sidecars = ["-journal", "-wal", "-shm"].filter((s) => existsSync(target + s));
const oldReaders = holders([target, ...sidecars.map((s) => target + s)]);

// 5. Swap atomically: sidecars aside first, then the database itself (same directory => rename(2)).
for (const s of sidecars) renameSync(target + s, prev + s);
if (sidecars.length > 0) log(`annexes de l'ancien fichier déplacées vers ${basename(prev)}{${sidecars.join(",")}}`);
renameSync(incoming, target);
fsyncPath(dir);

const readers = oldReaders;
log(
	`OK : ${current?.pages ?? 0} -> ${fresh.pages} pages, ${current?.blocks ?? 0} -> ${fresh.blocks} blocs` +
		(current && !current.ok ? " (l'ancien fichier était corrompu)" : "") +
		(readers.length > 0 ? ` ; lecteurs encore sur l'ancien inode : ${readers.join(", ")}` : ""),
);
emit({
	ok: true,
	code: 0,
	target,
	previous: current ? { ok: current.ok, ...summary(current) } : null,
	installed: summary(fresh),
	rollback: existsSync(prev) ? prev : null,
});
