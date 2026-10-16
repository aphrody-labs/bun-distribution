// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { routesToFetch } from "@aphrody/m3-bun/api";
import { listM3Tools } from "@aphrody/m3-mcp";
import routes from "../src/api/index.ts";

const handler = routesToFetch(routes);
async function request(path: string, init?: RequestInit): Promise<Response> {
  const response = await handler(new Request("http://m3.test" + path, init));
  if (!response) throw new Error("Missing showcase endpoint: " + path);
  return response;
}
function post(path: string, body: unknown): Promise<Response> {
  return request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("showcase package computations", () => {
  test("design compiles a brief and migration applies the actual transform", async () => {
    const design = await post("/api/design", {
      brief: "A minimal dashboard for developers with a list-detail layout.",
      seed: "#123456",
    });
    expect(design.status).toBe(200);
    const output = await design.json();
    expect(output.files.some((file: { path: string }) => file.path === "src/theme.css")).toBe(true);
    expect(output.theme.palettes.primary.tones[40]).toMatch(/^#[a-f\d]{6}$/i);
    const migrated = await post("/api/migrate", {
      source: 'import { Button } from "@mui/material"; export default () => <Button variant="contained">Save</Button>;',
    });
    expect(migrated.status).toBe(200);
    const migration = await migrated.json();
    expect(migration.source).toContain("@aphrody/m3-react");
    expect(migration.source).toContain("<MdFilledButton>Save</MdFilledButton>");
    expect(migration.diagnostics).toEqual([]);
  });

  test("system discovers the canonical design tool host, lint rules and generated files", async () => {
    const response = await request("/api/system?target=cosmic&seed=%236750a4");
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.mcpTools).toEqual(listM3Tools());
    expect(data.mcpTools.map((tool: { name: string }) => tool.name)).toContain("m3_symbol_search");
    expect(data.lintRules.length).toBeGreaterThan(0);
    expect(data.themeFiles.length).toBeGreaterThan(0);
    expect(data.themeFiles.every((file: { target: string }) => file.target === "cosmic")).toBe(true);
    expect(data.scaffold["m3.config.ts"]).toContain("@aphrody/m3/config");
    const file = data.themeFiles.find((entry: { binary: boolean }) => !entry.binary);
    const theme = await request("/api/os-theme?target=cosmic&path=" + encodeURIComponent(file.path));
    expect(theme.status).toBe(200);
    expect((await theme.json()).content.length).toBeGreaterThan(0);
  });

  test("Next outputs use the requested origin and canonical theme roles", async () => {
    const response = await request("/api/next?seed=%236750a4");
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.schemeCss).toContain("--md-sys-color-primary");
    expect(data.robots).toContain("http://m3.test/sitemap.xml");
    expect(data.sitemap).toContain("http://m3.test/components");
    expect(data.jsonLd).toContain("Aphrody M3 Showcase");
  });
});

describe("showcase request boundaries", () => {
  test("rejects malformed, missing, oversized and non-object JSON", async () => {
    for (const body of ["{", "null", "[]", JSON.stringify({ prompt: "x".repeat(70_000) })]) {
      // eslint-disable-next-line no-await-in-loop -- Exercise each independent malformed body against the bounded request reader.
      expect((await request("/api/ai/stream", { method: "POST", body })).status).toBe(400);
    }
    expect((await request("/api/ai/stream", { method: "POST" })).status).toBe(400);
  });

  test("rejects invalid themes, migration syntax and files outside generated output", async () => {
    expect((await post("/api/design", { brief: "Dashboard", seed: "oops" })).status).toBe(400);
    expect((await request("/api/next?seed=invalid")).status).toBe(400);
    expect((await request("/api/system?target=unknown")).status).toBe(400);
    expect((await request("/api/os-theme?path=../../secrets")).status).toBe(404);
    expect((await post("/api/migrate", { source: "export default <" })).status).toBe(400);
    expect((await post("/api/migrate", { source: "const x = 1;", kind: "unknown" })).status).toBe(400);
  });

  test("fonts are allowlisted, immutable per ETag, and HEAD has no body", async () => {
    const path = "/api/m3/fonts/GoogleSansCode-latin.woff2";
    const response = await request(path);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("font/woff2");
    expect(response.headers.get("cache-control")).toContain("max-age");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("wOF2");
    const tag = response.headers.get("etag")!;
    expect((await request(path, { headers: { "If-None-Match": tag } })).status).toBe(304);
    const head = await request(path, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("etag")).toBe(tag);
    expect(await head.text()).toBe("");
    const mono = await request("/api/m3/fonts/RobotoMono-latin.woff2");
    expect(mono.status).toBe(200);
    await mono.body?.cancel();
    expect((await request("/api/m3/fonts/unknown.woff2")).status).toBe(404);
    expect((await request("/api/m3/fonts/%2e%2e%2fRobotoMono-latin.woff2")).status).toBe(404);
  });

  test("AG-UI fixture completes and abort closes its producer", async () => {
    const response = await post("/api/ai/stream", {
      prompt: "Inspect the package inventory.",
    });
    expect(response.headers.get("x-m3-fixture")).toBe("true");
    const events = (await response.text())
      .split("\n\n")
      .filter(Boolean)
      .map(frame => JSON.parse(frame.replace(/^data:\s*/, "")));
    expect(events[0].type).toBe("RUN_STARTED");
    expect(events.at(-1).type).toBe("RUN_FINISHED");
    expect(events.find(event => event.type === "TOOL_CALL_RESULT").content).toContain("build inventory");
    const controller = new AbortController();
    const interrupted = await request("/api/ai/stream", {
      method: "POST",
      body: JSON.stringify({ prompt: "Interrupt this fixture." }),
      signal: controller.signal,
    });
    const reader = interrupted.body!.getReader();
    expect((await reader.read()).done).toBe(false);
    controller.abort(new Error("fixture stopped"));
    await expect(reader.read()).rejects.toThrow("fixture stopped");
    reader.releaseLock();
    const cancelled = await post("/api/ai/stream", {
      prompt: "Cancel without abort.",
    });
    await cancelled.body!.cancel();
  });
});
