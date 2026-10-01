// SPDX-License-Identifier: Apache-2.0
// No connection is opened: Bun.SQL connects lazily on the first query.
import { describe, expect, test } from "bun:test";
import {
	DEFAULT_SQL_POOL,
	autoTls,
	createSql,
	sqlOptions,
	transactionMode,
	withTransaction,
} from "../src/postgres";

const LOCAL = "postgres://u:p@127.0.0.1:1/aphrody_test";
const REMOTE = "postgres://u:p@db.example:5432/app";

describe("sqlOptions", () => {
	test("pool defaults", () => {
		expect(sqlOptions(LOCAL)).toEqual({ url: LOCAL, ...DEFAULT_SQL_POOL });
	});

	test("TLS auto: required off-loopback unless the URL chooses", () => {
		expect(sqlOptions(REMOTE).tls).toBe("require");
		expect(sqlOptions(LOCAL).tls).toBeUndefined();
		expect(sqlOptions("postgres://u@localhost/x?host=/run/postgresql").tls).toBeUndefined();
		expect(sqlOptions(`${REMOTE}?sslmode=disable`).tls).toBeUndefined();
		expect(autoTls("postgres://u@[::1]/x")).toBeUndefined();
	});

	test("TLS explicit and inherit", () => {
		expect(sqlOptions(LOCAL, { tls: "verify-full" }).tls).toBe("verify-full");
		expect(sqlOptions(REMOTE, { tls: false }).tls).toBe(false);
		expect("tls" in sqlOptions(REMOTE, { tls: "inherit" })).toBe(false);
	});

	test("prepare auto disables prepared statements behind a pooler", () => {
		expect(sqlOptions("postgres://u@h-pooler.region.aws.neon.tech/x").prepare).toBe(false);
		expect(sqlOptions("postgres://u@127.0.0.1:6432/x").prepare).toBe(false);
		expect("prepare" in sqlOptions(LOCAL)).toBe(false);
		expect(sqlOptions(LOCAL, { prepare: false }).prepare).toBe(false);
		expect("prepare" in sqlOptions("postgres://u@h:6432/x", { prepare: "inherit" })).toBe(false);
	});

	test("application_name and runtime parameters", () => {
		const opts = sqlOptions(LOCAL, {
			applicationName: "sql-test",
			connection: { search_path: "app,public" },
			max: 2,
		});
		expect(opts.connection).toEqual({ application_name: "sql-test", search_path: "app,public" });
		expect(opts.max).toBe(2);
		expect("connection" in sqlOptions(LOCAL)).toBe(false);
	});
});

describe("createSql", () => {
	test("passes the options to Bun.SQL without connecting", async () => {
		const sql = createSql(LOCAL, { applicationName: "sql-test", maxLifetime: 60 });
		const options = sql.options as unknown as { max: number; maxLifetime: number; query: string };
		expect(options.max).toBe(4);
		expect(options.maxLifetime).toBe(60_000);
		expect(options.query).toContain("sql-test");
		await sql.close();
	});
});

describe("transactions", () => {
	test("BEGIN mode string", () => {
		expect(transactionMode()).toBe("");
		expect(transactionMode({ isolation: "serializable", readOnly: true, deferrable: true })).toBe(
			"isolation level serializable read only deferrable"
		);
		expect(transactionMode({ readOnly: false })).toBe("read write");
	});

	test("withTransaction forwards mode, SET LOCAL and the result", async () => {
		const calls: string[] = [];
		const tx = {
			unsafe: async (text: string) => {
				calls.push(text);
				return [];
			},
		};
		const fake = {
			begin: async (...args: unknown[]) => {
				const fn = args[args.length - 1] as (t: unknown) => Promise<unknown>;
				if (args.length === 2) calls.push(`BEGIN ${String(args[0])}`);
				else calls.push("BEGIN");
				return fn(tx);
			},
		};
		const result = await withTransaction(fake as never, async () => 42, {
			readOnly: true,
			statementTimeoutMs: 1500,
			lockTimeoutMs: 100,
		});
		expect(result).toBe(42);
		expect(calls).toEqual([
			"BEGIN read only",
			"SET LOCAL statement_timeout = 1500",
			"SET LOCAL lock_timeout = 100",
		]);
		calls.length = 0;
		await withTransaction(fake as never, async () => null);
		expect(calls).toEqual(["BEGIN"]);
		await expect(
			withTransaction(fake as never, async () => 1, { statementTimeoutMs: 1.5 })
		).rejects.toThrow(RangeError);
	});
});
