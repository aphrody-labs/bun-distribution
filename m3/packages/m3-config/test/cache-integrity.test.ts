// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { M3UiCache } from "../cache-db.ts";

test("cache preserves JSON-looking strings as strings", () => {
  const cache = new M3UiCache();
  try {
    for (const value of ["null", "true", "false", "123", '"quoted"', '{"a":1}', "[1,2]", ""]) {
      cache.set("values", value, value);
      expect(cache.get<string>("values", value)).toBe(value);
    }
    cache.set("values", "object", { a: [1, null, true] });
    expect(cache.get<{ a: (number | boolean | null)[] }>("values", "object")).toEqual({
      a: [1, null, true],
    });
    expect(() => cache.set("values", "undefined", undefined)).toThrow("JSON serializable");
    expect(cache.get("values", "undefined")).toBeNull();
  } finally {
    cache.close();
  }
});

test("clearing the empty namespace preserves all other data", () => {
  const cache = new M3UiCache();
  try {
    cache.set("", "key", "empty namespace");
    cache.set("other", "key", "protected");
    cache.set("__proto__", "key", "literal namespace");
    expect(cache.stats().namespaces["__proto__"]).toBe(1);
    expect(cache.clear("")).toBe(1);
    expect(cache.get<string>("other", "key")).toBe("protected");
    expect(cache.get<string>("__proto__", "key")).toBe("literal namespace");
  } finally {
    cache.close();
  }
});
