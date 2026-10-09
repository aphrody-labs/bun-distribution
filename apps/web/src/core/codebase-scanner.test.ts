// SPDX-License-Identifier: Apache-2.0
import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanCodebase } from "./codebase-scanner";

const root = mkdtempSync(join(tmpdir(), "aphrody-web-scan-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("scanCodebase", () => {
  it("lists workspace packages and counts their exports", async () => {
    await Bun.write(join(root, "package.json"), JSON.stringify({ workspaces: { packages: ["packages/*"] } }));
    await Bun.write(
      join(root, "packages/a/package.json"),
      JSON.stringify({ name: "@x/a", version: "1.2.3", description: "first" }),
    );
    await Bun.write(
      join(root, "packages/a/src/index.ts"),
      "export type A = string;\nexport interface B { b: number }\nexport function f() {}\nexport async function g() {}\nfunction hidden() {}\n",
    );
    await Bun.write(join(root, "packages/a/src/types.d.ts"), "export type Ignored = number;\n");
    await Bun.write(join(root, "packages/a/node_modules/dep/index.ts"), "export type Ignored = number;\n");
    await Bun.write(join(root, "packages/b/package.json"), JSON.stringify({ name: "@x/b" }));
    await Bun.write(join(root, "packages/b/main.tsx"), "export const x = 1;\n");
    await Bun.write(join(root, "other/c/package.json"), JSON.stringify({ name: "@x/c" }));

    const scan = await scanCodebase(root);

    expect(scan.packages).toEqual([
      { name: "@x/a", version: "1.2.3", description: "first", dir: "packages/a", sourceFiles: 1 },
      { name: "@x/b", version: "", description: "", dir: "packages/b", sourceFiles: 1 },
    ]);
    expect(scan.totalPackages).toBe(2);
    expect(scan.totalTypes).toBe(1);
    expect(scan.totalInterfaces).toBe(1);
    expect(scan.totalFunctions).toBe(2);
  });
});
