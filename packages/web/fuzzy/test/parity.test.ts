// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { FuzzySearch, type FuzzyOptions } from "../src/index.ts";
import fixtures from "./fixtures/fuse-7.1.0.json" with { type: "json" };

type Expected = {
  item: unknown;
  refIndex: number;
  score?: number;
  matches?: { indices: [number, number][]; value: string; key?: string; refIndex?: number }[];
};

describe("parity with fuse.js 7.1.0 (generated fixtures)", () => {
  test("fixture set is substantial", () => {
    expect(fixtures.oracle).toBe("fuse.js@7.1.0");
    expect(fixtures.cases.length).toBeGreaterThanOrEqual(300);
  });

  test("results, order, scores and match ranges are identical", () => {
    const indexes = new Map<string, FuzzySearch<unknown>>();
    let checked = 0;
    let mismatches = 0;
    for (const fixture of fixtures.cases) {
      const cacheKey = `${fixture.keyed}:${JSON.stringify(fixture.options)}`;
      let index = indexes.get(cacheKey);
      if (!index) {
        index = new FuzzySearch<unknown>(
          (fixture.keyed ? fixtures.docs : fixtures.strings) as unknown[],
          fixture.options as FuzzyOptions<unknown>,
        );
        indexes.set(cacheKey, index);
      }
      const actual = index.search(fixture.query, fixture.limit ? { limit: fixture.limit } : {});
      const expected = fixture.results as Expected[];
      checked += 1;
      const same = JSON.stringify(actual) === JSON.stringify(expected);
      if (!same) {
        mismatches += 1;
        if (mismatches <= 3) {
          console.error("mismatch", JSON.stringify(fixture.options), JSON.stringify(fixture.query));
          console.error(JSON.stringify(actual).slice(0, 300));
          console.error(JSON.stringify(expected).slice(0, 300));
        }
      }
    }
    expect(checked).toBe(fixtures.cases.length);
    expect(mismatches).toBe(0);
  });

  test("some fixtures return matches (the comparison is not vacuous)", () => {
    const withResults = fixtures.cases.filter(
      (fixture) => (fixture.results as unknown[]).length > 0,
    );
    expect(withResults.length).toBeGreaterThan(fixtures.cases.length / 2);
  });
});

describe("behaviour", () => {
  const catalog = [
    { id: "gemma4-e2b", title: "Gemma 4 E2B", summary: "small instruct model" },
    { id: "qwen3-8b", title: "Qwen3 8B", summary: "general chat model" },
    { id: "llama-3-8b", title: "Llama 3 8B", summary: "open weights" },
  ];

  test("exact field match scores best and typos still match", () => {
    const index = new FuzzySearch(catalog, {
      keys: ["id", "title"],
      includeScore: true,
      threshold: 0.3,
      ignoreLocation: true,
    });
    const exact = index.search("qwen3-8b");
    expect(exact[0]?.item.id).toBe("qwen3-8b");
    expect(exact[0]?.score).toBeLessThan(0.001);
    expect(index.search("gemna")[0]?.item.id).toBe("gemma4-e2b");
    expect(index.search("zzzzzzzz")).toEqual([]);
  });

  test("empty collections and empty queries return nothing", () => {
    expect(new FuzzySearch<string>([]).search("a")).toEqual([]);
    expect(new FuzzySearch(catalog, { keys: ["id"] }).search("")).toEqual([]);
  });

  test("rejects non-positive key weights", () => {
    expect(() => new FuzzySearch(catalog, { keys: [{ name: "id", weight: 0 }] })).toThrow("weight");
  });
});
