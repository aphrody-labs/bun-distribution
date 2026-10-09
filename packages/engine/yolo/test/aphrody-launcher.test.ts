// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { Z1_PENDING_COMMANDS, isLauncher, resolveRustAphrody } from "../../../../bin/aphrody.ts";

const root = resolve(import.meta.dir, "../../../..");

test("the launcher only relays Z1 commands that the dispatcher has and the native bridge does not route", async () => {
  const dispatcher = await Bun.file(resolve(import.meta.dir, "../src/index.ts")).text();
  const cases = new Set([...dispatcher.matchAll(/^\s*case "([^"]+)":/gm)].map(m => m[1]!));
  expect([...Z1_PENDING_COMMANDS].filter(name => !cases.has(name))).toEqual([]);

  const bridge = await Bun.file(resolve(root, "crates/infra/aphrody-command/src/multicall/bun_bridge.rs")).text();
  const routes = bridge.slice(bridge.indexOf("pub(crate) const ROUTES"), bridge.indexOf("const DEPRECATED"));
  const routed = new Set([...routes.matchAll(/\("([^"]+)", "[^"]+"\)/g)].map(m => m[1]!));
  expect(routed.size).toBeGreaterThan(20);
  expect([...Z1_PENDING_COMMANDS].filter(name => routed.has(name))).toEqual([]);
});

test("the Rust aphrody commands never go to yolo", () => {
  for (const name of ["web", "webos", "git", "docs", "scan", "ssh", "infra", "n2b", "mcp", "search", "memory", "ai"]) {
    expect(Z1_PENDING_COMMANDS.has(name)).toBe(false);
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
