// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createM3McpServer } from "../src/server.ts";

test("the design server supports imported composition and a real MCP tool round trip", async () => {
  const server = createM3McpServer();
  const client = new Client({ name: "m3-test", version: "1.0.0" });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toContain("m3_token_lookup");
    expect(tools.tools.map((tool) => tool.name)).toContain("m3_os_themes_generate");
    const result = await client.callTool({
      name: "m3_token_lookup",
      arguments: { query: "corner-full", limit: 1 },
    });
    expect(result.isError).not.toBe(true);
    expect(JSON.stringify(result.content)).toContain("9999px");
    const invalid = await client.callTool({
      name: "m3_symbol_svg",
      arguments: { name: "../../private" },
    });
    expect(invalid.isError).toBe(true);
    const oversized = await client.callTool({
      name: "m3_docs_search",
      arguments: { query: "Material", limit: 501 },
    });
    expect(oversized.isError).toBe(true);
  } finally {
    await client.close();
    await server.close();
  }
});

test("the executable entry completes stdio handshake, discovery and tool execution", async () => {
  const client = new Client({ name: "m3-stdio-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [new URL("../src/server.ts", import.meta.url).pathname],
    stderr: "pipe",
  });
  try {
    await client.connect(transport);
    expect((await client.listTools()).tools.length).toBeGreaterThan(10);
    const result = await client.callTool({ name: "m3_list_packages", arguments: {} });
    expect(result.isError).not.toBe(true);
    expect(JSON.stringify(result.content)).toContain("@aphrody/m3-mcp");
  } finally {
    await client.close();
  }
}, 10_000);
