// SPDX-License-Identifier: Apache-2.0
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "bun:test";
import { findWorkspaceRoot, moduleDirectory, portablePath } from "../src/index.ts";

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
  expect(portablePath("crates\\os\\kernel")).toBe("crates/os/kernel/core");
});
