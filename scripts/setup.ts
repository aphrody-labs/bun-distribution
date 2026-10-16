#!/usr/bin/env bun
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { inspectCargoWorkspace, loadConfig } from "../packages/bun-workspace/src/index.ts";
import { runProcess } from "../packages/bun-workspace/src/process.ts";
import { inspectSetupSources, materialWebPreparationPlan } from "./setup-submodules.ts";

const root = resolve(import.meta.dir, "..");
const args = Bun.argv.slice(2);
if (args.length && (args.length !== 1 || args[0] !== "--plan")) throw new Error("Usage: bun scripts/setup.ts [--plan]");
const sources = await inspectSetupSources(root);
const material = materialWebPreparationPlan(root);
if (args[0] === "--plan") {
  console.log(JSON.stringify({ root, sources, material, qualification: "source-preflight-only" }, null, 2));
  process.exit(0);
}
if (!sources.ready)
  throw new Error(
    `Setup preserves source owners at different or conflicted revisions:\n${sources.retained.join("\n")}`,
  );
const env = {
  ...Bun.env,
  CARGO_TARGET_DIR: resolve(root, "target"),
  CARGO_INSTALL_ROOT: resolve(root, "install"),
};

async function run(argv: string[], processEnv: Record<string, string | undefined> = env, cwd = root): Promise<void> {
  const result = await runProcess(argv, cwd, {
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
// The retired forge is only a dependency while a declared source still uses it.
// HTTPS/GitHub sources must not require the former workstation SSH tunnel.
const submoduleURLs = await runProcess(
  ["git", "config", "--file", ".gitmodules", "--get-regexp", "^submodule\\..*\\.url$"],
  root,
  { timeoutMs: 15_000, maxOutputBytes: 1024 * 1024 },
);
if (submoduleURLs.code !== 0 && submoduleURLs.code !== 1)
  throw new Error("Cannot inspect declared submodule transports.");
const requiresForge = submoduleURLs.stdout.split(/\r?\n/).some(line => {
  const url = line.slice(line.indexOf(" ") + 1).trim();
  return /^(?:ssh:\/\/(?:[^/@]+@)?|(?:[^@\s]+@)?)bun-forge(?=[:/]|$)/i.test(url);
});
if (process.platform === "win32" && requiresForge) {
  const qualificationEnv = {
    ...env,
    GIT_SSH: undefined,
    GIT_SSH_COMMAND: undefined,
  };
  const configured = await runProcess([process.execPath, "scripts/forge-transport.ts", "configure"], root, {
    timeoutMs: 30000,
    maxOutputBytes: 1048576,
    env: qualificationEnv,
  });
  if (configured.code !== 0) throw new Error("Windows forge transport qualification failed.");
  const proof = JSON.parse(configured.stdout.trim()) as {
    action?: string;
    configured?: boolean;
  };
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
await mkdir(resolve(root, "build/packages"), { recursive: true });
for (const command of material.commands) await run(command.argv, env, command.cwd);
await run([process.execPath, "install", "--frozen-lockfile"]);
await run([process.execPath, "scripts/node-modules.ts"]);
const cargo = await inspectCargoWorkspace(await loadConfig(root), {
  root,
  timeoutMs: 60_000,
  runtimePolicy: "development",
});
console.log(`Cargo workspace: ${cargo.packageNames.length} packages in ${cargo.workspaceRoot}`);
