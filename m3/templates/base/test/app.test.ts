import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { defaultLibraryPath } from "@aphrody/runtime-sdk";
import { startServer } from "../src/server.ts";

// The precompiled runtime library is built once (`just runtime-build` in the yolo repository).
const suite = existsSync(defaultLibraryPath()) ? describe : describe.skip;

suite("HTTP surface", () => {
  let base = "";
  let stop = () => {};
  beforeAll(() => {
    const { server, db } = startServer({ port: 0 });
    base = `http://127.0.0.1:${server.port}`;
    stop = () => {
      void server.stop(true);
      db.close();
    };
  });
  afterAll(() => stop());

  it("answers /health", async () => {
    expect(await (await fetch(`${base}/health`)).json()).toEqual({ ok: true });
  });

  it("serves runtime statistics and counts hits in SQLite", async () => {
    const first = (await (await fetch(`${base}/api/stats`)).json()) as any;
    const second = (await (await fetch(`${base}/api/stats`)).json()) as any;
    expect(first.runtime.name).toBe("yolo-runtime");
    expect(first.stats.arch.length).toBeGreaterThan(0);
    expect(second.hits).toBe(first.hits + 1);
  });

  it("runs a native benchmark", async () => {
    const result = (await (await fetch(`${base}/api/bench?n=5000`)).json()) as any;
    expect(result.message).toContain("5000");
  });

  it("cancels the native benchmark when the client disconnects", async () => {
    const controller = new AbortController();
    const pending = fetch(`${base}/api/bench?n=2000000000`, { signal: controller.signal });
    setTimeout(() => controller.abort(), 50);
    await expect(pending).rejects.toThrow();
    // the worker was released: a new benchmark starts immediately
    expect(((await (await fetch(`${base}/api/bench?n=10`)).json()) as any).message).toContain("10");
  });

  it("streams server-sent events", async () => {
    const controller = new AbortController();
    const response = await fetch(`${base}/api/events`, { signal: controller.signal });
    const reader = response.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    controller.abort();
    expect(first.startsWith("data: ")).toBe(true);
    expect(JSON.parse(first.slice(6)).os.length).toBeGreaterThan(0);
  });
});
