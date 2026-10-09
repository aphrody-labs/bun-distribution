// SPDX-License-Identifier: Apache-2.0
/**
 * Tool host of the single Aphrody MCP server (`aphrody-mcp`): `list` prints the tool definitions
 * as JSON, `call <name> '<json>'` prints one MCP-shaped result (`{content, isError?}`). The same
 * registry feeds `yolo api` (HTTP) and `yolo ai`; no second MCP server lives in this package.
 */
import { yoloHome } from "../vfs/home";
import { TOOLS, ToolExecutionContext, executeTool, type ToolDefinition } from "./registry";

export interface HostResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export function listTools(): readonly ToolDefinition[] {
  return TOOLS;
}

/** Execute one tool; a failure is an `isError` result, never an exception. */
export async function callTool(
  name: string,
  args: unknown,
  rootDir: string = yoloHome(),
  context?: ToolExecutionContext,
): Promise<HostResult> {
  const own = context ?? new ToolExecutionContext();
  try {
    const result = await executeTool(
      name,
      (args === undefined || args === null ? {} : args) as Record<string, unknown>,
      rootDir,
      own,
    );
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    return {
      content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
      isError: true,
    };
  } finally {
    if (!context) own.close();
  }
}

/** `yolo tool list | call <tool-name> '<json-object>'`. */
export async function runToolHost(args: string[], rootDir: string): Promise<number> {
  if (args[0] === "list" && args.length === 1) {
    console.log(JSON.stringify(listTools()));
    return 0;
  }
  if (args[0] === "call" && args.length >= 2 && args.length <= 3) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(args[2] ?? "{}");
    } catch {
      console.log(
        JSON.stringify({
          content: [{ type: "text", text: "arguments are not JSON" }],
          isError: true,
        }),
      );
      return 0;
    }
    console.log(JSON.stringify(await callTool(args[1]!, parsed, rootDir)));
    return 0;
  }
  console.error("Usage: yolo tool list | call <tool-name> '<json-object>'");
  return 2;
}
