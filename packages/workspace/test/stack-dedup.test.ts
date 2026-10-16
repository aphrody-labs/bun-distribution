// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import {
  compareVersions,
  crateTable,
  groupDuplicates,
  jsFindings,
  librariesWithoutDependents,
  olderVersionsPulledDirectly,
  type CargoMetadataLite,
} from "../src/stack-dedup.ts";

const pkg = (
  id: string,
  name: string,
  version = "1.0.0",
  dir = `/r/${name}`,
  kinds = ["lib"],
  publish?: string[] | null,
) => ({
  id,
  name,
  version,
  manifest_path: `${dir}/Cargo.toml`,
  publish,
  targets: [{ kind: kinds }],
});

// app -> ui -> {serde, heavy}; tool -> serde; orphan -> heavy2; serde and old-serde coexist.
const metadata: CargoMetadataLite = {
  packages: [
    pkg("app", "app", "1.0.0", "/r/apps/app", ["bin"]),
    pkg("ui", "ui", "1.0.0", "/r/crates/ui", ["lib"], []),
    pkg("tool", "tool", "1.0.0", "/r/crates/tool"),
    pkg("orphan", "orphan", "1.0.0", "/r/crates/orphan"),
    pkg("serde@1", "serde", "1.2.0", "/c/serde"),
    pkg("serde@0", "serde", "0.9.5", "/c/serde-old"),
    pkg("heavy", "heavy", "2.0.0", "/c/heavy"),
    pkg("heavy-sub", "heavy-sub", "2.0.0", "/c/heavy-sub"),
    pkg("heavy2", "heavy2", "1.0.0", "/c/heavy2"),
  ],
  workspace_members: ["app", "ui", "tool", "orphan"],
  resolve: {
    nodes: [
      { id: "app", deps: [{ pkg: "ui" }] },
      { id: "ui", deps: [{ pkg: "serde@1" }, { pkg: "heavy" }] },
      { id: "tool", deps: [{ pkg: "serde@1" }, { pkg: "serde@0" }] },
      { id: "orphan", deps: [{ pkg: "heavy2" }] },
      { id: "serde@1", deps: [] },
      { id: "serde@0", deps: [] },
      { id: "heavy", deps: [{ pkg: "heavy-sub" }] },
      { id: "heavy-sub", deps: [] },
      { id: "heavy2", deps: [] },
    ],
  },
};

describe("compareVersions", () => {
  test("orders numerically, with pre-releases below the release", () => {
    expect(compareVersions("0.10.0", "0.9.5")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "1.0.0-rc.1")).toBeGreaterThan(0);
    expect(compareVersions("9.0.0-rc.5", "0.9.0")).toBeGreaterThan(0);
    expect(compareVersions("0.25.15+spec-1.1.0", "0.22.27")).toBeGreaterThan(0);
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  });
});

describe("crateTable", () => {
  const rows = crateTable(metadata, "/r");
  const row = (name: string) => rows.find((entry) => entry.name === name)!;

  test("lists direct workspace dependents and the packages only a crate keeps alive", () => {
    expect(row("ui").dependents).toEqual(["app"]);
    // Removing ui also removes app (its dependent): heavy and heavy-sub go, serde stays through tool.
    expect(row("ui").freesPackages).toBe(2);
    expect(row("orphan").freesPackages).toBe(1);
    expect(row("tool").freesPackages).toBe(1); // serde@0 only
    expect(row("app").freesPackages).toBe(0);
  });

  test("keeps relative paths, kinds and the publish flag", () => {
    expect(row("ui")).toMatchObject({
      path: "crates/ui",
      kinds: ["lib"],
      publishable: false,
    });
    expect(row("app")).toMatchObject({
      path: "apps/app",
      kinds: ["bin"],
      publishable: true,
    });
  });

  test("sorts the heaviest first", () => {
    expect(rows[0]!.name).toBe("ui");
  });

  test("finds library crates that nothing depends on, never binaries", () => {
    expect(librariesWithoutDependents(rows)).toEqual(["orphan", "tool"]);
  });
});

describe("olderVersionsPulledDirectly", () => {
  test("names the workspace crate that asks for the older version", () => {
    expect(olderVersionsPulledDirectly(metadata)).toEqual([
      { name: "serde", version: "0.9.5", latest: "1.2.0", pulledBy: ["tool"] },
    ]);
  });

  test("ignores versions only transitive dependencies ask for", () => {
    const transitive: CargoMetadataLite = {
      ...metadata,
      resolve: {
        nodes: metadata.resolve!.nodes.map((node) =>
          node.id === "tool"
            ? { id: "tool", deps: [{ pkg: "serde@1" }, { pkg: "heavy" }] }
            : node.id === "heavy"
              ? {
                  id: "heavy",
                  deps: [{ pkg: "heavy-sub" }, { pkg: "serde@0" }],
                }
              : node,
        ),
      },
    };
    expect(olderVersionsPulledDirectly(transitive)).toEqual([]);
  });
});

const file = (path: string, hash: string, size: number) => ({
  path,
  hash,
  size,
});

describe("groupDuplicates", () => {
  test("groups identical content and counts the bytes of the extra copies", () => {
    const groups = groupDuplicates(
      [
        file("a/x.woff2", "h1", 1000),
        file("b/x.woff2", "h1", 1000),
        file("c/x.woff2", "h1", 1000),
        file("a/y", "h2", 500),
        file("b/y", "h2", 500),
        file("a/z", "h3", 9000),
      ],
      100,
    );
    expect(groups).toEqual([
      { bytes: 2000, copies: ["a/x.woff2", "b/x.woff2", "c/x.woff2"] },
      { bytes: 500, copies: ["a/y", "b/y"] },
    ]);
  });

  test("a same hash with another size is another file, and small files are skipped", () => {
    expect(
      groupDuplicates([file("a", "h", 10), file("b", "h", 10)], 100),
    ).toEqual([]);
    expect(
      groupDuplicates([file("a", "h", 1000), file("b", "h", 2000)], 100),
    ).toEqual([]);
  });
});

describe("jsFindings", () => {
  const summary = {
    versionSpecDifferences: { react: { a: "^19", b: ">=18" } },
    packages: [
      {
        path: "m3/packages/a",
        name: "@x/a",
        sourceFiles: 3,
        imports: [{ packageName: "@x/b" }],
        dependencies: {},
        devDependencies: {},
        peerDependencies: { tailwindcss: "^4" },
        sourceUnmatchedDependencies: ["lodash", "@types/node", "tailwindcss"],
      },
      {
        path: "m3/packages/b",
        name: "@x/b",
        sourceFiles: 2,
        imports: [],
        dependencies: {},
        devDependencies: {},
        peerDependencies: {},
        sourceUnmatchedDependencies: [],
      },
      {
        path: "m3/packages/c",
        name: "@x/c",
        sourceFiles: 4,
        imports: [],
        dependencies: {},
        devDependencies: {},
        peerDependencies: {},
        sourceUnmatchedDependencies: [],
      },
    ],
  };

  test("reports unimported dependencies but not types or peers", () => {
    expect(jsFindings(summary).unusedDependencies).toEqual([
      { package: "@x/a", path: "m3/packages/a", dependencies: ["lodash"] },
    ]);
  });

  test("reports packages that nothing imports or declares", () => {
    expect(
      jsFindings(summary).withoutDependents.map((entry) => entry.package),
    ).toEqual(["@x/a", "@x/c"]);
    expect(jsFindings(summary).versionSpecDifferences).toEqual({
      react: { a: "^19", b: ">=18" },
    });
  });
});
