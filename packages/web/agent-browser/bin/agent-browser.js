#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
import { spawn } from "node:child_process";
import { prepareAgentBrowserArgs, resolveAgentBrowserBinary } from "../src/client.ts";

const args = process.argv.slice(2);
if (args[0] === "mcp") {
  console.error("Browser MCP tools are served by aphrody-mcp.");
  process.exit(2);
}

let binary;
try {
  binary = resolveAgentBrowserBinary();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const child = spawn(binary, prepareAgentBrowserArgs(args, {}, false), {
  stdio: "inherit",
  windowsHide: false,
});

child.on("error", (error) => {
  console.error(`[aphrody-browser] ${error.message}`);
  process.exit(1);
});
child.on("close", (code) => process.exit(code ?? 0));
