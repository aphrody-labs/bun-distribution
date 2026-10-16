// Source: packages/shenron/db/src/config.test.ts at 8172f535ce (preserved Git history).
import { describe, expect, test } from "bun:test";
import { POOL_MAX_CEILING, resolveDatabaseUrl, resolvePoolMax } from "./config";

describe("config", () => {
  test("rejects missing or corrupted urls", () => {
    for (const bad of [undefined, "", "undefined", "null", "eyJ2IjoxfQ", "mysql://x", "::"]) {
      expect(() => resolveDatabaseUrl(bad)).toThrow();
    }
    expect(resolveDatabaseUrl(" postgres://u@h/db ")).toBe("postgres://u@h/db");
  });
  test("pool max falls back and is capped", () => {
    expect(resolvePoolMax("abc")).toBe(4);
    expect(resolvePoolMax("-1")).toBe(4);
    expect(resolvePoolMax("999")).toBe(POOL_MAX_CEILING);
    expect(resolvePoolMax("8")).toBe(8);
  });
});
