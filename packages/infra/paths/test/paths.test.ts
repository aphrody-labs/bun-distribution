// SPDX-License-Identifier: Apache-2.0
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "bun:test";
import { checkoutRoot, findWorkspaceRoot, moduleDirectory, portablePath } from "../src/index.ts";

test("a Bun workspace consumer resolves and bundles the canonical source while Node keeps dist", async () => {
  const root = mkdtempSync(join(tmpdir(), "aphrody-paths-bun-consumer-"));
  try {
    const owner = join(import.meta.dir, "..");
    const scope = join(root, "node_modules/@aphrody");
    mkdirSync(scope, { recursive: true });
    symlinkSync(owner, join(scope, "paths"), process.platform === "win32" ? "junction" : "dir");
    const manifest = JSON.parse(readFileSync(join(owner, "package.json"), "utf8"));
    expect(manifest.files).toContain("src");
    expect(manifest.exports["."].default).toBe("./dist/index.js");
    expect(Bun.resolveSync("@aphrody/paths", root)).toBe(realpathSync(join(owner, "src/index.ts")));
    const entry = join(root, "entry.ts");
    writeFileSync(entry, 'export { checkoutRoot, portablePath } from "@aphrody/paths";');
    const result = await Bun.build({ entrypoints: [entry], target: "bun", format: "esm" });
    expect(result.success).toBe(true);
    const output = join(root, "consumer.mjs");
    await Bun.write(output, result.outputs[0]!);
    const consumer = await import(pathToFileURL(output).href);
    const checkout = join(root, "selected-bun");
    expect(consumer.checkoutRoot("bun", { APHRODY_BUN_CHECKOUT: checkout })).toBe(checkout);
    expect(consumer.portablePath("packages\\web")).toBe("packages/web");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("finds a workspace from a nested source file using all root markers", () => {
  const root = mkdtempSync(join(tmpdir(), "aphrody-paths-"));
  try {
    const nested = join(root, "src", "nested");
    mkdirSync(nested, { recursive: true });
    const source = join(nested, "entry.ts");
    writeFileSync(source, "");
    for (const marker of ["Cargo.toml", "package.json", "rust-toolchain.toml"])
      writeFileSync(join(root, marker), "");
    expect(findWorkspaceRoot(source)).toBe(root);
    expect(moduleDirectory(pathToFileURL(source).href)).toBe(nested);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("portablePath normalizes manifest separators", () => {
  expect(portablePath("crates\\os\\kernel")).toBe("crates/os/kernel");
});

test("Bun and Material follow the selected workspace and explicit configuration", () => {
  const root = mkdtempSync(join(tmpdir(), "aphrody-moved-workspace-"));
  try {
    const env = { APHRODY_WORKSPACE_ROOT: root };
    expect(checkoutRoot("bun", env)).toBe(join(root, "..", "bun"));
    expect(checkoutRoot("material", env)).toBe(join(root, "..", "material"));
    expect(checkoutRoot("m3", env)).toBe(checkoutRoot("material", env));
    expect(checkoutRoot("bun", { ...env, APHRODY_BUN_CHECKOUT: join(root, "custom-bun") })).toBe(
      join(root, "custom-bun"),
    );
    expect(
      checkoutRoot("material", {
        ...env,
        APHRODY_MATERIAL_CHECKOUT: join(root, "custom-material"),
      }),
    ).toBe(join(root, "custom-material"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a deployed resource root needs no source checkout and is independent of cwd", () => {
  const root = mkdtempSync(join(tmpdir(), "aphrody-deployed-"));
  try {
    expect(findWorkspaceRoot(undefined, { APHRODY_WORKSPACE_ROOT: root })).toBe(root);
    expect(findWorkspaceRoot(undefined, { APHRODY_ROOT: root, APHRODY_WORKSPACE_ROOT: " " })).toBe(
      root,
    );
    expect(() => findWorkspaceRoot(undefined, { APHRODY_ROOT: join(root, "missing") })).toThrow(
      "not a directory",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
