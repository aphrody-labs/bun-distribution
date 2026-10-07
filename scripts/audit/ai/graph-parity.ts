// SPDX-License-Identifier: Apache-2.0
// Compare a native Graphify-compatible graph.json with a committed Graphify oracle snapshot.

import { readFile } from "node:fs/promises";

type Oracle = { nodes: string[]; edges: string[] };
type GraphJson = {
  nodes: Array<{ id: string; label: string; file_type: string; source_file?: string | null }>;
  links: Array<{ relation: string; source: string; target: string; confidence: string }>;
};

export type Parity = {
  expected: number;
  actual: number;
  jaccard: number;
  missing: string[];
  extra: string[];
};

export function compare(expected: Iterable<string>, actual: Iterable<string>): Parity {
  const left = new Set(expected);
  const right = new Set(actual);
  const missing = [...left].filter((item) => !right.has(item)).toSorted();
  const extra = [...right].filter((item) => !left.has(item)).toSorted();
  const union = new Set([...left, ...right]).size;
  return {
    expected: left.size,
    actual: right.size,
    jaccard: union === 0 ? 1 : (left.size - missing.length) / union,
    missing,
    extra,
  };
}

function graphSets(graph: GraphJson) {
  const ids = new Map(graph.nodes.map((node) => [node.id, node]));
  const nodes = graph.nodes
    .filter((node) => node.source_file != null)
    .map((node) => `${node.source_file}|${node.label}|${node.file_type}`);
  const edges = graph.links.map((edge) => {
    const source = ids.get(edge.source)?.label ?? edge.source;
    const target = ids.get(edge.target)?.label ?? edge.target;
    return `${edge.relation}|${source}|${target}|${edge.confidence}`;
  });
  return { nodes, edges };
}

export function report(oracle: Oracle, graph: GraphJson) {
  const actual = graphSets(graph);
  const overall = {
    nodes: compare(oracle.nodes, actual.nodes),
    edges: compare(oracle.edges, actual.edges),
  };
  const relations = [
    ...new Set([...oracle.edges, ...actual.edges].map((edge) => edge.split("|", 1)[0])),
  ].toSorted();
  const byRelation = Object.fromEntries(
    relations.map((relation) => [
      relation,
      compare(
        oracle.edges.filter((edge) => edge.startsWith(`${relation}|`)),
        actual.edges.filter((edge) => edge.startsWith(`${relation}|`)),
      ),
    ]),
  );
  const oracleEdges = new Map(
    oracle.edges.map((edge) => [edge.slice(0, edge.lastIndexOf("|")), edge.split("|").at(-1)]),
  );
  const actualEdges = new Map(
    actual.edges.map((edge) => [edge.slice(0, edge.lastIndexOf("|")), edge.split("|").at(-1)]),
  );
  const shared = [...oracleEdges.keys()].filter((edge) => actualEdges.has(edge));
  const confidence = {
    compared: shared.length,
    matching: shared.filter((edge) => oracleEdges.get(edge) === actualEdges.get(edge)).length,
    agreement:
      shared.length === 0
        ? 1
        : shared.filter((edge) => oracleEdges.get(edge) === actualEdges.get(edge)).length /
          shared.length,
  };
  return { nodes: overall.nodes, edges: overall.edges, byRelation, confidence };
}

async function main(args: string[]) {
  if (args.length !== 2) {
    throw new Error(
      "usage: bun scripts/audit/ai/graph-parity.ts <oracle.json> <native-graph.json>",
    );
  }
  const [oraclePath, graphPath] = args;
  const [oracle, graph] = await Promise.all([
    readFile(oraclePath!, "utf8").then((text) => JSON.parse(text) as Oracle),
    readFile(graphPath!, "utf8").then((text) => JSON.parse(text) as GraphJson),
  ]);
  const result = report(oracle, graph);
  console.log(JSON.stringify(result, null, 2));
  const failed = result.nodes.jaccard < 0.95 || result.edges.jaccard < 0.9;
  if (failed) process.exitCode = 1;
}

if (import.meta.main) {
  main(Bun.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  });
}
