// Source: packages/shenron/db/test/drivers.test.ts at 8172f535ce (preserved Git history).
// SPDX-License-Identifier: Apache-2.0
// No connection is opened: postgres-js and Bun.SQL connect lazily.
import { describe, expect, test } from "bun:test";
import * as bunAlias from "../src/bun";
import * as bunSql from "../src/bun-sql";
import { bunSqlOptions, createBunDb, createBunSql } from "../src/bun-sql";
import { POOL_MAX_CEILING } from "../src/config";
import * as root from "../src/index";
import { createDb } from "../src/postgres-js";
import { createSql, resolvePgClientOptions } from "../src/sql";

const URL_TEST = "postgres://user:pass@127.0.0.1:1/shenron_test";
const OIDS = [114, 3802, 1184] as const;

describe("postgres-js drivers", () => {
  test("createSql keeps the postgres-js default serializers", () => {
    const sql = createSql({ url: URL_TEST, applicationName: "drivers-test" });
    for (const oid of OIDS) {
      const serialize = sql.options.serializers[oid];
      expect(typeof serialize).toBe("function");
      const probe = oid === 1184 ? new Date(0) : { a: 1 };
      expect(serialize?.(probe)).not.toBe(probe);
    }
    expect(sql.options.serializers[114]?.({ a: 1 })).toBe('{"a":1}');
    expect(sql.options.serializers[1184]?.(new Date(0))).toBe("1970-01-01T00:00:00.000Z");
  });

  test("createDb client has Drizzle's identity serializers", () => {
    const { client, db } = createDb({ url: URL_TEST, applicationName: "drivers-test" });
    expect(db).toBeDefined();
    for (const oid of OIDS) {
      const probe = { a: 1 };
      expect(client.options.serializers[oid]?.(probe)).toBe(probe);
    }
  });

  test("createDb supports the full schema", () => {
    const { db } = createDb({ url: URL_TEST, applicationName: "t", schema: "full" });
    expect(Object.keys(db._.fullSchema ?? {})).toContain("botCharacters");
    expect(Object.keys(db._.fullSchema ?? {})).toContain("agentKeys");
  });

  test("application_name, pool defaults and ceiling", () => {
    const sql = createSql({ url: URL_TEST, applicationName: "drivers-test", max: 999 });
    expect(sql.options.max).toBe(POOL_MAX_CEILING);
    const connection = (sql.options as unknown as { connection: Record<string, string> }).connection;
    expect(connection.application_name).toBe("drivers-test");
    const resolved = resolvePgClientOptions({
      applicationName: "x",
      env: { DATABASE_URL: URL_TEST, DATABASE_POOL_MAX: "50" },
    });
    expect(resolved).toEqual({
      url: URL_TEST,
      max: 20,
      applicationName: "x",
      idleTimeoutSeconds: 30,
      connectTimeoutSeconds: 5,
      prepare: true,
    });
  });

  test("DATABASE_URL is read from the provided env at call time", () => {
    expect(() => createSql({ applicationName: "x", env: {} })).toThrow(/DATABASE_URL/);
  });

  test("root keeps the legacy exports", () => {
    expect(typeof root.createDb).toBe("function");
    expect(typeof root.resolveDatabaseUrl).toBe("function");
    expect(typeof root.resolvePoolMax).toBe("function");
    expect(root.DEFAULT_POOL_MAX).toBe(4);
    expect(root.POOL_MAX_CEILING).toBe(20);
    expect(root.schema.agentKeys).toBeDefined();
  });
});

describe("Bun.SQL driver", () => {
  test("options map application_name and maxLifetime", () => {
    const opts = bunSqlOptions({ url: URL_TEST, applicationName: "bun-test", max: 100 });
    expect(opts.connection).toEqual({ application_name: "bun-test" });
    expect(opts.maxLifetime).toBe(1800);
    expect(opts.max).toBe(20);
    const custom = bunSqlOptions({ url: URL_TEST, applicationName: "a", maxLifetimeSeconds: 60 });
    expect(custom.maxLifetime).toBe(60);
  });

  test("createBunSql passes them to Bun.SQL", () => {
    const client = createBunSql({ url: URL_TEST, applicationName: "bun-test" });
    const options = client.options as unknown as {
      maxLifetime: number;
      query: string;
      max: number;
    };
    expect(options.maxLifetime).toBe(1_800_000);
    expect(options.query).toContain("application_name");
    expect(options.query).toContain("bun-test");
    expect(options.max).toBe(4);
    client.close();
  });

  test("createBunDb and the ./bun alias", () => {
    const { db, client } = createBunDb({ url: URL_TEST, applicationName: "t" });
    expect(db).toBeDefined();
    client.close();
    expect(bunAlias.createBunDb).toBe(bunSql.createBunDb);
    expect(bunAlias.createBunSql).toBe(bunSql.createBunSql);
  });
});
