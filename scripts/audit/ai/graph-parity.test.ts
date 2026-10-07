// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "bun:test";
import { compare, report } from "./graph-parity";

describe("graph parity", () => {
  test("compares unique entries and handles empty graphs", () => {
    expect(compare(["a", "a", "b"], ["a", "c"])).toEqual({
      expected: 2,
      actual: 2,
      jaccard: 1 / 3,
      missing: ["b"],
      extra: ["c"],
    });
    expect(compare([], []).jaccard).toBe(1);
  });

  test("reports relation and confidence scores from Graphify-shaped data", () => {
    const result = report(
      { nodes: ["a.rs|run()|function"], edges: ["calls|run()|helper()|EXTRACTED"] },
      {
        nodes: [
          { id: "a", label: "run()", file_type: "function", source_file: "a.rs" },
          { id: "b", label: "helper()", file_type: "function", source_file: null },
        ],
        links: [{ relation: "calls", source: "a", target: "b", confidence: "EXTRACTED" }],
      },
    );
    expect(result.nodes.jaccard).toBe(1);
    expect(result.byRelation.calls?.jaccard).toBe(1);
    expect(result.confidence.agreement).toBe(1);
  });
});
