import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { workspacePackageManifests } from "./readme";

test("workspace inventory expands patterns and deduplicates overlapping members", () => {
  const root = mkdtempSync(join(tmpdir(), "iecode-inventory-"));
  try {
    for (const path of [
      "packages/nie-ui",
      "packages/inagle-ui",
      "packages/nie-web",
    ]) {
      mkdirSync(join(root, path), { recursive: true });
      writeFileSync(join(root, path, "package.json"), "{}");
    }
    expect(
      workspacePackageManifests(root, [
        "packages/nie-ui",
        "packages/*",
        "packages/nie-web",
      ]),
    ).toEqual([
      "packages/nie-ui/package.json",
      "packages/inagle-ui/package.json",
      "packages/nie-web/package.json",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
