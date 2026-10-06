#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Exact `tools/list` count of an MCP Streamable HTTP server (`aphrody-mcp http`): the advertised tool set is fixed at
// build time by the Cargo features, so this is the only authoritative way to tell which build is serving.
//   bun scripts/tools/infra/mcp-tools-count.ts [URL] [--expect N] [--names FILE] [--token-env NAME]
// URL defaults to http://127.0.0.1:8789/mcp. `/mcp` needs a Bearer token: --token-env names the environment variable that
// holds it (never an argument, never printed). Prints `tools=<n> unique=<n> server=<name>@<version>`; exits 1 when the
// server is unreachable, lists duplicates, or the count differs from --expect.
// oxlint-disable no-await-in-loop -- the pages of tools/list are read in order.
import { writeFileSync } from "node:fs";

const HEADERS = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
};

export interface ToolsCount {
  server: string;
  tools: string[];
}

async function messages(response: Response): Promise<Array<Record<string, any>>> {
  const text = await response.text();
  if ((response.headers.get("content-type") ?? "").includes("text/event-stream")) {
    return text
      .split("\n")
      .filter((line) => line.startsWith("data:") && line.slice(5).trim())
      .map((line) => JSON.parse(line.slice(5)));
  }
  return text.trim() ? [JSON.parse(text)] : [];
}

export async function countTools(url: string, token?: string): Promise<ToolsCount> {
  const base: Record<string, string> = token
    ? { ...HEADERS, authorization: `Bearer ${token}` }
    : HEADERS;
  const post = (body: unknown, session?: string) =>
    fetch(url, {
      method: "POST",
      headers: session ? { ...base, "mcp-session-id": session } : base,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
  const init = await post({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "mcp-tools-count", version: "1" },
    },
  });
  if (!init.ok) {
    const hint =
      init.status === 401 || init.status === 503 ? " (token missing, wrong or not configured)" : "";
    throw new Error(`initialize: HTTP ${init.status}${hint}`);
  }
  const session = init.headers.get("mcp-session-id") ?? undefined;
  const info = (await messages(init)).find((m) => m.id === 1)?.result?.serverInfo;
  await post({ jsonrpc: "2.0", method: "notifications/initialized" }, session);
  const tools: string[] = [];
  let cursor: string | undefined;
  do {
    const reply = await post(
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: cursor ? { cursor } : {} },
      session,
    );
    const result = (await messages(reply)).find((m) => m.id === 2)?.result;
    if (!result) throw new Error(`tools/list: no result (HTTP ${reply.status})`);
    for (const tool of result.tools) tools.push(tool.name);
    cursor = result.nextCursor;
  } while (cursor);
  if (session)
    await fetch(url, { method: "DELETE", headers: { "mcp-session-id": session } }).catch(() => {});
  return { server: info ? `${info.name}@${info.version}` : "unknown", tools };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const option = (name: string) => {
    const at = args.indexOf(name);
    return at >= 0 ? args[at + 1] : undefined;
  };
  const url =
    args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--")) ??
    "http://127.0.0.1:8789/mcp";
  const expect = option("--expect");
  const tokenEnv = option("--token-env");
  try {
    const token = tokenEnv ? process.env[tokenEnv] : undefined;
    if (tokenEnv && !token) throw new Error(`${tokenEnv} is not set`);
    const { server, tools } = await countTools(url, token);
    const unique = new Set(tools).size;
    console.log(`tools=${tools.length} unique=${unique} server=${server}`);
    const names = option("--names");
    if (names) writeFileSync(names, `${tools.toSorted().join("\n")}\n`);
    if (unique !== tools.length) throw new Error("duplicate tool names");
    if (expect !== undefined && tools.length !== Number(expect)) {
      throw new Error(`expected ${expect} tools, the server advertises ${tools.length}`);
    }
  } catch (error) {
    console.error(`mcp-tools-count: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
