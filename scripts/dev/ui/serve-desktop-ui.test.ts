// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appServerProxy } from "@aphrody/app-ui/backend";
import { startDesktopUiServer } from "./serve-desktop-ui";

let directory: string;
let uiDist: string;
let server: Awaited<ReturnType<typeof startDesktopUiServer>> | undefined;
let upstream: ReturnType<typeof Bun.serve> | undefined;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "aphrody-ui-transport-"));
  uiDist = join(directory, "ui");
  await mkdir(uiDist);
  await Bun.write(join(uiDist, "index.html"), '<!doctype html><div id="root"></div>');
  await Bun.write(join(uiDist, "app.css"), "body { color: black }");
});
afterEach(async () => {
  server?.stop(true);
  upstream?.stop(true);
  server = undefined;
  upstream = undefined;
  await rm(directory, { recursive: true, force: true });
});

async function request(path: string, init?: RequestInit) {
  if (!server) throw new Error("Server not started");
  return fetch(new URL(path, server.url), init);
}

test("serves the built app unchanged, preserves SPA reloads and reports missing endpoints/assets", async () => {
  server = await startDesktopUiServer({ port: 0, uiDist });
  expect(await (await request("/")).text()).toBe('<!doctype html><div id="root"></div>');
  const page = await request("/settings/appearance");
  expect(await page.text()).toBe('<!doctype html><div id="root"></div>');
  const css = await request("/app.css");
  expect(css.headers.get("content-type")).toContain("text/css");
  expect(await css.text()).toBe("body { color: black }");
  const head = await request("/app.css", { method: "HEAD" });
  expect(head.status).toBe(200);
  expect(await head.text()).toBe("");
  expect((await request("/fonts/missing.woff2")).status).toBe(404);
  expect((await request("/api/capabilities")).status).toBe(404);
  expect(
    (await request("/api/tauri/invoke", { method: "POST", body: '{"cmd":"aphrody_model_pull"}' }))
      .status,
  ).toBe(404);
});

test("forwards exact RPC and approval frames with real upstream errors and health", async () => {
  const received: unknown[] = [];
  upstream = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      if (new URL(req.url).pathname === "/health")
        return Response.json({ ok: false }, { status: 503 });
      received.push(await req.json());
      return Response.json(
        { error: { code: -32601, message: "Method not found" } },
        { status: 409 },
      );
    },
  });
  server = await startDesktopUiServer({
    port: 0,
    uiDist,
    backendUrl: upstream.url.href,
  });
  const frame = { id: 17, method: "aphrody/rag/search", params: { query: "fixture" } };
  const rpc = await request("/rpc", { method: "POST", body: JSON.stringify(frame) });
  expect(rpc.status).toBe(409);
  expect(await rpc.json()).toEqual({ error: { code: -32601, message: "Method not found" } });
  const approval = { id: "approval-1", result: { decision: "decline" } };
  await request("/rpc", { method: "POST", body: JSON.stringify(approval) });
  expect(received).toEqual([frame, approval]);
  const health = await request("/health");
  expect(health.status).toBe(503);
  expect(await health.json()).toEqual({ ok: false });
});

test("streams backend SSE bytes and query without synthesizing notifications", async () => {
  let seen = "";
  const event = 'data: {"method":"turn/completed","params":{"threadId":"fixture"}}\n\n';
  upstream = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      seen = new URL(req.url).pathname + new URL(req.url).search;
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(event));
            controller.close();
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      );
    },
  });
  server = await startDesktopUiServer({
    port: 0,
    uiDist,
    backendUrl: upstream.url.href,
  });
  const events = await request("/events?scope=fixture");
  expect(events.headers.get("content-type")).toBe("text/event-stream");
  expect(await events.text()).toBe(event);
  expect(seen).toBe("/events?scope=fixture");
});

test("a stopped backend is an error, never a ready or successful operation", async () => {
  upstream = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("unused") });
  const target = upstream.url.href;
  upstream.stop(true);
  upstream = undefined;
  server = await startDesktopUiServer({ port: 0, uiDist, backendUrl: target });
  expect((await request("/health")).status).toBe(502);
  expect((await request("/rpc", { method: "POST", body: "{}" })).status).toBe(502);
});

test("keeps static files within the build and backend access on loopback", async () => {
  await symlink(directory, join(uiDist, "escape"));
  server = await startDesktopUiServer({ port: 0, uiDist });
  expect((await request("/..%2Foutside.txt")).status).toBe(403);
  await Bun.write(join(uiDist, "private.txt"), "fixture");
  const escaped = "/escape/ui/private.txt";
  // A link that resolves back inside is legitimate; an outside target is refused.
  expect((await request(escaped)).status).toBe(200);
  await Bun.write(join(directory, "outside.txt"), "outside fixture");
  await symlink(join(directory, "outside.txt"), join(uiDist, "outside.txt"));
  expect((await request("/outside.txt")).status).toBe(403);
  await expect(startDesktopUiServer({ port: 0, host: "0.0.0.0", uiDist })).rejects.toThrow(
    "loopback",
  );
  expect(() => appServerProxy("https://example.com")).toThrow("loopback");
  expect(() => appServerProxy("http://127.0.0.1:8765/prefix")).toThrow("loopback");
  expect(appServerProxy("http://127.0.0.1:8765")["/rpc"]).toBe("http://127.0.0.1:8765");
});
