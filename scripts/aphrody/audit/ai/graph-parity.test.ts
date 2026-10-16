// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compare, failures, report } from "./graph-parity";

function fixture(edges: string[]) {
  const labels = [
    ...new Set(edges.flatMap((edge) => edge.split("|").slice(1, 3))),
  ];
  const nodes = labels.map((label) => ({
    id: label,
    label,
    file_type: "code",
    source_file: "fixture.ts",
  }));
  return {
    oracle: {
      nodes: nodes.map((node) => `fixture.ts|${node.label}|code`),
      edges,
    },
    graph: {
      nodes,
      links: edges.map((edge) => {
        const [relation, source, target, confidence] = edge.split("|") as [
          string,
          string,
          string,
          string,
        ];
        return { relation, source, target, confidence };
      }),
    },
  };
}

const manyCalls = Array.from(
  { length: 100 },
  (_, index) => `calls|run|f${index}|EXTRACTED`,
);

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
      {
        nodes: ["a.rs|run()|function"],
        edges: ["calls|run()|helper()|EXTRACTED"],
      },
      {
        nodes: [
          {
            id: "a",
            label: "run()",
            file_type: "function",
            source_file: "a.rs",
          },
          {
            id: "b",
            label: "helper()",
            file_type: "function",
            source_file: null,
          },
        ],
        links: [
          {
            relation: "calls",
            source: "a",
            target: "b",
            confidence: "EXTRACTED",
          },
        ],
      },
    );
    expect(result.nodes.jaccard).toBe(1);
    expect(result.byRelation.calls?.jaccard).toBe(1);
    expect(result.confidence.agreement).toBe(1);
    expect(failures(result)).toEqual([]);
  });

  test.each([
    "contains",
    "defines",
    "imports_from",
    "method",
    "extends",
    "inherits",
    "implements",
  ])(
    "refuses a missing %s relation even when overall edge parity passes",
    (relation) => {
      const { oracle, graph } = fixture([
        ...manyCalls,
        `${relation}|run|f0|EXTRACTED`,
      ]);
      graph.links.pop();
      const result = report(oracle, graph);
      expect(result.topology.jaccard).toBeGreaterThan(0.9);
      expect(failures(result)).toEqual([
        `${relation}: Jaccard must be >= 0.95`,
      ]);
    },
  );

  test.each(["calls", "references"])(
    "enforces the %s threshold separately",
    (relation) => {
      const edges = Array.from(
        { length: 10 },
        (_, index) => `${relation}|run|f${index}|EXTRACTED`,
      );
      const { oracle, graph } = fixture([
        ...manyCalls.map((edge) => edge.replace("calls", "contains")),
        ...edges,
      ]);
      graph.links.splice(-2);
      expect(failures(report(oracle, graph))).toEqual([
        `${relation}: Jaccard must be >= 0.90`,
      ]);
    },
  );

  test("separates topology parity from confidence and refuses confidence drift", () => {
    const { oracle, graph } = fixture(manyCalls);
    for (const edge of graph.links.slice(0, 6)) edge.confidence = "INFERRED";
    const result = report(oracle, graph);
    expect(result.topology.jaccard).toBe(1);
    expect(result.byRelation.calls?.jaccard).toBe(1);
    expect(result.confidence.agreement).toBe(0.94);
    expect(failures(result)).toEqual([
      "confidence: class agreement must be >= 0.95",
    ]);
  });

  test("accepts exact structural and confidence boundaries", () => {
    const structural = Array.from(
      { length: 20 },
      (_, index) => `method|run|f${index}|EXTRACTED`,
    );
    const { oracle, graph } = fixture([...manyCalls, ...structural]);
    graph.links.pop();
    for (const edge of graph.links.slice(0, 5)) edge.confidence = "INFERRED";
    const result = report(oracle, graph);
    expect(result.byRelation.method?.jaccard).toBe(0.95);
    expect(result.confidence.agreement).toBeGreaterThan(0.95);
    expect(failures(result)).toEqual([]);
    const exact = fixture(manyCalls);
    for (const edge of exact.graph.links.slice(0, 5))
      edge.confidence = "INFERRED";
    expect(report(exact.oracle, exact.graph).confidence.agreement).toBe(0.95);
    expect(failures(report(exact.oracle, exact.graph))).toEqual([]);
  });

  test("refuses malformed graphs instead of treating missing ids as labels", () => {
    const { oracle, graph } = fixture(["calls|run|helper|EXTRACTED"]);
    graph.links[0]!.target = "missing";
    expect(() => report(oracle, graph)).toThrow("dangling calls edge");
    graph.links[0]!.target = "helper";
    graph.links[0]!.confidence = "UNKNOWN";
    expect(() => report(oracle, graph)).toThrow("unknown confidence");
    graph.links[0]!.confidence = "EXTRACTED";
    graph.nodes.push(graph.nodes[0]!);
    expect(() => report(oracle, graph)).toThrow("duplicate node id");
  });

  test("CLI returns failure for a hidden relation regression and success for parity", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "aphrody-graph-parity-"));
    try {
      const { oracle, graph } = fixture([
        ...manyCalls,
        "method|run|f0|EXTRACTED",
      ]);
      const oraclePath = join(scratch, "oracle.json");
      const graphPath = join(scratch, "graph.json");
      await writeFile(oraclePath, JSON.stringify(oracle));
      const invoke = async () => {
        await writeFile(graphPath, JSON.stringify(graph));
        const child = Bun.spawn(
          [
            process.execPath,
            join(import.meta.dir, "graph-parity.ts"),
            oraclePath,
            graphPath,
          ],
          { windowsHide: true, stdout: "pipe", stderr: "pipe" },
        );
        const [exitCode, stdout, stderr] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ]);
        return { exitCode, stdout, stderr };
      };
      expect((await invoke()).exitCode).toBe(0);
      graph.links.pop();
      const rejected = await invoke();
      expect(rejected.exitCode).toBe(1);
      expect(JSON.parse(rejected.stdout).failures).toEqual([
        "method: Jaccard must be >= 0.95",
      ]);
      graph.links[0]!.target = "missing";
      const malformed = await invoke();
      expect(malformed.exitCode).toBe(2);
      expect(malformed.stderr).toContain("dangling calls edge");
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });
});
