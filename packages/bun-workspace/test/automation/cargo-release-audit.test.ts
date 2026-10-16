// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  auditCargoRelease,
  classifyRequirements,
  type ReleaseMetadata,
} from "../../src/automation/cargo-release-audit.ts";

test("Cargo caret intersections retain compatible floors and expose disjoint pre-1.0 ranges", () => {
  expect(classifyRequirements(["^1.0", "^1.2.3"])).toMatchObject({
    status: "overlapping-caret-ranges",
    candidateMinimum: "1.2.3",
  });
  expect(classifyRequirements(["^0.2", "^0.2.32"])).toMatchObject({
    status: "overlapping-caret-ranges",
    candidateMinimum: "0.2.32",
  });
  expect(classifyRequirements(["^0", "^0.4"])).toMatchObject({
    status: "overlapping-caret-ranges",
  });
  expect(classifyRequirements(["^0.0", "^0.0.3"])).toMatchObject({
    status: "overlapping-caret-ranges",
  });
  expect(classifyRequirements(["^0.8.4", "^0.9"])).toMatchObject({
    status: "disjoint-caret-ranges",
    candidateMinimum: null,
  });
  expect(classifyRequirements(["^0.0.3", "^0.0.4"])).toMatchObject({
    status: "disjoint-caret-ranges",
  });
  expect(classifyRequirements([">=1,<1.13", "^1.13"])).toMatchObject({
    status: "requires-review",
    candidateMinimum: null,
  });
  expect(classifyRequirements(["^1.0.0-canary", "^1.0"])).toMatchObject({
    status: "requires-review",
  });
});

test("audit respects inherited aliases, target dependencies and dev publication exceptions", async () => {
  const root = await mkdtemp(join(tmpdir(), "aphrody-release-"));
  try {
    await mkdir(join(root, "core"));
    await writeFile(
      join(root, "Cargo.toml"),
      '[workspace]\nmembers=["core"]\n[workspace.dependencies]\nalias={package="core",path="core",version="0.1.0"}\n',
    );
    await writeFile(
      join(root, "core/Cargo.toml"),
      '[package]\nname="core"\nversion="0.1.0"\npublish=true\n[dependencies]\nalias.workspace=true\n[target.\'cfg(windows)\'.build-dependencies]\nmissing={path=".",version="*"}\n[dev-dependencies]\ntestgit={git="https://example.test/source"}\n',
    );
    const meta: ReleaseMetadata = {
      workspace_root: root,
      workspace_members: ["core"],
      resolve: null,
      packages: [
        {
          id: "core",
          name: "core",
          version: "0.1.0",
          manifest_path: join(root, "core/Cargo.toml"),
          publish: null,
          dependencies: [
            {
              name: "core",
              rename: "alias",
              kind: null,
              target: null,
              req: "^0.1.0",
              path: join(root, "core"),
              source: null,
            },
            {
              name: "missing",
              rename: null,
              kind: "build",
              target: "cfg(windows)",
              req: "*",
              path: join(root, "core"),
              source: null,
            },
            {
              name: "testgit",
              rename: null,
              kind: "dev",
              target: null,
              req: "*",
              source: "git+https://example.test/source",
            },
          ],
        },
      ],
    };
    const report = await auditCargoRelease(meta);
    expect(report.summary).toMatchObject({
      members: 1,
      cratesIoAllowed: 1,
      missingRegistryVersionEdges: 0,
      wildcardRegistryVersionEdges: 1,
      gitEdges: 1,
      pathEdges: 2,
    });
    expect(report.locations[0]).toMatchObject({
      dependency: "core",
      versionMissing: false,
      localVersion: "0.1.0",
    });
    expect(report.locations[2]).toMatchObject({
      kind: "dev",
      versionMissing: true,
      publicationRequired: false,
    });
    expect(report.resolutionVerified).toBe(false);
    expect(report.manifestHashes["core/Cargo.toml"]).toHaveLength(64);
    await expect(auditCargoRelease(meta, join(root, "other"))).rejects.toThrow("another workspace");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
