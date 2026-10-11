// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { updateMain, validateUpdate } from "./mesh-update.ts";

test("main updates require bounded recurrence and explicit owner paths", () => {
  expect(() => validateUpdate({ repository: "", bundle: "", intervalSeconds: 60 })).toThrow();
  expect(() =>
    validateUpdate({ repository: "repo", bundle: "bundle", intervalSeconds: 0 }),
  ).toThrow();
  expect(() =>
    validateUpdate({ repository: "repo", bundle: "bundle", intervalSeconds: 60.5 }),
  ).toThrow();
  expect(() =>
    validateUpdate({
      repository: tmpdir(),
      bundle: join(tmpdir(), "bundle"),
      intervalSeconds: 900,
    }),
  ).not.toThrow();
});

test("an unrelated remote is rejected before fetch or any change to concurrent source", async () => {
  const root = mkdtempSync(join(tmpdir(), "mesh-update-"));
  try {
    expect(
      Bun.spawnSync(["git", "init", root], { stdout: "ignore", stderr: "ignore" }).exitCode,
    ).toBe(0);
    expect(
      Bun.spawnSync([
        "git",
        "-C",
        root,
        "remote",
        "add",
        "origin",
        "https://example.invalid/unowned/repo.git",
      ]).exitCode,
    ).toBe(0);
    writeFileSync(join(root, "concurrent.txt"), "preserve my work");
    await expect(
      updateMain({ repository: root, bundle: join(root, "bundle"), intervalSeconds: 60 }, root),
    ).rejects.toThrow("authorized Aphrody remote");
    expect(readFileSync(join(root, "concurrent.txt"), "utf8")).toBe("preserve my work");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
