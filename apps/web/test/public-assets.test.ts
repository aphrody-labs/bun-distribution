// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { resolvePublicAsset } from "../src/os/public-assets";

let fixture: string;
let root: string;
beforeAll(async () => {
  fixture = await mkdtemp(join(tmpdir(), "aphrody-public-assets-"));
  root = join(fixture, "dist");
  const outside = join(fixture, "outside");
  await Promise.all([mkdir(root), mkdir(outside)]);
  await Promise.all([
    writeFile(join(root, "public.js"), "public fixture"),
    writeFile(join(outside, "private.txt"), "protected fixture"),
  ]);
  await symlink(outside, join(root, "escape"), process.platform === "win32" ? "junction" : "dir");
});
afterAll(async () => {
  if (!fixture) return;
  if (
    resolve(dirname(fixture)) !== resolve(tmpdir()) ||
    !basename(fixture).startsWith("aphrody-public-assets-")
  ) {
    throw new Error("Refusing to remove a directory outside this test fixture");
  }
  await rm(fixture, { recursive: true, force: true });
});

test("resolves only public dist files", async () => {
  expect(await resolvePublicAsset(root, "public.js")).toBe(await realpath(join(root, "public.js")));
  expect(await resolvePublicAsset(root, "missing.js")).toBeNull();
});
test("rejects traversal, encoded separators and absolute host paths", async () => {
  await Promise.all(
    [
      "../outside/private.txt",
      "..%2foutside%2fprivate.txt",
      "..%5coutside%5cprivate.txt",
      "C:/Users/private.txt",
      "/etc/passwd",
      "%00",
      "%not-valid",
    ].map(async (path) => {
      expect(await resolvePublicAsset(root, path)).toBeNull();
    }),
  );
});
test("rejects symlinks escaping the public dist tree", async () => {
  expect(await resolvePublicAsset(root, "escape/private.txt")).toBeNull();
});
