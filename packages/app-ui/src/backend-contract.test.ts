// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  aphrodyReply,
  aphrodyRpc,
  ensureAphrodyInitialized,
  getRagStats,
  resetAphrodyInitializationForTesting,
} from "./tauri-bridge";
import { parseAgentInventory } from "./backend-inventory";

const originalFetch = globalThis.fetch;
beforeEach(() => {
  (
    window as unknown as { happyDOM: { setURL(url: string): void } }
  ).happyDOM.setURL("http://localhost/?backend=http");
  resetAphrodyInitializationForTesting();
});
afterEach(() => {
  resetAphrodyInitializationForTesting();
  globalThis.fetch = originalFetch;
});

function respond(body: unknown, status = 200) {
  globalThis.fetch = (async () =>
    Response.json(body, { status })) as typeof fetch;
}

test("RPC rejects a missing result instead of claiming success", async () => {
  respond({});
  await expect(aphrodyRpc("model/list")).rejects.toThrow("incomplète");
  respond({ result: { data: [] } });
  expect(await aphrodyRpc("model/list")).toEqual({ data: [] });
});

test("approval replies propagate both HTTP and JSON-RPC errors", async () => {
  respond({}, 503);
  await expect(aphrodyReply({ id: 1, result: {} })).rejects.toThrow("503");
  respond({ error: { message: "Approval expired" } });
  await expect(aphrodyReply({ id: 1, result: {} })).rejects.toThrow(
    "Approval expired",
  );
});

test("shared initialization retries a failed connection and coalesces concurrent routes", async () => {
  respond({ error: { message: "Service unavailable" } });
  await expect(ensureAphrodyInitialized()).rejects.toThrow(
    "Service unavailable",
  );
  const methods: string[] = [];
  globalThis.fetch = (async (_url: unknown, options: RequestInit) => {
    const request = JSON.parse(String(options.body)) as { method: string };
    methods.push(request.method);
    return Response.json(
      request.method === "initialize"
        ? { result: { serverInfo: { name: "aphrody" } } }
        : {},
    );
  }) as typeof fetch;
  await Promise.all([ensureAphrodyInitialized(), ensureAphrodyInitialized()]);
  expect(methods).toEqual(["initialize", "initialized"]);
  respond({ error: { message: "RAG unavailable" } });
  await expect(getRagStats()).rejects.toThrow("RAG unavailable");
  respond({ result: {} });
  await expect(getRagStats()).rejects.toThrow("indisponibles");
});

test("inventory preserves empty and unknown states without demonstration data", () => {
  expect(parseAgentInventory({ data: [] }, { servers: [] })).toEqual({
    tools: [],
    servers: [],
  });
  expect(
    parseAgentInventory(
      { data: [{ name: "read_file", description: "Read a file" }] },
      { servers: [{ name: "local", status: "unknown" }] },
    ),
  ).toEqual({
    tools: [{ name: "read_file", description: "Read a file" }],
    servers: [{ name: "local", status: "unknown" }],
  });
  expect(() => parseAgentInventory({}, { servers: [] })).toThrow("incomplet");
  expect(() => parseAgentInventory({ data: [{}] }, { servers: [] })).toThrow(
    "sans nom",
  );
});

test("web RPC and approval replies use the app-server root from nested UI routes", async () => {
  const urls: string[] = [];
  globalThis.fetch = (async (url: string | URL | Request) => {
    urls.push(String(url));
    return Response.json({ result: { data: [] } });
  }) as typeof fetch;
  await aphrodyRpc("model/list");
  await aphrodyReply({ id: "fixture", result: {} });
  expect(urls).toEqual(["/rpc", "/rpc"]);
});
