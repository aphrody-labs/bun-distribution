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

async function message(response: Response, id: number): Promise<Record<string, any> | undefined> {
  const find = (value: any) => (Array.isArray(value) ? value : [value]).find(item => item?.id === id);
  if (!(response.headers.get("content-type") ?? "").includes("text/event-stream")) {
    const text = await response.text();
    return text.trim() ? find(JSON.parse(text)) : undefined;
  }
  if (!response.body) return undefined;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let data: string[] = [];
  const dispatch = () => {
    const payload = data.join("\n");
    data = [];
    return payload.trim() ? find(JSON.parse(payload)) : undefined;
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      let newline: RegExpExecArray | null;
      while ((newline = /\r\n|\r|\n/.exec(pending))) {
        if (!done && newline[0] === "\r" && newline.index === pending.length - 1) break;
        const line = pending.slice(0, newline.index);
        pending = pending.slice(newline.index + newline[0].length);
        if (line === "") {
          const reply = dispatch();
          if (reply) return reply;
        } else if (line === "data" || line.startsWith("data:")) {
          data.push(line.slice(5).replace(/^ /, ""));
        }
      }
      if (done) return undefined;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function result(response: Response, id: number, method: string): Promise<Record<string, any>> {
  if (!response.ok) {
    await response.body?.cancel();
    const hint = response.status === 401 || response.status === 503 ? " (token missing, wrong or not configured)" : "";
    throw new Error(`${method}: HTTP ${response.status}${hint}`);
  }
  const reply = await message(response, id);
  if (reply?.error) {
    throw new Error(`${method}: JSON-RPC ${reply.error.code}: ${reply.error.message}`);
  }
  if (!reply?.result) throw new Error(`${method}: no result (HTTP ${response.status})`);
  return reply.result;
}

export async function countTools(url: string, token?: string): Promise<ToolsCount> {
  const base: Record<string, string> = token ? { ...HEADERS, authorization: `Bearer ${token}` } : HEADERS;
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
  const session = init.headers.get("mcp-session-id") ?? undefined;
  try {
    const info = (await result(init, 1, "initialize")).serverInfo;
    const initialized = await post({ jsonrpc: "2.0", method: "notifications/initialized" }, session);
    await initialized.body?.cancel();
    if (!initialized.ok) throw new Error(`notifications/initialized: HTTP ${initialized.status}`);
    const tools: string[] = [];
    let cursor: string | undefined;
    do {
      const reply = await post(
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/list",
          params: cursor ? { cursor } : {},
        },
        session,
      );
      const page = await result(reply, 2, "tools/list");
      for (const tool of page.tools) tools.push(tool.name);
      cursor = page.nextCursor;
    } while (cursor);
    return { server: info ? `${info.name}@${info.version}` : "unknown", tools };
  } finally {
    if (session)
      await fetch(url, {
        method: "DELETE",
        headers: { ...base, "mcp-session-id": session },
        signal: AbortSignal.timeout(20_000),
      })
        .then(response => response.body?.cancel())
        .catch(() => {});
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const option = (name: string) => {
    const at = args.indexOf(name);
    return at >= 0 ? args[at + 1] : undefined;
  };
  const url = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--")) ?? "http://127.0.0.1:8789/mcp";
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
