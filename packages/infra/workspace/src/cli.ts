#!/usr/bin/env bun
import { runInfra } from "./runtime.ts";

if (process.argv[2] === "optimize") {
  process.exit(await (await import("./optimize.ts")).runOptimize(process.argv.slice(3)));
}

if (process.argv[2] === "code-edit") {
  process.exit((await import("./code-edit.ts")).runCodeEdit(process.argv.slice(3)));
}

if (process.argv[2] === "plugins") {
  process.exit(await (await import("./agent-plugins.ts")).runAgentPlugins(process.argv.slice(3)));
}
if (process.argv[2] === "--help" || process.argv[2] === "-h") {
  console.log(
    "Aphrody workspace: optimize <task> runs the optimization plugin workflow.\nplugins <command> manages user plugins, skills and MCP.\ncode-edit <operation> searches and transforms code using rg, sd, ast-grep and jscodeshift.\nOther commands are delegated to aphrody-infra.",
  );
  process.exit(0);
}
const result = await runInfra({
  args: process.argv.slice(2),
  stdout: "inherit",
  stderr: "inherit",
});
process.exit(result.exitCode);
