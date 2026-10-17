#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * Real tool-call probe of a Docker MCP Toolkit profile through `docker mcp gateway run` (stdio JSON-RPC).
 *
 *   bun scripts/tools/docker-mcp-probe.ts [--profile aphrody]
 *
 * Lists the profile's tools, then calls one harmless tool per server. Exits 1 if any call fails.
 */
import { spawn } from "node:child_process";

export const PROBES: {
  server: string;
  tool: string;
  args: Record<string, unknown>;
}[] = [
  {
    server: "fetch",
    tool: "fetch",
    args: { url: "https://example.com", max_length: 400 },
  },
  {
    server: "context7",
    tool: "resolve-library-id",
    args: { libraryName: "bun", query: "bun test runner" },
  },
  {
    server: "sequentialthinking",
    tool: "sequentialthinking",
    args: {
      thought: "probe",
      nextThoughtNeeded: false,
      thoughtNumber: 1,
      totalThoughts: 1,
    },
  },
  {
    server: "docker-docs",
    tool: "fetch_docker_docs",
    args: { url: "https://docs.docker.com/compose/how-tos/profiles/" },
  },
  { server: "time", tool: "get_current_time", args: { timezone: "UTC" } },
  { server: "github-official", tool: "get_me", args: {} },
];

const profile =
  (process.argv.includes("--profile") ? process.argv[process.argv.indexOf("--profile") + 1] : undefined) ?? "aphrody";
const child = spawn("docker", ["mcp", "gateway", "run", "--profile", profile], {
  stdio: ["pipe", "pipe", "ignore"],
});
let buf = "";
const waiting = new Map<number, (m: any) => void>();
child.stdout.on("data", d => {
  buf += d;
  let i: number;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line.startsWith("{")) continue;
    const m = JSON.parse(line);
    waiting.get(m.id)?.(m);
  }
});
let n = 0;
const rpc = (method: string, params: unknown, ms = 240_000) =>
  new Promise<any>((res, rej) => {
    const id = ++n;
    const t = setTimeout(() => rej(new Error(`timeout ${method}`)), ms);
    waiting.set(id, m => (clearTimeout(t), res(m)));
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });

await rpc("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "probe", version: "1" },
});
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
const tools: string[] = (await rpc("tools/list", {})).result.tools.map((t: any) => t.name);
console.log(`${tools.length} tools: ${tools.join(", ")}`);
let failed = 0;
// Sequential on purpose: one gateway session, ordered output.
for (const p of PROBES) {
  if (!tools.includes(p.tool)) {
    console.log(`FAIL ${p.server}/${p.tool}: absent`);
    failed++;
    continue;
  }
  try {
    // oxlint-disable-next-line no-await-in-loop
    const r = await rpc("tools/call", { name: p.tool, arguments: p.args });
    const text = (r.result?.content ?? [])
      .map((c: any) => c.text ?? "")
      .join("")
      .replace(/\s+/g, " ")
      .slice(0, 100);
    const bad = r.error || r.result?.isError || text.startsWith("Error");
    if (bad) failed++;
    console.log(`${bad ? "FAIL" : "OK  "} ${p.server}/${p.tool}: ${r.error?.message ?? text}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${p.server}/${p.tool}: ${(e as Error).message}`);
  }
}
child.kill();
process.exit(failed ? 1 : 0);
