// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanImportsExports } from "../../src/automation/imports-exports.ts";

test("Bun builtins and script toolchains are not stale dependencies", async () => {
  const root = await mkdtemp(join(tmpdir(), "aphrody-imports-web-"));
  try {
    await mkdir(join(root, "packages/web/example/src"), { recursive: true });
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        name: "fixture",
        private: true,
        workspaces: ["packages/web/*"],
      }),
    );
    await writeFile(
      join(root, "packages/web/example/package.json"),
      JSON.stringify({
        name: "@aphrody/example",
        devDependencies: { typescript: "7.0.0" },
      }),
    );
    await writeFile(
      join(root, "packages/web/example/src/index.ts"),
      'import { Glob } from "bun";\nexport const glob = Glob;\n',
    );
    const report = await scanImportsExports(root, "@aphrody/example");
    expect(report.packages).toHaveLength(1);
    expect(report.packages[0]?.unlistedExternalImports).toEqual([]);
    expect(report.packages[0]?.sourceUnmatchedDependencies).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
