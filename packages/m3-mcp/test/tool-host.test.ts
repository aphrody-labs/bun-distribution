// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { callM3Tool, listM3Tools } from "../src/tools.ts";

test("the table lists the design tools with JSON schemas", () => {
  const tools = listM3Tools();
  const names = tools.map(tool => tool.name);
  expect(names).toContain("m3_token_lookup");
  expect(names).toContain("m3_os_themes_generate");
  expect(tools.length).toBeGreaterThan(10);
  expect(JSON.stringify(tools[0]?.inputSchema)).toContain("object");
});

test("a call validates its arguments and returns an MCP-shaped result", async () => {
  const ok = await callM3Tool("m3_token_lookup", {
    query: "corner-full",
    limit: 1,
  });
  expect(ok.isError).not.toBe(true);
  expect(JSON.stringify(ok.content)).toContain("9999px");
  expect((await callM3Tool("m3_symbol_svg", { name: "../../private" })).isError).toBe(true);
  expect((await callM3Tool("m3_docs_search", { query: "Material", limit: 501 })).isError).toBe(true);
  expect((await callM3Tool("nope", {})).isError).toBe(true);
});

test("the executable host prints the list and one call result", () => {
  const host = Bun.fileURLToPath(new URL("../src/tool-host.ts", import.meta.url));
  const list = Bun.spawnSync([process.execPath, host, "list"], {
    windowsHide: true,
  });
  expect(JSON.parse(list.stdout.toString()).length).toBeGreaterThan(10);
  const call = Bun.spawnSync([process.execPath, host, "call", "m3_list_packages", "{}"], {
    windowsHide: true,
  });
  expect(JSON.parse(call.stdout.toString()).content[0].type).toBe("text");
});
