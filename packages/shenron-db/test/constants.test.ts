// Source: packages/shenron/db/test/constants.test.ts at 8172f535ce (preserved Git history).
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AGENT_SCOPES,
  FEEDBACK_STATUSES,
  GOAL_PRIORITIES,
  WIKI_CATEGORIES,
  isWikiCategoryName,
} from "../src/constants";
import * as schema from "../src/schema";

describe("constants", () => {
  test("constants.ts imports nothing", () => {
    const source = readFileSync(join(import.meta.dir, "..", "src", "constants.ts"), "utf8");
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/\bfrom\s+["']/);
    expect(source).not.toMatch(/\brequire\(|\bimport\(/);
  });

  test("schema re-exports AGENT_SCOPES", () => {
    expect(schema.AGENT_SCOPES).toBe(AGENT_SCOPES);
    expect([...AGENT_SCOPES]).toEqual([
      "read",
      "contribute",
      "write:articles",
      "publish:articles",
      "comment",
      "moderate",
    ]);
  });

  test("feedback statuses and goal priorities retain the historical bot contract", () => {
    expect([...FEEDBACK_STATUSES]).toEqual(["pending", "gold_added", "rejected", "reviewed"]);
    expect([...GOAL_PRIORITIES]).toEqual(["p0", "p1", "p2", "p3"]);
  });

  test("21 unique wiki categories", () => {
    expect(WIKI_CATEGORIES).toHaveLength(21);
    expect(new Set(WIKI_CATEGORIES.map(c => c.name)).size).toBe(21);
    expect(isWikiCategoryName("characters")).toBe(true);
    expect(isWikiCategoryName("nope")).toBe(false);
  });
});
