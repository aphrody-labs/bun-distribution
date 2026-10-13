#!/usr/bin/env bun
import { resolve } from "node:path";
import { inspectCargoWorkspace, loadConfig } from "@aphrody/bun-workspace";
import { runProcess } from "@aphrody/bun-workspace/process";

const root = resolve(import.meta.dir, "..");
const env = {
  ...Bun.env,
  CARGO_TARGET_DIR: resolve(root, "target"),
  CARGO_INSTALL_ROOT: resolve(root, "install"),
};

async function run(argv: string[]): Promise<void> {
  const result = await runProcess(argv, root, {
    timeoutMs: 1_800_000,
    maxOutputBytes: 128 * 1024 * 1024,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    env,
  });
  if (result.code !== 0) process.exit(result.code);
}

await run(["git", "submodule", "update", "--init", "--depth", "1"]);
await run([process.execPath, "install", "--frozen-lockfile"]);
await run([process.execPath, "scripts/node-modules.ts"]);
const cargo = await inspectCargoWorkspace(await loadConfig(root), { root, timeoutMs: 60_000 });
console.log(`Cargo workspace: ${cargo.packageNames.length} packages in ${cargo.workspaceRoot}`);
