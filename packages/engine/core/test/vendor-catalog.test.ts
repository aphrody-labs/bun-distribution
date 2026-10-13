// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { bunCheckout, generateBunCatalog } from "../../core/src/vendor/catalog";

const roots: string[] = [];
test("Bun checkout discovery follows the relocated workspace and configured owner", () => {
  const parent = mkdtempSync(join(tmpdir(), "yolo-relocated-checkouts-"));
  roots.push(parent);
  const workspace = join(parent, "aphrody");
  const bun = join(parent, "bun");
  mkdirSync(workspace);
  mkdirSync(join(bun, "docs"), { recursive: true });
  expect(bunCheckout({ APHRODY_WORKSPACE_ROOT: workspace })).toBe(bun);
  const configured = join(parent, "custom-bun");
  mkdirSync(join(configured, "docs"), { recursive: true });
  expect(bunCheckout({ APHRODY_WORKSPACE_ROOT: workspace, APHRODY_BUN_CHECKOUT: configured })).toBe(
    configured,
  );
});
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
const sourceRevision = "0123456789abcdef0123456789abcdef01234567";
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "yolo-catalog-format-"));
  roots.push(root);
  for (const directory of ["vendor/bun/docs", "vendor/bun/packages/bun-types", "vendor/bun/.git"])
    mkdirSync(join(root, directory), { recursive: true });
  writeFileSync(join(root, "vendor/bun/docs/fetch.md"), "# Fetch fixture\n");
  writeFileSync(
    join(root, "vendor/bun/packages/bun-types/bun.d.ts"),
    "export declare const fixture: boolean;\n",
  );
  writeFileSync(join(root, "vendor/bun/.git/HEAD"), "ref: refs/heads/main\n");
  writeFileSync(join(root, "vendor/bun/.git/packed-refs"), `${sourceRevision} refs/heads/main\n`);
  return root;
}
test("catalog produces a formatted artifact with source/runtime provenance and stable repeated output", async () => {
  const root = fixture();
  const report = await generateBunCatalog(root);
  expect(report.sourceRevision).toBe(sourceRevision);
  expect(report.bunRevision).toBe(Bun.revision);
  expect(report.totalDocFilesIndexed).toBe(1);
  expect(existsSync(report.targetCatalogPath)).toBe(true);
  const first = await Bun.file(report.targetCatalogPath).text();
  expect(first).toContain(`vendor/bun (commit: ${sourceRevision})`);
  const generated = await import(report.targetCatalogPath);
  expect(generated.MONOREPO_BUN_CATALOG.sourceRevision).toBe(sourceRevision);
  expect(generated.MONOREPO_BUN_CATALOG.bunRevision).toBe(Bun.revision);
  const check = Bun.spawnSync([Bun.which("oxfmt")!, "--check", report.targetCatalogPath], {
    windowsHide: true,
  });
  expect(check.exitCode).toBe(0);
  await generateBunCatalog(root);
  expect(await Bun.file(report.targetCatalogPath).text()).toBe(first);
  expect(readdirSync(join(root, "m3/packages/app-ui/src/generated"))).toEqual(["bun-catalog.ts"]);
});
async function isolatedGeneration(root: string, path: string) {
  const program = `import { generateBunCatalog } from ${JSON.stringify(resolve(import.meta.dir, "../../../../packages/engine/core/src/vendor/catalog.ts"))}; try { await generateBunCatalog(${JSON.stringify(root)}); process.exitCode=0; } catch(error) { console.error(String(error)); process.exitCode=2; }`;
  const child = Bun.spawn([process.execPath, "-e", program], {
    windowsHide: true,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, PATH: path, OXFMT_CALLS: join(root, "formatter-calls") },
  });
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  return { code, stderr };
}
test("missing global formatter is explicit and cannot report an unwritten artifact", async () => {
  const root = fixture();
  const path = join(root, "empty-bin");
  mkdirSync(path);
  const result = await isolatedGeneration(root, path);
  expect(result.code).toBe(2);
  expect(result.stderr).toContain("Installed global oxfmt is required");
  expect(existsSync(join(root, "m3/packages/app-ui/src/generated/bun-catalog.ts"))).toBe(false);
});
test.skipIf(process.platform === "win32")(
  "formatter failure preserves the prior artifact and removes only its unique draft",
  async () => {
    const root = fixture();
    const path = join(root, "bin");
    const directory = join(root, "m3/packages/app-ui/src/generated");
    mkdirSync(path);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "bun-catalog.ts"), "prior artifact\n");
    writeFileSync(join(directory, "concurrent.draft.ts"), "concurrent work\n");
    const formatter = join(path, "oxfmt");
    writeFileSync(
      formatter,
      '#!/bin/sh\nprintf "%s\\n" "$#" > "$OXFMT_CALLS"\nprintf "fixture formatter rejected\\n" >&2\nexit 19\n',
    );
    chmodSync(formatter, 0o755);
    const result = await isolatedGeneration(root, path);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("exit 19");
    expect(await Bun.file(join(root, "formatter-calls")).text()).toBe("1\n");
    expect(await Bun.file(join(directory, "bun-catalog.ts")).text()).toBe("prior artifact\n");
    expect(readdirSync(directory).toSorted()).toEqual(["bun-catalog.ts", "concurrent.draft.ts"]);
  },
);
test("missing checkout data fails before producing a misleading catalog", async () => {
  const root = fixture();
  rmSync(join(root, "vendor/bun/docs"), { recursive: true });
  await expect(generateBunCatalog(root)).rejects.toThrow("source data");
  expect(existsSync(join(root, "m3/packages/app-ui/src/generated/bun-catalog.ts"))).toBe(false);
});
