// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { webPipeline, commandPipeline, mcpTool } from "./src/pipeline";
import { loadPipelineSymbols } from "./src/library";
import { close, cstr, trackJob, webJobWait } from "./src/engine";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("invalid or cancelled workflows do not need a native library", async () => {
  await expect(webPipeline([])).rejects.toThrow("1..256");
  await expect(webPipeline(["status"], { timeoutMs: 0 })).rejects.toThrow("uint32");
  const controller = new AbortController();
  controller.abort(new Error("cancelled before submission"));
  await expect(webPipeline(["status"], { signal: controller.signal })).rejects.toThrow("cancelled before submission");
  await expect(mcpTool({ server: "", tool: "x", arguments: {} })).rejects.toThrow("object arguments");
});

let available = false;
try {
  loadPipelineSymbols();
  available = true;
} catch (error) {
  if (process.env.APHRODY_FFI_REQUIRE_NATIVE === "1") throw error;
}
const native = test.skipIf(!available);

native("native workflow returns structured data and frees every tracked handle", async () => {
  const result = await webPipeline<{
    plan: { targets: unknown[] };
    registry: unknown;
  }>(["dragon-ball", "sources"]);
  expect(result.plan.targets.length).toBeGreaterThanOrEqual(20);
  expect(result.registry).toBeDefined();
  await expect(webPipeline(["status"])).rejects.toThrow();
  close();
});

native("library cannot close while a workflow handle is still owned", async () => {
  const id = trackJob(
    Number(loadPipelineSymbols().aphrody_web_pipeline_submit(cstr('["dragon-ball","sources"]'), 1000)),
  );
  expect(() => close()).toThrow("live native resources");
  await webJobWait(id, 2000);
  close();
});

native("GC churn keeps input buffers and the Bun event loop safe", async () => {
  let ticks = 0;
  const timer = setInterval(() => ticks++, 1);
  try {
    for (let i = 0; i < 20; i++) {
      // Each completed job is collected before GC stresses the next borrowed input.
      // eslint-disable-next-line no-await-in-loop
      const result = await webPipeline<{ plan: unknown }>(["dragon-ball", "sources"]);
      expect(result.plan).toBeDefined();
      Bun.gc(true);
    }
    expect(ticks).toBeGreaterThan(0);
  } finally {
    clearInterval(timer);
    close();
  }
});

native("compatibility commands preserve diagnostics without child processes", async () => {
  const [version, invalid] = await Promise.all([
    commandPipeline(["--version"]),
    commandPipeline(["--definitely-invalid-native-option"]),
  ]);
  expect(version.code).toBe(0);
  expect(version.stdout).toContain("aphrody");
  expect(invalid.code).toBe(2);
  expect(invalid.stderr).not.toBe("");
  close();
});

native("native MCP calls retain authentication and sessions and run independently", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aphrody-mcp-ffi-"));
  let active = 0,
    peak = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      expect(request.headers.get("authorization")).toBe("Bearer fixture-only");
      const rpc = (await request.json()) as {
        id?: number;
        method: string;
        params?: { protocolVersion?: string; arguments?: unknown };
      };
      if (rpc.method === "initialize")
        return Response.json(
          {
            jsonrpc: "2.0",
            id: rpc.id,
            result: {
              protocolVersion: rpc.params?.protocolVersion,
              capabilities: { tools: {} },
              serverInfo: { name: "fixture", version: "1" },
            },
          },
          { headers: { "Mcp-Session-Id": "fixture-session" } },
        );
      expect(request.headers.get("mcp-session-id")).toBe("fixture-session");
      if (rpc.method === "notifications/initialized") return new Response(null, { status: 202 });
      expect(rpc.method).toBe("tools/call");
      active++;
      peak = Math.max(peak, active);
      await Bun.sleep(30);
      active--;
      return Response.json({
        jsonrpc: "2.0",
        id: rpc.id,
        result: {
          content: [{ type: "text", text: JSON.stringify(rpc.params?.arguments) }],
        },
      });
    },
  });
  try {
    const config = join(directory, "config.toml");
    const inlineConfig = join(directory, "inline.toml");
    await Bun.write(
      config,
      `[mcp_servers.aphrody]\nurl='http://127.0.0.1:${server.port}/mcp'\n[mcp_servers.aphrody.http_headers]\nAuthorization='Bearer fixture-only'\n`,
    );
    await Bun.write(
      inlineConfig,
      `[mcp_servers.aphrody]\nurl='http://127.0.0.1:${server.port}/mcp'\nhttp_headers={Authorization='Bearer fixture-only'}\n`,
    );
    const values = await Promise.all(
      [config, inlineConfig].map((selectedConfig, index) =>
        mcpTool<{
          content: { text: string }[];
        }>(
          {
            config: selectedConfig,
            server: "aphrody",
            tool: "fixture",
            arguments: { value: index + 1 },
          },
          { timeoutMs: 3000 },
        ),
      ),
    );
    expect(values.map(value => JSON.parse(value.result.content[0]!.text))).toEqual([{ value: 1 }, { value: 2 }]);
    expect(peak).toBe(2);
  } finally {
    await server.stop(true);
    await rm(directory, { recursive: true, force: true });
    close();
  }
});
