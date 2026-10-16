import { expect, test } from "bun:test";
import { generateForkCapabilityArtifacts } from "./fork-capabilities";
import type { ForkCapabilityCatalog } from "../ffi/fork-runtime";

test("documentation preserves every inventory section and native witness without upgrading evidence", () => {
  const catalog: ForkCapabilityCatalog = {
    schemaVersion: 1,
    repository: "aphrody-labs/bun",
    source: {
      revision: "a".repeat(40),
      upstreamRevision: "b".repeat(40),
      mergeBase: "c".repeat(40),
      dirty: false,
      trackedFileCount: 5,
    },
    modules: [{ name: "bun:python", source: "src/js/bun/python.ts", sha256: "d".repeat(64) }],
    packages: [
      {
        name: "@aphrody/unversioned",
        version: null,
        manifest: "packages/private/package.json",
        sha256: "e".repeat(64),
      },
    ],
    nativeCrates: [
      {
        name: "bun-python-host",
        manifest: "packages/bun-python-native/Cargo.toml",
        sha256: "f".repeat(64),
        crateTypes: ["cdylib"],
      },
    ],
    sourceDelta: [{ status: "A", path: "src/js/bun/python.ts" }],
    coverage: { modules: 1, packages: 1, nativeCrates: 1, sourceDelta: 1 },
  };
  const artifacts = generateForkCapabilityArtifacts({
    catalog,
    runtimeRevision: "0".repeat(40),
    artifacts: [{ fileName: "ie.dll", sha256: "1".repeat(64), abiVersion: 1, aliasOfCanonicalLibrary: true }],
  });
  const markdown = artifacts["FORK-CAPABILITIES.md"]!;
  expect(markdown).toContain("bun:python");
  expect(markdown).toContain("@aphrody/unversioned");
  expect(markdown).toContain("bun-python-host");
  expect(markdown).toContain("source-only");
  expect(markdown).toContain("revisions match: false");
  expect(markdown).toContain("ie.dll");
  expect(JSON.parse(artifacts["FORK-CAPABILITIES.json"]!).catalog).toEqual(catalog);
});
