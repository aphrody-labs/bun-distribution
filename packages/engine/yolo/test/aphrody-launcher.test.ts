// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  RUST_OWNED_SHARED_COMMANDS,
  YOLO_ONLY_COMMANDS,
  isLauncher,
  resolveRustAphrody,
} from "../../../../bin/aphrody.ts";

const root = resolve(import.meta.dir, "../../../..");

test("every yolo dispatcher command is routed either to yolo or to the Rust binary", async () => {
  const source = await Bun.file(resolve(import.meta.dir, "../src/index.ts")).text();
  const commands = new Set([...source.matchAll(/^\s*case "([^"]+)":/gm)].map(m => m[1]!));
  const unrouted = [...commands].filter(name => !YOLO_ONLY_COMMANDS.has(name) && !RUST_OWNED_SHARED_COMMANDS.has(name));
  expect(unrouted).toEqual([]);
  expect([...YOLO_ONLY_COMMANDS].filter(name => !commands.has(name))).toEqual([]);
  expect([...YOLO_ONLY_COMMANDS].filter(name => RUST_OWNED_SHARED_COMMANDS.has(name))).toEqual([]);
});

test("the Rust aphrody commands never go to yolo", () => {
  for (const name of ["web", "git", "docs", "scan", "ssh", "infra", "n2b", "mcp", "search", "memory", "graph"]) {
    expect(YOLO_ONLY_COMMANDS.has(name)).toBe(false);
  }
});

test("the launcher and its wrappers are never resolved as the native binary", () => {
  expect(isLauncher(resolve(root, "bin/aphrody.ts"), root)).toBe(true);
  expect(isLauncher(resolve(root, "bin/aphrody"), root)).toBe(true);
  expect(isLauncher(resolve(root, "bin/aphrody.cmd"), root)).toBe(true);
  expect(isLauncher(resolve(root, "target/release/aphrody"), root)).toBe(false);

  const resolved = resolveRustAphrody(root, {
    APHRODY_BIN: resolve(root, "bin/aphrody.ts"),
    PATH: resolve(root, "bin"),
    HOME: resolve(root, "does-not-exist"),
    LOCALAPPDATA: resolve(root, "does-not-exist"),
  });
  if (resolved !== null) expect(isLauncher(resolved, root)).toBe(false);
});
