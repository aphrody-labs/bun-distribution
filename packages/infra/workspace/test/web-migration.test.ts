// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkManifest } from "../src/bun-workspace.ts";
import { scanWebMigration } from "../src/web-migration.ts";

test("missing Bun catalog entry is a non-fixable blocker", () => {
  const root = { packageManager: "bun@1.4.2", workspaces: { catalog: { zod: "^4" } } };
  const packageManifest = {
    name: "@aphrody/web-test",
    engines: { bun: ">=1.4.2" },
    dependencies: { zod: "catalog:", missing: "catalog:", named: "catalog:web" },
  };
  const issues = checkManifest("packages/web/test/package.json", packageManifest, root, {
    hasTsconfig: false,
  });
  expect(issues).toHaveLength(2);
  expect(issues.every((issue) => issue.rule === "catalog" && !issue.fixable)).toBe(true);
  expect(issues.map((issue) => issue.message)).toEqual([
    "dependencies.missing references missing default catalog entry",
    "dependencies.named references missing web catalog entry",
  ]);
});

const put = async (root: string, path: string, content: string) => {
  const full = join(root, path);
  await mkdir(join(full, ".."), { recursive: true });
  await writeFile(full, content);
};

test("Web migration gate inventories source, target, and shared host counts", async () => {
  const temp = await mkdtemp(join(tmpdir(), "aphrody-web-migration-"));
  const source = join(temp, "source");
  const target = join(temp, "target");
  try {
    await put(
      source,
      "crates/source/Cargo.toml",
      '[package]\nname = "aphrody-web-engine"\nversion = "1.0.0"\n',
    );
    await put(source, "packages/x/package.json", '{"name":"@aphrody/x"}');
    await put(source, "packages/xai/package.json", '{"name":"@aphrody/xai"}');
    await put(source, "packages/missing/package.json", '{"name":"@aphrody/missing"}');
    await put(
      target,
      "package.json",
      '{"workspaces":{"packages":["packages/web/*"],"catalog":{"typescript":"7.0.2"}}}',
    );
    await put(
      target,
      "crates/web/engine/Cargo.toml",
      '[package]\nname = "aphrody-web-engine"\nversion = "1.0.0"\n',
    );
    await put(
      target,
      "crates/ai/ffi/Cargo.toml",
      '[package]\nname = "aphrody-ffi"\nversion = "1.0.0"\n[lib]\ncrate-type = ["cdylib"]\n',
    );
    await put(
      target,
      "crates/ai/ffi/src/web.rs",
      '#[unsafe(no_mangle)]\npub extern "C" fn bxc_old() {}\n',
    );
    await put(target, "crates/ai/ffi/include/aphrody.h", "void bxc_old(void);\n");
    await put(
      target,
      "crates/ai/mcp/Cargo.toml",
      '[package]\nname = "aphrody-mcp"\nversion = "1.0.0"\n',
    );
    await put(target, "crates/ai/mcp/src/main.rs", "fn main() {}\n");
    await put(
      target,
      "crates/os/kernel/comps/nested/Cargo.toml",
      '[package]\nname = "nested-mcp"\nversion = "1.0.0"\n[lib]\ncrate-type = ["cdylib"]\n',
    );
    await put(target, "crates/os/kernel/comps/nested/src/main.rs", "fn main() {}\n");
    await put(
      target,
      "crates/os/ostd/sdk/Cargo.toml",
      '[package]\nname = "ostd-sdk"\nversion = "1.0.0"\n[lib]\ncrate-type = ["cdylib"]\n',
    );
    await put(
      target,
      "packages/web/x/package.json",
      '{"name":"@aphrody/x","dependencies":{"typescript":"catalog:"}}',
    );
    await put(target, "packages/ai/xai/package.json", '{"name":"@aphrody/xai"}');
    await put(
      target,
      "packages/web/test/package.json",
      '{"name":"@aphrody/web-test","dependencies":{"absent":"catalog:"}}',
    );
    const report = await scanWebMigration(source, target);
    expect(report.missing.rust).toEqual([]);
    expect(report.missing.bun.map((item) => item.name)).toEqual(["@aphrody/missing"]);
    expect(report.catalogGaps.map((gap) => gap.dependency)).toEqual(["absent"]);
    expect(report.cdylibs.map((item) => item.name)).toEqual([
      "aphrody-ffi",
      "nested-mcp",
      "ostd-sdk",
    ]);
    expect(report.mcpHosts.map((item) => item.name)).toEqual(["aphrody-mcp", "nested-mcp"]);
    expect(report.legacyAbiSymbols.map((item) => item.symbol)).toEqual(["bxc_old", "bxc_old"]);
    expect(report.ready).toBe(false);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
