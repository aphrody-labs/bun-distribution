// SPDX-License-Identifier: Apache-2.0
// Yolo exposes a tool host; aphrody-mcp owns protocol transport.
import { describe, expect, test } from "bun:test";
import { callTool, listTools } from "@aphrody/yolo-core/tool-host";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../../../docs/aphrody");

describe("Yolo tool host of aphrody-mcp", () => {
  test("lists unique tool definitions with input schemas", () => {
    const tools = listTools();
    expect(tools.length).toBeGreaterThan(0);
    expect(new Set(tools.map(tool => tool.name)).size).toBe(tools.length);
    for (const tool of tools) expect(tool.inputSchema.type).toBe("object");
  });
  test("returns an error result for an unknown tool", async () => {
    const result = await callTool("unknown_tool", {}, root);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("unknown_tool");
  });
  test("CLI rejects malformed JSON before invoking a capability", async () => {
    const process = Bun.spawn(["bun", "src/index.ts", "tool", "call", "unknown_tool", "{"], {
      windowsHide: true,
      cwd: resolve(import.meta.dir, ".."),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, status] = await Promise.all([new Response(process.stdout).text(), process.exited]);
    expect(status).toBe(0);
    expect(JSON.parse(stdout).content[0].text).toBe("arguments are not JSON");
    expect(JSON.parse(stdout).isError).toBe(true);
  });
});
