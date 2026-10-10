// SPDX-License-Identifier: Apache-2.0
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import { collectEdges, cycles, graphFromMetadata, inside } from "./repo-layering.ts";

const root = resolve(import.meta.dir, "..", "..", "..");

const fixture = {
  packages: [
    {
      id: "app",
      name: "app",
      manifest_path: `${root}/crates/infra/aphrody/app/Cargo.toml`,
      dependencies: [
        { name: "core", path: `${root}/crates/os/core` },
        { name: "upstream", path: `${root}/../source/upstream` },
      ],
    },
    {
      id: "core",
      name: "core",
      manifest_path: `${root}/crates/os/core/Cargo.toml`,
      dependencies: [],
    },
  ],
  workspace_members: ["app", "core"],
};

describe("monorepo Cargo graph", () => {
  test("resolves workspace crate edges and records upstream paths separately", () => {
    const graph = graphFromMetadata(root, fixture);
    expect(graph.nodes).toEqual(["crates/infra/aphrody/app", "crates/os/core"]);
    expect(graph.edges).toEqual([
      { from: "crates/infra/aphrody/app", to: "crates/os/core", kind: "dependency", evidence: "app -> core" },
    ]);
    expect(graph.externalPaths).toEqual(["../source/upstream"]);
    expect(graph.errors).toEqual([]);
    expect(cycles(graph.nodes, graph.edges)).toEqual([]);
  });

  test("detects missing workspace nodes and crate cycles", () => {
    const missing = graphFromMetadata(root, {
      ...fixture,
      packages: [
        {
          ...fixture.packages[0]!,
          dependencies: [{ name: "missing", path: `${root}/crates/os/missing` }],
        },
      ],
      workspace_members: ["app"],
    });
    expect(missing.errors).toHaveLength(1);
    const cycle = graphFromMetadata(root, {
      ...fixture,
      packages: [
        fixture.packages[0]!,
        { ...fixture.packages[1]!, dependencies: [{ name: "app", path: `${root}/crates/infra/aphrody/app` }] },
      ],
    });
    expect(cycles(cycle.nodes, cycle.edges)).toEqual([["crates/infra/aphrody/app", "crates/os/core"]]);
  });

  test("does not confuse a sibling prefix with a path inside the repository", () => {
    expect(inside(root, `${root}/crates/os/core`)).toBe(true);
    expect(inside(root, `${root}-archive/crates/os/core`)).toBe(false);
  });

  test("the active Cargo workspace graph is complete and acyclic", () => {
    const graph = collectEdges(root);
    expect(graph.errors).toEqual([]);
    expect(graph.nodes.length).toBeGreaterThan(100);
    expect(graph.edges.length).toBeGreaterThan(0);
    expect(cycles(graph.nodes, graph.edges)).toEqual([]);
  }, 120_000);
});
