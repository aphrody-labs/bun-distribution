import { expect, test } from "bun:test";
import {
  importForkModule,
  buildForkCapabilityGraph,
  inspectForkModules,
  parseForkCapabilityCatalog,
  type ForkCapabilityCatalog,
} from "./fork-runtime";

function catalog(): ForkCapabilityCatalog {
  return {
    schemaVersion: 1,
    repository: "aphrody-labs/bun",
    source: {
      revision: "a".repeat(40),
      upstreamRevision: "b".repeat(40),
      mergeBase: "c".repeat(40),
      dirty: false,
      trackedFileCount: 10,
    },
    modules: [
      { name: "bun:ffi", source: "src/js/bun/ffi.ts", sha256: "d".repeat(64) },
      { name: "bun:python", source: "src/js/bun/python.ts", sha256: "e".repeat(64) },
    ],
    packages: [
      {
        name: "@aphrody/bun-dotnet",
        version: "1.0.0",
        manifest: "packages/bun-dotnet/package.json",
        sha256: "f".repeat(64),
      },
    ],
    nativeCrates: [
      {
        name: "bun-dotnet-host",
        manifest: "packages/bun-dotnet-native/Cargo.toml",
        sha256: "a".repeat(64),
        crateTypes: ["cdylib"],
      },
    ],
    sourceDelta: [{ status: "A", path: "src/js/bun/python.ts" }],
    coverage: { modules: 2, packages: 1, nativeCrates: 1, sourceDelta: 1 },
  };
}

test("catalog preserves the complete producer inventory and rejects omissions", () => {
  const source = catalog();
  expect(parseForkCapabilityCatalog(source)).toEqual(source);
  source.modules.pop();
  expect(() => parseForkCapabilityCatalog(source)).toThrow("coverage mismatch: modules");
});

test("unversioned private producer packages remain in the complete inventory", () => {
  const source = catalog();
  source.packages[0]!.version = null;
  expect(parseForkCapabilityCatalog(source).packages).toEqual(source.packages);
});

test("catalog rejects duplicate identities, missing provenance and nonportable paths", () => {
  const duplicate = catalog();
  duplicate.modules[1]!.name = "bun:ffi";
  expect(() => parseForkCapabilityCatalog(duplicate)).toThrow("Duplicate fork capability");
  const missingHash = catalog();
  missingHash.packages[0]!.sha256 = "";
  expect(() => parseForkCapabilityCatalog(missingHash)).toThrow("provenance hash");
  for (const path of [
    "../private/data",
    "C:/bun/package.json",
    "/root/package.json",
    "src\\module.ts",
  ]) {
    const invalid = catalog();
    invalid.modules[0]!.source = path;
    expect(() => parseForkCapabilityCatalog(invalid)).toThrow("nonportable source path");
  }
});

test("source module presence cannot qualify a missing installed native module", async () => {
  const visited: string[] = [];
  const evidence = await inspectForkModules(catalog(), async (name) => {
    visited.push(name);
    if (name === "bun:python") throw new Error("native Python host missing");
    return { ptr() {}, dlopen() {} };
  });
  expect(visited).toEqual(["bun:ffi", "bun:python"]);
  expect(evidence).toEqual([
    { name: "bun:ffi", status: "importable", exports: ["dlopen", "ptr"] },
    { name: "bun:python", status: "unavailable", error: "native Python host missing" },
  ]);
});

test("lazy loader rejects foreign module names before import", async () => {
  await expect(importForkModule(catalog(), "https://foreign.invalid/module.js")).rejects.toThrow(
    "absent from the Bun producer catalog",
  );
  const ffi = await importForkModule<typeof import("bun:ffi")>(catalog(), "bun:ffi");
  expect(typeof ffi.dlopen).toBe("function");
});

test("native graph keeps metadata separate from actual selected Rust extraction", async () => {
  const source = catalog();
  source.modules.push({
    name: "bun:graph-native",
    source: "src/resolve_builtins/HardcodedModule.rs",
    sha256: "a".repeat(64),
  });
  source.coverage.modules++;
  const graph = await buildForkCapabilityGraph(source, {
    files: [
      {
        path: "crates/nie/tests/fork_graph_fixture.rs",
        content: "pub fn entry() -> u32 { helper() }\nfn helper() -> u32 { 42 }",
      },
    ],
    consumerRevision: "c".repeat(40),
    artifacts: [
      { fileName: "ie.dll", sha256: "d".repeat(64), abiVersion: 1, aliasOfCanonicalLibrary: true },
    ],
  });
  expect(graph.scope).toEqual({ source: "graph:iecode-bun-fork", profile: "ie" });
  expect(graph.graph.nodes.length).toBeGreaterThan(
    source.modules.length +
      source.packages.length +
      source.nativeCrates.length +
      source.sourceDelta.length,
  );
  expect(
    graph.graph.links
      .filter((edge) => edge.relation.startsWith("catalog_"))
      .every((edge) => edge.confidence === "INFERRED"),
  ).toBe(true);
  expect(graph.extraction?.parseErrors).toEqual([]);
  expect(graph.sourceFiles).toHaveLength(1);
  expect(
    graph.graph.nodes.filter((node) => !node.id.startsWith("bun-catalog:")).length,
  ).toBeGreaterThan(0);
  expect(graph.artifacts[0]?.fileName).toBe("ie.dll");
});

test("graph rejects provider-session files before extraction", async () => {
  await expect(
    buildForkCapabilityGraph(catalog(), {
      files: [{ path: ".codex/sessions/session.jsonl", content: "private" }],
    }),
  ).rejects.toThrow("selected NIE Rust and Inagle TypeScript source only");
});
