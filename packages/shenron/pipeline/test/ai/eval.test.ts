// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  aggregate,
  aggregateByTag,
  type CaseResult,
  type EvalHit,
  firstHitRank,
  matchesExpectedUrl,
  mrr,
  ndcgAtK,
  normalizeUrl,
  parseGold,
  recallAtK,
  runCase,
} from "../../src/ai/eval";

const GOLD = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "..",
  "..",
  "apps",
  "shenron",
  "bot",
  "tests",
  "rag-gold.jsonl",
);
const FROZEN = JSON.parse(
  readFileSync(join(import.meta.dir, "fixtures", "eval", "rag-eval-frozen.json"), "utf8"),
) as {
  cases: number;
  hits: EvalHit[][];
  expected: {
    ranks: number[];
    ndcg: number[];
    ndcgAt3: number[];
    aggregate: unknown;
    byTag: unknown;
  };
};

const cases = parseGold(readFileSync(GOLD, "utf8"));

describe("parseGold", () => {
  test("apps/shenron/bot/tests/rag-gold.jsonl holds 172 cases", () => {
    expect(cases.length).toBe(172);
    expect(FROZEN.cases).toBe(172);
  });
  test("invalid and comment lines are skipped", () => {
    expect(parseGold('// c\n{"q":"a","expect":["x"]}\n{bad\n{"q":"b"}\n')).toEqual([
      { q: "a", expect: ["x"] },
    ]);
  });
});

describe("metrics equal the frozen rag-eval.ts values", () => {
  const results: CaseResult[] = cases.map((c, n) => {
    const hits = FROZEN.hits[n] ?? [];
    return {
      case: c,
      rank: firstHitRank(hits, c),
      ndcg: ndcgAtK(hits, c),
      top: hits.slice(0, 3).map((h) => ({ title: h.title, url: h.url, kind: h.kind })),
      latencyMs: 0,
      mode: "frozen",
    };
  });

  test("per-case ranks and nDCG", () => {
    expect(results.map((r) => r.rank)).toEqual(FROZEN.expected.ranks);
    expect(results.map((r) => r.ndcg)).toEqual(FROZEN.expected.ndcg);
    expect(cases.map((c, n) => ndcgAtK(FROZEN.hits[n] ?? [], c, 3))).toEqual(
      FROZEN.expected.ndcgAt3,
    );
  });

  test("aggregate and per-tag aggregates", () => {
    expect(aggregate(results)).toEqual(FROZEN.expected.aggregate as ReturnType<typeof aggregate>);
    expect(aggregateByTag(results)).toEqual(
      FROZEN.expected.byTag as ReturnType<typeof aggregateByTag>,
    );
  });

  test("runCase produces the same rank and nDCG", async () => {
    const n = 3;
    const c = cases[n];
    if (!c) throw new Error("gold case missing");
    const r = await runCase(c, async () => ({ results: FROZEN.hits[n] ?? [], mode: "frozen" }));
    expect(r.rank).toBe(FROZEN.expected.ranks[n] ?? -1);
    expect(r.ndcg).toBe(FROZEN.expected.ndcg[n] ?? -1);
    expect(r.mode).toBe("frozen");
  });
});

describe("URL helpers", () => {
  test("normalizeUrl and matchesExpectedUrl boundaries", () => {
    expect(normalizeUrl("https://www.dragonballfr.com/Wiki/Freezer/")).toBe("/wiki/freezer");
    expect(matchesExpectedUrl("/wiki/freezer#x", "/wiki/freezer")).toBe(true);
    expect(matchesExpectedUrl("/wiki/freezer-futur", "/wiki/freezer")).toBe(false);
    expect(matchesExpectedUrl("/wiki/x", "")).toBe(false);
  });

  test("recallAtK, mrr and URL-form ndcgAtK", () => {
    const ranked = ["/a", "/b", "/wiki/freezer/", "/c"];
    const expected = ["/wiki/freezer"];
    expect(recallAtK(ranked, expected, 2)).toBe(0);
    expect(recallAtK(ranked, expected, 3)).toBe(1);
    expect(mrr(ranked, expected)).toBeCloseTo(1 / 3);
    expect(mrr(["/x"], expected)).toBe(0);
    expect(ndcgAtK(ranked, expected, 10)).toBeCloseTo(1 / Math.log2(4));
    const hits = ranked.map((url) => ({ title: "", snippet: "", url, kind: "k" }));
    expect(ndcgAtK(ranked, expected, 10)).toBe(ndcgAtK(hits, { q: "q", expectUrl: expected }));
  });
});
