// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { evaluate, excluded, residueLines } from "./product-residue.ts";

describe("product-residue", () => {
  test("counts the lines that name a departed product", () => {
    const text = [
      "Shenron gateway /api/v1/shenron",
      "koharu-llama loads libllama",
      "Dragon Ball and dragon_ball and dragonball",
      "databooks preset",
      "aphrody only",
    ].join("\n");
    expect(residueLines(text)).toBe(4);
    expect(residueLines("dbfr profile")).toBe(0);
  });

  test("skips evidence trees and generated catalogues", () => {
    expect(excluded("docs/migration/shenron-workspace-import.json")).toBe(true);
    expect(excluded("docs/llms.txt")).toBe(true);
    expect(excluded("bun.lock")).toBe(true);
    expect(excluded("crates/ai/mcp/src/http_rest.rs")).toBe(false);
  });

  test("fails on new files and regressions, reports shrinkage", () => {
    const report = evaluate(
      { "a.rs": 3, "b.md": 5, "c.ts": 1 },
      { "a.rs": 3, "b.md": 4, "d.json": 2 },
    );
    expect(report.ok).toBe(false);
    expect(report.findings).toEqual([
      { kind: "regression", file: "b.md", count: 5, baseline: 4 },
      { kind: "new-file", file: "c.ts", count: 1, baseline: 0 },
    ]);
    expect(report.shrunk).toEqual(["d.json"]);
    expect(evaluate({ "a.rs": 2 }, { "a.rs": 3 }).ok).toBe(true);
  });
});
