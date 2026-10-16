// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  RELAY_COMMANDS,
  isLauncher,
  resolveRustAphrody,
} from "../../../scripts/aphrody/dev/cli/aphrody.ts";

const root = resolve(import.meta.dir, "../../../docs/aphrody");

test("the launcher only relays commands that the dispatcher has", async () => {
  const dispatcher = await Bun.file(resolve(import.meta.dir, "../src/index.ts")).text();
  const cases = new Set([...dispatcher.matchAll(/^\s*case "([^"]+)":/gm)].map((m) => m[1]!));
  expect([...RELAY_COMMANDS].toSorted()).toEqual(["bench", "rename", "verify"]);
  expect([...RELAY_COMMANDS].filter((name) => !cases.has(name))).toEqual([]);
});

test("the Rust aphrody commands and the Bun fork commands never go to yolo", () => {
  for (const name of [
    "web",
    "webos",
    "git",
    "docs",
    "scan",
    "ssh",
    "infra",
    "n2b",
    "mcp",
    "search",
    "memory",
    "ai",
    "parse",
    "create",
  ]) {
    expect(RELAY_COMMANDS.has(name)).toBe(false);
  }
});

test("the launcher and its wrappers are never resolved as the native binary", () => {
  expect(isLauncher(resolve(root, "scripts/dev/cli/aphrody.ts"), root)).toBe(true);
  expect(isLauncher(resolve(root, "scripts/dev/cli/aphrody"), root)).toBe(true);
  expect(isLauncher(resolve(root, "scripts/dev/cli/aphrody.cmd"), root)).toBe(true);
  expect(isLauncher(resolve(root, "scripts/dev/cli/yolo"), root)).toBe(true);
  expect(isLauncher(resolve(root, "scripts/dev/cli/yolo.cmd"), root)).toBe(true);
  expect(isLauncher(resolve(root, "target/release/aphrody"), root)).toBe(false);

  const resolved = resolveRustAphrody(root, {
    APHRODY_BIN: resolve(root, "scripts/dev/cli/aphrody.cmd"),
    PATH: resolve(root, "scripts/dev/cli"),
    HOME: resolve(root, "does-not-exist"),
    LOCALAPPDATA: resolve(root, "does-not-exist"),
  });
  if (resolved !== null) expect(isLauncher(resolved, root)).toBe(false);
});
