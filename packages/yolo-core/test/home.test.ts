import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findCheckout } from "../src/vfs/home.ts";

test("flat Bun OS checkout detection uses the source lock and real CLI owner", () => {
  const root = mkdtempSync(join(tmpdir(), "bun-os-home-"));
  try {
    mkdirSync(join(root, "packages/yolo-cli/src"), { recursive: true });
    writeFileSync(join(root, "sources.lock.json"), "{}");
    expect(findCheckout(root)).toBeNull();
    writeFileSync(join(root, "packages/yolo-cli/src/index.ts"), "export {};");
    expect(findCheckout(join(root, "packages/yolo-cli/src"))).toBe(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
