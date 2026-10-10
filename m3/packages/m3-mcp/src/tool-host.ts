#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Tool host protocol of the single Aphrody MCP server: `list` prints the tool definitions as JSON,
// `call <name> '<json>'` prints one MCP-shaped result (`{content, isError?}`) and exits 0.
import { callM3Tool, listM3Tools } from "./tools";

const [command, name, json] = Bun.argv.slice(2);
if (command === "list") {
  console.log(JSON.stringify(listM3Tools()));
} else if (command === "call" && name) {
  let args: unknown;
  try {
    args = JSON.parse(json ?? "{}");
  } catch {
    console.log(
      JSON.stringify({
        content: [{ type: "text", text: "arguments are not JSON" }],
        isError: true,
      }),
    );
    process.exit(0);
  }
  console.log(JSON.stringify(await callM3Tool(name, args)));
} else {
  console.error("Usage: tool-host.ts list | call <tool-name> '<json-object>'");
  process.exitCode = 2;
}
