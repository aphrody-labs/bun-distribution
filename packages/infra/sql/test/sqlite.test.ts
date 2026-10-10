// SPDX-License-Identifier: Apache-2.0
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	SQLITE_BUSY_TIMEOUT_MS,
	closeSqlite,
	openSqlite,
	sqliteVecVersion,
	vacuumInto,
} from "../src/sqlite";

const dir = mkdtempSync(join(tmpdir(), "aphrody-sql-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function pragma(db: ReturnType<typeof openSqlite>, name: string): unknown {
	const row = db.query(`PRAGMA ${name}`).get() as Record<string, unknown> | null;
	return row ? Object.values(row)[0] : undefined;
}

describe("openSqlite", () => {
	test("file database gets WAL and the shared pragmas", () => {
		const db = openSqlite(join(dir, "a.db"));
		expect(pragma(db, "journal_mode")).toBe("wal");
		expect(pragma(db, "busy_timeout")).toBe(SQLITE_BUSY_TIMEOUT_MS);
		expect(pragma(db, "foreign_keys")).toBe(1);
		expect(pragma(db, "temp_store")).toBe(2);
		closeSqlite(db);
	});

	test("in-memory database keeps the memory journal", () => {
		const db = openSqlite(":memory:", { busyTimeoutMs: 100 });
		expect(pragma(db, "journal_mode")).toBe("memory");
		expect(pragma(db, "busy_timeout")).toBe(100);
		closeSqlite(db);
	});

	test("foreign keys are enforced", () => {
		const db = openSqlite(":memory:");
		db.run("CREATE TABLE p (id INTEGER PRIMARY KEY)");
		db.run("CREATE TABLE c (p INTEGER REFERENCES p(id))");
		expect(() => db.run("INSERT INTO c VALUES (1)")).toThrow();
		db.close();
	});

	test("read-only open refuses writes", () => {
		const path = join(dir, "ro.db");
		const rw = openSqlite(path);
		rw.run("CREATE TABLE t (x)");
		closeSqlite(rw);
		const ro = openSqlite(path, { readonly: true });
		expect(pragma(ro, "foreign_keys")).toBe(1);
		expect(() => ro.run("INSERT INTO t VALUES (1)")).toThrow();
		closeSqlite(ro);
	});

	test("invalid busy timeout is rejected", () => {
		expect(() => openSqlite(":memory:", { busyTimeoutMs: -1 })).toThrow(RangeError);
	});

	test("missing file without create fails", () => {
		expect(() => openSqlite(join(dir, "absent.db"), { create: false })).toThrow();
	});
});

describe("sqlite-vec", () => {
	test("vec0 loads and answers a KNN query", () => {
		const db = openSqlite(":memory:", { vec: true });
		expect(sqliteVecVersion(db)).toMatch(/^v0\.1\.(9|\d{2,})/);
		db.run("CREATE VIRTUAL TABLE v USING vec0(embedding float[2])");
		const insert = db.prepare("INSERT INTO v(rowid, embedding) VALUES (?, ?)");
		insert.run(1, new Float32Array([0, 1]));
		insert.run(2, new Float32Array([1, 0]));
		const row = db
			.query("SELECT rowid FROM v WHERE embedding MATCH ? AND k = 1")
			.get(new Float32Array([0.9, 0.1])) as { rowid: number };
		expect(row.rowid).toBe(2);
		closeSqlite(db);
	});

	test("version is null without the extension", () => {
		const db = openSqlite(":memory:");
		expect(sqliteVecVersion(db)).toBeNull();
		db.close();
	});
});

describe("vacuumInto", () => {
	test("writes a consistent copy", () => {
		const db = openSqlite(join(dir, "src.db"));
		db.run("CREATE TABLE t (x TEXT)");
		db.run("INSERT INTO t VALUES ('a'), ('b')");
		const target = join(dir, "copy.db");
		vacuumInto(db, target);
		expect(existsSync(target)).toBe(true);
		expect(() => vacuumInto(db, target)).toThrow();
		closeSqlite(db);
		const copy = openSqlite(target, { readonly: true });
		expect(copy.query("SELECT count(*) AS n FROM t").get()).toEqual({ n: 2 });
		copy.close();
	});
});
