// SPDX-License-Identifier: Apache-2.0
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkAll, exportTargets, matchExportKey, splitSpecifier } from "./check-exports.ts";

const root = mkdtempSync(join(tmpdir(), "check-exports-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function write(path: string, text: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}
const json = (value: unknown) => JSON.stringify(value, null, 2);

// A synthetic repository: `a` is complete, `b` imports `a` badly and is incomplete.
write(
  "package.json",
  json({
    name: "fixture",
    private: true,
    workspaces: { packages: ["packages/*"], catalog: { react: "^19.0.0" } },
  }),
);
write(
  "packages/a/package.json",
  json({
    name: "@fx/a",
    version: "1.0.0",
    exports: {
      ".": { bun: "./src/index.ts", default: "./dist/index.js" },
      "./util": "./src/util.ts",
      "./assets/*": "./assets/*",
    },
    scripts: { build: "tsup", test: "bun test", typecheck: "tsc --noEmit" },
    dependencies: { react: "catalog:" },
  }),
);
write("packages/a/README.md", "# a\n");
write("packages/a/src/index.ts", 'export * from "./util.ts";\n');
write("packages/a/src/util.ts", "export const x = 1;\n");
write("packages/a/assets/logo.svg", "<svg/>");
write("packages/a/test/a.test.ts", 'import { x } from "../src/index.ts";\n');
write(
  "packages/b/package.json",
  json({
    name: "@fx/b",
    version: "1.0.0",
    main: "./src/missing.ts",
    scripts: {},
    dependencies: { "@fx/ghost": "workspace:*", lodash: "catalog:" },
  }),
);
write("packages/b/src/index.ts", 'import "@fx/a";\nimport "./nope";\nimport "./addon.node";\n');

describe("exports helpers", () => {
  test("exportTargets flattens subpaths and conditions", () => {
    expect(
      exportTargets({
        ".": { bun: "./src/i.ts", default: "./dist/i.js" },
        "./x": "./x.ts",
      }),
    ).toEqual([
      [".", "bun", "./src/i.ts"],
      [".", "default", "./dist/i.js"],
      ["./x", "", "./x.ts"],
    ]);
    expect(exportTargets("./i.ts")).toEqual([[".", "", "./i.ts"]]);
  });
  test("matchExportKey handles exact keys and one wildcard", () => {
    expect(matchExportKey("./util", "./util")).toBe("");
    expect(matchExportKey("./assets/*", "./assets/logo.svg")).toBe("logo.svg");
    expect(matchExportKey("./assets/*", "./other")).toBeNull();
  });
  test("splitSpecifier separates scoped names and subpaths", () => {
    expect(splitSpecifier("@fx/a/util")).toEqual({
      name: "@fx/a",
      subpath: "./util",
    });
    expect(splitSpecifier("react")).toEqual({ name: "react", subpath: "." });
  });
});

describe("checkAll on a synthetic repository", () => {
  const { packages, findings } = checkAll(root);
  const messages = (pkg: string) => findings.filter(f => f.pkg === pkg).map(f => `${f.check}: ${f.message}`);

  test("a complete package has no findings (dist targets backed by a build and a source)", () => {
    expect(packages).toBe(2);
    expect(messages("packages/a")).toEqual([]);
  });
  test("an incomplete package reports every gap", () => {
    const b = messages("packages/b");
    expect(b).toContain("manifest: README.md missing");
    expect(b).toContain("manifest: no test script");
    expect(b).toContain("manifest: no typecheck or build script");
    expect(b.some(m => m.startsWith("entries: main -> ./src/missing.ts"))).toBe(true);
    expect(b.some(m => m.includes("@fx/ghost@workspace:*"))).toBe(true);
    expect(b.some(m => m.includes("lodash@catalog: not in the root catalog"))).toBe(true);
    expect(b.some(m => m.includes("imports @fx/a but @fx/a is not declared"))).toBe(true);
    expect(b.some(m => m.includes("relative import ./nope does not resolve"))).toBe(true);
    // Platform addons are optional by design.
    expect(b.some(m => m.includes("addon.node"))).toBe(false);
  });
});
