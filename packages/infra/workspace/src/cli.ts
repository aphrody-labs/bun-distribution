#!/usr/bin/env bun
import { runInfra } from "./runtime.ts";

if (process.argv[2] === "plugins") {
  process.exit(await (await import("./agent-plugins.ts")).runAgentPlugins(process.argv.slice(3)));
}
if (process.argv[2] === "--help" || process.argv[2] === "-h") {
  console.log(
    "Aphrody workspace: plugins <command> manages user plugins, skills and MCP.\nOther commands are delegated to aphrody-infra.",
  );
}
const result = await runInfra({
  args: process.argv.slice(2),
  stdout: "inherit",
  stderr: "inherit",
});
process.exit(result.exitCode);
