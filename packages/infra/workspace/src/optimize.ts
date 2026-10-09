#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
import { resolve } from "node:path";

export const optimizeHelp = `Usage: yolo optimize [--print] [--] <bounded task>
Reuse the optimize-workspace plugin skill through aphrody exec.
--print prints the instructions without starting an agent.
The current directory defines the workspace; existing AGENTS/PLAN remain authoritative.`;

export function optimizationPrompt(task: string): string {
  if (!task.trim()) throw new Error("Provide a bounded optimization task. Use --help for usage.");
  return `Use the optimize-workspace skill from the Aphrody plugin (aphrody:optimize-workspace). Follow the selected repository's AGENTS.md, PLAN.md and MEMORY.md. Reuse Workspace/Infra and existing capability owners; batch searches and transformations; prefer native Bun APIs and qualified existing packages over rewrites. Complete scoped implementation and behavior gates, preserve concurrent edits, and report measured evidence and remaining limits. Commit only completed owned files when authorized; do not publish or rewrite history. Task follows as user instructions:\n\n${task}`;
}

export async function runOptimize(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(optimizeHelp);
    return 0;
  }
  const print = args[0] === "--print";
  const rest = print ? args.slice(1) : args;
  const taskArgs = rest[0] === "--" ? rest.slice(1) : rest;
  if (taskArgs[0]?.startsWith("-")) throw new Error("Unknown option; put literal task text after --.");
  const prompt = optimizationPrompt(taskArgs.join(" "));
  if (print) {
    console.log(prompt);
    return 0;
  }
  const binary = Bun.which("aphrody");
  if (!binary) throw new Error("aphrody is unavailable; install the capability-owner CLI first.");
  const child = Bun.spawn([binary, "exec", "--cd", resolve(process.cwd()), prompt], {
    windowsHide: true,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return await child.exited;
}

// Direct execution remains for the installed link ~/.local/bin/aphrody-optimize until hosts use `yolo optimize`.
if (import.meta.main) {
  try {
    process.exit(await runOptimize(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
