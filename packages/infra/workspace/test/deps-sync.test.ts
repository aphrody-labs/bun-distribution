// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { BLOCK_BEGIN, BLOCK_END, cmpVersion, matchRules, normaliseErrors, parseCommit, replaceManagedBlock } from "../src/deps-sync.ts";

describe("cmpVersion", () => {
  test("orders releases and prereleases", () => {
    expect(cmpVersion("3.0.0-alpha.3", "3.0.0-alpha.4")).toBe(-1);
    expect(cmpVersion("3.0.0-alpha.10", "3.0.0-alpha.9")).toBe(1);
    expect(cmpVersion("3.0.0", "3.0.0-alpha.9")).toBe(1);
    expect(cmpVersion("=2.12.1", "2.12.1")).toBe(0);
    expect(cmpVersion("0.12.21", "0.12.22")).toBe(-1);
  });
});

describe("parseCommit", () => {
  test("parses conventional commits", () => {
    expect(parseCommit("abc", "2026-10-02", "feat(shell)!: add channel")).toMatchObject({ type: "feat", scope: "shell", breaking: true });
    expect(parseCommit("abc", "2026-10-02", "chore(tauri,uv): align")?.scope).toBe("tauri,uv");
    expect(parseCommit("abc", "2026-10-02", "wip stuff")).toBeUndefined();
  });
});

describe("matchRules", () => {
  const rules = [{ id: "export", match: "has no exported member", kind: "brief" as const }];
  test("matches and caps lines", () => {
    const out = "a.ts: error TS2724: '\"x\"' has no exported member named 'y'\nok";
    expect(matchRules(out, rules)[0]?.lines).toHaveLength(1);
    expect(matchRules("nothing", rules)).toEqual([]);
  });
});

describe("managed block", () => {
  test("appends then replaces in place", () => {
    const once = replaceManagedBlock("# Boot\n1. step", "first");
    expect(once).toContain(`${BLOCK_BEGIN}\nfirst\n${BLOCK_END}`);
    const twice = replaceManagedBlock(once, "second");
    expect(twice.match(new RegExp(BLOCK_BEGIN, "g"))).toHaveLength(1);
    expect(twice).toContain("second");
    expect(twice).not.toContain("first");
  });
});

describe("normaliseErrors", () => {
  test("drops positions and dedupes", () => {
    const out = "src/a.ts(10,5): error TS2307: no\nsrc/a.ts(20,1): error TS2307: no\nwarning";
    expect(normaliseErrors(out)).toEqual(["src/a.ts: error TS2307: no"]);
  });
});
