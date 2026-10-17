// SPDX-License-Identifier: Apache-2.0
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startM3Server } from "../src/server.ts";
import { agUiRoute } from "../src/server-agui.ts";
import { m3McpRoutes } from "../src/server-mcp.ts";
import { startNextApp } from "../src/server-next.ts";
import { loadOptional, packageDir } from "../src/server-optional.ts";
import { cleanup, tmp } from "./helpers.ts";

afterAll(cleanup);

const resolvable = (specifier: string): boolean => {
  try {
    Bun.resolveSync(specifier, import.meta.dir);
    return true;
  } catch {
    return false;
  }
};

describe("optional integrations", () => {
  test("a missing package fails with the feature and the package to add", async () => {
    await expect(loadOptional("@aphrody/not-installed/sub", "demo")).rejects.toThrow(
      "m3-bun demo: cannot load @aphrody/not-installed/sub; add @aphrody/not-installed to the app's dependencies",
    );
    expect(() => packageDir("@aphrody/not-installed", "demo")).toThrow("@aphrody/not-installed is not installed");
  });
});

describe.skipIf(!resolvable("@aphrody/m3-mcp"))("M3 MCP tools over HTTP (@aphrody/m3-mcp)", () => {
  for (const isolate of [false, true])
    test(`list and call ${isolate ? "in a tool-host child" : "in process"}`, async () => {
      const server = startM3Server({
        port: 0,
        hostname: "127.0.0.1",
        api: m3McpRoutes({ isolate }),
      });
      try {
        const base = `http://127.0.0.1:${server.port}/api/m3/mcp`;
        const { tools } = (await (await fetch(base)).json()) as {
          tools: { name: string }[];
        };
        expect(tools.map(tool => tool.name)).toContain("m3_token_lookup");
        const call = (tool: string, body: string) => fetch(`${base}/${tool}`, { method: "POST", body });
        const found = await call("m3_token_lookup", JSON.stringify({ query: "primary" }));
        expect(found.status).toBe(200);
        const result = (await found.json()) as {
          content: { type: string; text: string }[];
        };
        expect(result.content[0]!.text).toContain("--md-sys-color-primary");
        const unknown = await call("nope", "{}");
        expect(unknown.status).toBe(422);
        expect(await unknown.json()).toEqual({
          content: [{ type: "text", text: "unknown tool nope" }],
          isError: true,
        });
        expect((await call("m3_token_lookup", "{not json")).status).toBe(400);
      } finally {
        await server.stop(true);
      }
    });
});

