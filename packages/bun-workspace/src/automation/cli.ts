#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
import { runInfra } from "./runtime.ts";

export const workspaceHelp =
  "Bun OS workspace: optimize <task> runs the optimization plugin workflow.\nplugins <command> manages user plugins, skills and MCP.\ncode-edit <operation> searches and transforms code using native literal edits, rg, sd (regex), ast-grep and jscodeshift.\nOther commands use the native Bun OS Infra owner.\nUse bun src/cli.ts workspace inventory for the source catalog.";

/** Bun OS workspace commands, with native Infra dispatch for other operations. */
export async function runWorkspace(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === "optimize") return (await import("./optimize.ts")).runOptimize(rest);
  if (command === "code-edit") return (await import("./code-edit.ts")).runCodeEdit(rest);
  if (command === "plugins") return (await import("./agent-plugins.ts")).runAgentPlugins(rest);
  if (command === "--help" || command === "-h") {
    console.log(workspaceHelp);
    return 0;
  }
  const result = await runInfra({
    args: [...argv],
    stdout: "inherit",
    stderr: "inherit",
  });
  return result.exitCode;
}

// Root orchestration imports this runner; direct source execution uses the same owner.
if (import.meta.main) process.exit(await runWorkspace(process.argv.slice(2)));
