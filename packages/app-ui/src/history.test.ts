// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import {
  filterThreads,
  groupByDate,
  normalizeThreads,
  transcript,
} from "./history";
import { evaluateArithmetic, formatNumber, suggest } from "./quickbar-suggest";
import { DEFAULT_PREFERENCES, parsePreferences } from "./preferences";

const now = new Date(2026, 8, 26, 15, 0, 0);
const at = (daysAgo: number) =>
  Math.floor(new Date(2026, 8, 26 - daysAgo, 10, 0, 0).getTime() / 1000);

describe("normalizeThreads", () => {
  test("decodes thread/list, prefers name over preview and sorts newest first", () => {
    const { threads, nextCursor } = normalizeThreads({
      threads: [
        { id: "a", preview: "old question", updatedAt: at(3) },
        {
          id: "b",
          name: "Named",
          preview: "ignored",
          updatedAt: at(0),
          model: "qwen",
        },
        { id: "", preview: "dropped" },
        { preview: "no id" },
      ],
      nextCursor: "c1",
    });
    expect(threads.map((t) => t.id)).toEqual(["b", "a"]);
    expect(threads[0]?.title).toBe("Named");
    expect(nextCursor).toBe("c1");
  });

  test("accepts the legacy data field and empty results", () => {
    expect(
      normalizeThreads({ data: [{ id: "x", createdAt: 5 }] }).threads[0],
    ).toMatchObject({ id: "x", updatedAt: 5, title: "Untitled thread" });
    expect(normalizeThreads(null).threads).toEqual([]);
  });
});

describe("filterThreads", () => {
  const threads = normalizeThreads({
    threads: [
      { id: "1", preview: "Météo à Paris" },
      { id: "2", preview: "Rust borrow checker" },
    ],
  }).threads;
  test("is accent and case insensitive and needs every word", () => {
    expect(filterThreads(threads, "meteo PARIS").map((t) => t.id)).toEqual([
      "1",
    ]);
    expect(filterThreads(threads, "rust paris")).toEqual([]);
    expect(filterThreads(threads, "  ")).toHaveLength(2);
  });
});

describe("groupByDate", () => {
  test("buckets today, yesterday, 7 days, 30 days and months", () => {
    const { threads } = normalizeThreads({
      threads: [0, 1, 4, 20, 90].map((d) => ({
        id: `t${d}`,
        preview: "q",
        updatedAt: at(d),
      })),
    });
    const groups = groupByDate(threads, now, "en");
    expect(groups.map((g) => g.key)).toEqual([
      "today",
      "yesterday",
      "week",
      "month",
      "2026-06",
    ]);
    expect(groups[4]?.label).toBe("June 2026");
  });
});

describe("transcript", () => {
  test("keeps user and agent messages in order", () => {
    const text = transcript({
      thread: {
        preview: "Hi",
        turns: [
          {
            items: [
              {
                type: "userMessage",
                content: [{ type: "text", text: "2+2?" }],
              },
              { type: "reasoning" },
              { type: "agentMessage", text: "4" },
            ],
          },
        ],
      },
    });
    expect(text).toBe("# Hi\n\n**You:** 2+2?\n\n**Aphrody:** 4");
  });
});

describe("calculator", () => {
  test("evaluates precedence, powers, parentheses and decimal commas", () => {
    expect(evaluateArithmetic("2 + 3 * 4")).toBe(14);
    expect(evaluateArithmetic("2^3^2")).toBe(512);
    expect(evaluateArithmetic("(1 + 2) × 3 =")).toBe(9);
    expect(evaluateArithmetic("-4 + 10 ÷ 4")).toBe(-1.5);
    expect(evaluateArithmetic("1,5 * 2")).toBe(3);
    expect(formatNumber(evaluateArithmetic("0.1 + 0.2") ?? 0)).toBe("0.3");
  });

  test("rejects questions, bare numbers and malformed input", () => {
    for (const input of [
      "what is 2+2",
      "42",
      "2 +",
      "(1 + 2",
      "1 / 0",
      "2 ** 3 x",
    ]) {
      expect(evaluateArithmetic(input)).toBeNull();
    }
  });
});

describe("suggest", () => {
  const { threads } = normalizeThreads({
    threads: [{ id: "1", preview: "2 + 2 homework", updatedAt: 1 }],
  });
  test("puts the calculator answer first and honors disabled sources", () => {
    const all = suggest("2 + 2", threads, DEFAULT_PREFERENCES.sources);
    expect(all[0]).toEqual({
      kind: "calculator",
      expression: "2 + 2",
      value: "4",
    });
    expect(all[1]?.kind).toBe("thread");
    expect(
      suggest("2 + 2", threads, { history: false, calculator: false }),
    ).toEqual([]);
    expect(suggest("   ", threads, DEFAULT_PREFERENCES.sources)).toEqual([]);
  });
});

describe("preferences", () => {
  test("merges stored values over defaults and ignores garbage", () => {
    expect(
      parsePreferences(
        '{"onboarded":true,"sources":{"history":false,"calculator":"yes"}}',
      ),
    ).toEqual({
      ...DEFAULT_PREFERENCES,
      version: 1,
      onboarded: true,
      sources: {
        history: false,
        calculator: true,
        navigation: true,
        commands: true,
        files: true,
      },
      modelsDir: null,
    });
    expect(parsePreferences("{not json")).toEqual(DEFAULT_PREFERENCES);
  });

  test("keeps a trimmed models folder and drops blank or non-string ones", () => {
    expect(parsePreferences('{"modelsDir":"  D:/models "}').modelsDir).toBe(
      "D:/models",
    );
    expect(parsePreferences('{"modelsDir":"   "}').modelsDir).toBeNull();
    expect(parsePreferences('{"modelsDir":42}').modelsDir).toBeNull();
  });
});