describe.skipIf(!resolvable("@aphrody/m3-ai/ag-ui"))("AG-UI endpoint (@aphrody/m3-ai/ag-ui)", async () => {
  const agUi = resolvable("@aphrody/m3-ai/ag-ui") ? await import("@aphrody/m3-ai/ag-ui") : undefined;

  test("an async generator agent streams to HttpAgent, the AG-UI client", async () => {
    const { EventType, HttpAgent } = agUi!;
    const route = agUiRoute(async function* (input) {
      yield {
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      };
      yield {
        type: EventType.TEXT_MESSAGE_START,
        messageId: "m1",
        role: "assistant",
      };
      yield {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: "m1",
        delta: `echo: ${input.messages.length}`,
      };
      yield { type: EventType.TEXT_MESSAGE_END, messageId: "m1" };
      yield {
        type: EventType.RUN_FINISHED,
        threadId: input.threadId,
        runId: input.runId,
      };
    } as Parameters<typeof agUiRoute>[0]);
    const server = startM3Server({
      port: 0,
      hostname: "127.0.0.1",
      api: { "/api/m3/ag-ui": route },
    });
    try {
      const url = `http://127.0.0.1:${server.port}/api/m3/ag-ui`;
      const agent = new HttpAgent({ url, threadId: "t1" });
      const seen: string[] = [];
      const { newMessages } = await agent.runAgent(
        { runId: "r1" },
        { onEvent: ({ event }) => void seen.push(event.type) },
      );
      expect(seen).toEqual([
        "RUN_STARTED",
        "TEXT_MESSAGE_START",
        "TEXT_MESSAGE_CONTENT",
        "TEXT_MESSAGE_END",
        "RUN_FINISHED",
      ]);
      expect(newMessages).toEqual([{ id: "m1", role: "assistant", content: "echo: 0" }]);

      const input = JSON.stringify({
        threadId: "t",
        runId: "r",
        messages: [],
      });
      const proto = await fetch(url, {
        method: "POST",
        headers: { accept: agUi!.AGUI_MEDIA_TYPE },
        body: input,
      });
      expect(proto.headers.get("content-type")).toBe(agUi!.AGUI_MEDIA_TYPE);
      const bytes = await proto.bytes();
      const first = new DataView(bytes.buffer).getUint32(0);
      expect(agUi!.decodeProto(bytes.subarray(4, 4 + first)).type).toBe(EventType.RUN_STARTED);
      expect((await fetch(url, { method: "POST", body: "{}" })).status).toBe(400);
    } finally {
      await server.stop(true);
    }
  });

  test("an Observable agent's error ends the stream with RUN_ERROR", async () => {
    const { EventType } = agUi!;
    const route = agUiRoute({
      run: input => ({
        subscribe(observer) {
          observer.next({
            type: EventType.RUN_STARTED,
            threadId: input.threadId,
            runId: input.runId,
          } as never);
          observer.error(new Error("model offline"));
          return { unsubscribe() {} };
        },
      }),
    });
    const server = startM3Server({
      port: 0,
      hostname: "127.0.0.1",
      api: { "/api/m3/ag-ui": route },
    });
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/api/m3/ag-ui`, {
        method: "POST",
        body: JSON.stringify({ threadId: "t", runId: "r", messages: [] }),
      });
      expect(res.headers.get("content-type")).toBe("text/event-stream");
      const events = (await res.text())
        .split("\n\n")
        .filter(Boolean)
        .map(frame => JSON.parse(frame.replace(/^data: /, "")) as Record<string, unknown>);
      expect(events).toEqual([
        { type: "RUN_STARTED", threadId: "t", runId: "r" },
        { type: "RUN_ERROR", message: "model offline" },
      ]);
    } finally {
      await server.stop(true);
    }
  });
});

const fakeNextApp = (): string => {
  const dir = tmp("m3-bun-next-");
  mkdirSync(join(dir, "node_modules", "next", "dist", "bin"), {
    recursive: true,
  });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "app", dependencies: { next: "*" } }));
  writeFileSync(join(dir, "node_modules", "next", "package.json"), JSON.stringify({ name: "next", version: "16.0.0" }));
  // The CLI contract m3-bun relies on: `next <mode> -p <port> -H <host>`, then the `- Local:` line once serving.
  writeFileSync(
    join(dir, "node_modules", "next", "dist", "bin", "next"),
    [
      "const [mode, , port, , hostname] = process.argv.slice(2);",
      "const server = Bun.serve({ port: Number(port), hostname, fetch: async req =>",
      "  Response.json({ mode, path: new URL(req.url).pathname, method: req.method, body: await req.text(), node: typeof Bun }) });",
      "console.log('   ▲ Next.js 16.0.0');",
      "console.log('   - Local:        http://localhost:' + server.port);",
    ].join("\n"),
  );
  return dir;
};

describe.skipIf(!resolvable("@aphrody/next-bun/run"))("Next.js app behind m3-bun (@aphrody/next-bun)", () => {
  test("next runs on Bun on a free port and m3-bun proxies the requests it does not answer", async () => {
    const next = await startNextApp({ dir: fakeNextApp() });
    const server = startM3Server({
      port: 0,
      hostname: "127.0.0.1",
      api: {
        routes: { "/api/own": () => new Response("m3") },
        fetch: (request: Request) => next.fetch(request),
      },
    });
    try {
      expect(next.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      const base = `http://127.0.0.1:${server.port}`;
      expect(await (await fetch(`${base}/api/own`)).text()).toBe("m3");
      expect(await (await fetch(`${base}/blog/1`, { method: "POST", body: "hi" })).json()).toEqual({
        mode: "dev",
        path: "/blog/1",
        method: "POST",
        body: "hi",
        node: "object",
      });
    } finally {
      await server.stop(true);
      await next.stop();
    }
  });

  test("an app without next, and a next that never serves, fail explicitly", async () => {
    await expect(startNextApp({ dir: tmp() })).rejects.toThrow("has no next dependency");
    const dir = fakeNextApp();
    writeFileSync(
      join(dir, "node_modules", "next", "dist", "bin", "next"),
      "console.error('boom: no pages'); process.exit(1);",
    );
    await expect(startNextApp({ dir })).rejects.toThrow("boom: no pages");
  });
});
