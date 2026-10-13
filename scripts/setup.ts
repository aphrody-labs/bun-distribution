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

async function run(argv: string[], processEnv: Record<string, string | undefined> = env): Promise<void> {
  const result = await runProcess(argv, root, {
    timeoutMs: 1_800_000,
    maxOutputBytes: 128 * 1024 * 1024,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    env: processEnv,
  });
  if (result.code !== 0) process.exit(result.code);
}

let submoduleEnv: Record<string, string | undefined> = env;
if (process.platform === "win32") {
  const qualificationEnv = { ...env, GIT_SSH: undefined, GIT_SSH_COMMAND: undefined };
  const configured = await runProcess([process.execPath, "scripts/forge-transport.ts", "configure"], root, {
    timeoutMs: 30000,
    maxOutputBytes: 1048576,
    env: qualificationEnv,
  });
  if (configured.code !== 0) throw new Error("Windows forge transport qualification failed.");
  const proof = JSON.parse(configured.stdout.trim()) as { action?: string; configured?: boolean };
  if (proof.action !== "configure" || proof.configured !== true)
    throw new Error("Windows forge transport did not report successful qualification.");
  const transport = await runProcess(["git", "config", "--local", "--get", "core.sshCommand"], root, {
    timeoutMs: 15000,
    maxOutputBytes: 1048576,
    env: qualificationEnv,
  });
  const sshCommand = transport.stdout.trim();
  if (transport.code !== 0 || !sshCommand || sshCommand.includes("\n") || sshCommand.includes("\r"))
    throw new Error("Qualified repository-local SSH transport is unavailable.");
  submoduleEnv = { ...qualificationEnv, GIT_SSH_COMMAND: sshCommand };
}
await run(["git", "submodule", "update", "--init", "--depth", "1"], submoduleEnv);
await run([process.execPath, "install", "--frozen-lockfile"]);
await run([process.execPath, "scripts/node-modules.ts"]);
const cargo = await inspectCargoWorkspace(await loadConfig(root), { root, timeoutMs: 60_000 });
console.log(`Cargo workspace: ${cargo.packageNames.length} packages in ${cargo.workspaceRoot}`);
