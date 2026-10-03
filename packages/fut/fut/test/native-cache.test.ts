// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeSqlite, openSqlite } from "@aphrody/sql/sqlite";
import { FutNativeCache, runNativeFfiBenchmark } from "../src/cache/nativeCache.ts";

test("shared SQLite cache persists compressed/uncompressed payloads and enforces TTL", () => {
  const directory = mkdtempSync(join(tmpdir(), "fut-cache-"));
  const path = join(directory, "cache.db");
  let now = 10_000;
  const large = { text: "long FUT payload ".repeat(200) };
  const cache = new FutNativeCache(path, { now: () => now });
  try {
    cache.set("small", { id: 4 }, 100);
    cache.set("large", large, 200);
    expect(cache.get<{ id: number }>("small")).toEqual({ id: 4 });
    expect(cache.get<typeof large>("large")).toEqual(large);
    cache.close();
    const reopened = new FutNativeCache(path, { now: () => now });
    try {
      expect(reopened.get<typeof large>("large")).toEqual(large);
      now += 100;
      expect(reopened.get<{ id: number }>("small")).toBeNull();
      expect(reopened.get<typeof large>("large")).toEqual(large);
      const inspection = openSqlite(path, { readonly: true });
      try {
        expect(
          inspection
            .query<{ compressed: number }, []>(
              "SELECT compressed FROM fut_cache WHERE key = 'large'",
            )
            .get()?.compressed,
        ).toBe(1);
        expect(
          inspection
            .query<{ count: number }, []>(
              "SELECT count(*) AS count FROM fut_cache WHERE key = 'small'",
            )
            .get()?.count,
        ).toBe(0);
      } finally {
        closeSqlite(inspection);
      }
      now += 100;
      expect(reopened.get<typeof large>("large")).toBeNull();
      expect(() => reopened.set("bad", {}, -1)).toThrow();
      expect(() => reopened.set("bad", undefined)).toThrow();
      reopened.set("__proto__", { id: 9 });
      expect(reopened.get<{ id: number }>("__proto__")).toEqual({ id: 9 });
      reopened.clear();
      expect(reopened.get<{ id: number }>("__proto__")).toBeNull();
    } finally {
      reopened.close();
    }
  } finally {
    cache.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Bun cache benchmark reports measured operations without hardware thresholds", () => {
  const result = runNativeFfiBenchmark(5);
  expect(result.iterations).toBe(5);
  expect(Number.isFinite(result.wyhashOpsPerSec)).toBe(true);
  expect(result.wyhashOpsPerSec).toBeGreaterThan(0);
  expect(result.sqliteOpsPerSec).toBeGreaterThan(0);
  expect(() => runNativeFfiBenchmark(0)).toThrow();
});
