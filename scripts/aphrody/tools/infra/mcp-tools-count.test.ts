// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { countTools } from "./mcp-tools-count.ts";

const encoder = new TextEncoder();

describe("MCP HTTP tools count", () => {
  test("finishes paginated SSE responses while the server keeps every stream open", async () => {
    const controllers: ReadableStreamDefaultController<Uint8Array>[] = [];
    const timers: ReturnType<typeof setTimeout>[] = [];
    const requests: {
      method: string;
      authorization: string | null;
      session: string | null;
    }[] = [];
    let pages = 0;
    let closed = false;
    const openSse = (data: string) =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controllers.push(controller);
            const bytes = encoder.encode(data);
            for (let offset = 0; offset < bytes.length; offset += 7) {
              const chunk = bytes.slice(offset, offset + 7);
              timers.push(setTimeout(() => controller.enqueue(chunk), offset / 7));
            }
          },
        }),
        {
          headers: {
            "content-type": "text/event-stream",
            "mcp-session-id": "fixture-session",
          },
        },
      );
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        requests.push({
          method: request.method,
          authorization: request.headers.get("authorization"),
          session: request.headers.get("mcp-session-id"),
        });
        if (request.method === "DELETE") return new Response(null, { status: 204 });
        const body = await request.json();
        if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
        if (body.method === "initialize") {
          return openSse(
            ': keepalive\ndata: {"jsonrpc":"2.0","method":"notifications/message","params":{}}\n\n' +
              'data: {"jsonrpc":"2.0","id":1,\ndata: "result":{"serverInfo":{"name":"Aphrødÿ","version":"test"}}}\n\n',
          );
        }
        pages++;
        expect(body.params).toEqual(pages === 1 ? {} : { cursor: "next-page" });
        return openSse(
          'event: message\r\ndata: {"jsonrpc":"2.0","id":99,"result":{}}\r\n\r\n' +
            `data: ${JSON.stringify({
              jsonrpc: "2.0",
              id: 2,
              result: {
                tools: [{ name: pages === 1 ? "first" : "second" }],
                ...(pages === 1 ? { nextCursor: "next-page" } : {}),
              },
            })}\r\n\r\n`,
        );
      },
    });
    const deadline = setTimeout(() => {
      closed = true;
      for (const controller of controllers) controller.close();
    }, 1_500);
    try {
      expect(await countTools(new URL("mcp", server.url).href, "fixture-token")).toEqual({
        server: "Aphrødÿ@test",
        tools: ["first", "second"],
      });
      expect(closed).toBe(false);
      expect(controllers).toHaveLength(3);
      expect(requests.every(request => request.authorization === "Bearer fixture-token")).toBe(true);
      expect(requests.slice(1).every(request => request.session === "fixture-session")).toBe(true);
      expect(requests.at(-1)?.method).toBe("DELETE");
    } finally {
      clearTimeout(deadline);
      for (const timer of timers) clearTimeout(timer);
      await server.stop(true);
    }
  });

  test("counts ordinary JSON responses", async () => {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const body = await request.json();
        if (body.method === "notifications/initialized") return new Response(null, { status: 204 });
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result:
            body.method === "initialize"
              ? { serverInfo: { name: "json-fixture", version: "1" } }
              : { tools: [{ name: "json_tool" }] },
        });
      },
    });
    try {
      expect(await countTools(new URL("mcp", server.url).href)).toEqual({
        server: "json-fixture@1",
        tools: ["json_tool"],
      });
    } finally {
      await server.stop(true);
    }
  });

  test.each(["application/json", "text/event-stream"])(
    "reports JSON-RPC errors from %s without waiting for stream closure",
    async contentType => {
      const payload = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32603, message: "fixture failure" },
      });
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch() {
          const body =
            contentType === "application/json"
              ? payload
              : new ReadableStream<Uint8Array>({
                  start(controller) {
                    controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
                  },
                });
          return new Response(body, {
            headers: { "content-type": contentType },
          });
        },
      });
      try {
        await expect(countTools(new URL("mcp", server.url).href)).rejects.toThrow(
          "initialize: JSON-RPC -32603: fixture failure",
        );
      } finally {
        await server.stop(true);
      }
    },
  );

  test("retains the HTTP authentication error", async () => {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response("Unauthorized", { status: 401 }),
    });
    try {
      await expect(countTools(new URL("mcp", server.url).href)).rejects.toThrow(
        "initialize: HTTP 401 (token missing, wrong or not configured)",
      );
    } finally {
      await server.stop(true);
    }
  });
});
