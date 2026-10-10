// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { AgentBrowser } from "../src/client.ts";

test("synchronous launcher captures successful UTF-8 output", () => {
  const result = AgentBrowser.exec(["--version"]);
  expect(result.success).toBe(true);
  expect(result.data).toBe("@aphrody/agent-browser 1.0.0-canary");
});

test("synchronous launcher preserves nonzero exit diagnostics", () => {
  const result = AgentBrowser.exec(["mcp"]);
  expect(result.success).toBe(false);
  expect(result.error).toBe("Browser MCP tools are served by aphrody-mcp.");
});
