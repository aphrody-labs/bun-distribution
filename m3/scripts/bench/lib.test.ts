// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import {
  type Budget,
  type Metric,
  compareBudget,
  formatValue,
  groupOf,
  pct,
  percentile,
  summarize,
} from "./lib.ts";

describe("statistics", () => {
  test("percentile is nearest-rank", () => {
    const xs = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(percentile(xs, 50)).toBe(10);
    expect(percentile(xs, 95)).toBe(19);
    expect(percentile(xs, 100)).toBe(20);
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([], 50)).toBeNaN();
  });
  test("summarize reports the p50 as the headline and keeps the spread", () => {
    const m = summarize([5, 1, 3, 2, 4]);
    expect(m).toEqual({ value: 3, unit: "ms", n: 5, min: 1, p95: 5, max: 5 });
  });
});

const measured = (values: Record<string, number>): Record<string, Metric> =>
  Object.fromEntries(
    Object.entries(values).map(([k, value]) => [k, { value, unit: "ms" } satisfies Metric]),
  );

describe("budget", () => {
  const budget: Budget = {
    schema: "m3-bench-budget/1",
    tolerance: 0.1,
    metrics: {
      "yolo.version": { value: 10, unit: "ms" },
      "compile.server_tuned.size": { value: 1000, unit: "B" },
      "mcp.cold": { value: 50, unit: "ms" },
    },
  };

  test("a metric within tolerance passes, beyond it fails", () => {
    const rows = compareBudget(
      budget,
      measured({ "yolo.version": 11, "compile.server_tuned.size": 1101, "mcp.cold": 40 }),
    );
    expect(rows.map((r) => [r.key, r.ok])).toEqual([
      ["yolo.version", true],
      ["compile.server_tuned.size", false],
      ["mcp.cold", true],
    ]);
  });
  test("a budgeted metric that was not measured fails", () => {
    const rows = compareBudget(budget, measured({ "yolo.version": 9 }));
    expect(rows.filter((r) => !r.ok).map((r) => r.key)).toEqual([
      "compile.server_tuned.size",
      "mcp.cold",
    ]);
  });
  test("the tolerance can be overridden", () => {
    expect(
      compareBudget(
        budget,
        measured({ "yolo.version": 12, "compile.server_tuned.size": 1000, "mcp.cold": 50 }),
        0.25,
      ).every((r) => r.ok),
    ).toBe(true);
  });
});

describe("formatting", () => {
  test("units", () => {
    expect(formatValue(20.4, "ms")).toBe("20.4 ms");
    expect(formatValue(4.123, "ms")).toBe("4.12 ms");
    expect(formatValue(2500, "ms")).toBe("2.50 s");
    expect(formatValue(2048, "B")).toBe("2.0 KiB");
    expect(formatValue(undefined, "ms")).toBe("n/a");
  });
  test("pct and groupOf", () => {
    expect(pct(20, 5)).toBe("-75.0%");
    expect(pct(0, 3)).toBe("new");
    expect(groupOf("compile.server_tuned.size")).toBe("compile");
  });
});
