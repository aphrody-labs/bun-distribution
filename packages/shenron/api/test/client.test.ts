// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRecordingFetch } from "@shenron/config/testing";
import { createShenronApiClient } from "../src/client";
import { endpoints } from "../src/contract";
import responses from "./fixtures/bot-responses.json";

const BASE = "http://127.0.0.1:5006";
const json = (body: unknown, init: ResponseInit = {}) => Response.json(body, init);

describe("createShenronApiClient", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("ok: parsed value, status and etag", async () => {
    const rec = createRecordingFetch({
      "GET /api/public/wiki/categories": () =>
        json(
          { categories: [{ name: "characters", label: "Personnages", total: 3 }] },
          { headers: { ETag: '"abc-1"' } },
        ),
    });
    const client = createShenronApiClient({ baseUrl: BASE, fetch: rec.fetch, userAgent: "t/1" });
    const r = await client.wiki.categories();
    expect(r).toEqual({
      ok: true,
      status: 200,
      etag: '"abc-1"',
      value: { categories: [{ name: "characters", label: "Personnages", total: 3 }] },
    });
    expect(rec.calls[0]?.headers.get("user-agent")).toBe("t/1");
    expect(rec.calls[0]?.headers.get("authorization")).toBeNull();
  });

  test("unreachable: network failure", async () => {
    const rec = createRecordingFetch({});
    const r = await createShenronApiClient({ baseUrl: BASE, fetch: rec.fetch }).wiki.categories();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe("unreachable");
      expect(r.path).toBe("/api/public/wiki/categories");
    }
  });

  test("timeout: per-call AbortSignal.timeout", async () => {
    const rec = createRecordingFetch({
      "*": () => new Promise<Response>(() => {}),
    });
    const client = createShenronApiClient({ baseUrl: BASE, fetch: rec.fetch, timeoutMs: 20 });
    const first = await client.wiki.categories();
    const second = await client.wiki.categories();
    expect(first.ok ? null : first.kind).toBe("timeout");
    expect(second.ok ? null : second.kind).toBe("timeout");
  });

  test("http: ErrorEnvelope parsed, non-JSON body tolerated", async () => {
    const rec = createRecordingFetch({
      "GET /api/public/wiki/pokemon": () => json({ error: "Not found" }, { status: 404 }),
      "GET /api/public/wiki/characters": () =>
        json({ error: "Data store unavailable", code: "pg_unavailable" }, { status: 503 }),
      "GET /api/public/wiki/planets": () => new Response("Bad gateway", { status: 502 }),
    });
    const client = createShenronApiClient({ baseUrl: BASE, fetch: rec.fetch });
    const a = await client.call(endpoints.wikiList, {
      params: { category: "pokemon" as "characters" },
    });
    expect(a).toMatchObject({
      ok: false,
      kind: "http",
      status: 404,
      error: { error: "Not found" },
    });
    const b = await client.wiki.list("characters");
    expect(b).toMatchObject({
      ok: false,
      kind: "http",
      status: 503,
      error: { code: "pg_unavailable" },
    });
    const c = await client.wiki.list("planets");
    expect(c).toMatchObject({ ok: false, kind: "http", status: 502, detail: "HTTP 502" });
    expect(c.ok || "error" in c).toBe(false);
  });

  test("invalid_json and invalid_response", async () => {
    const rec = createRecordingFetch({
      "GET /api/public/stats": () => new Response("<html>", { status: 200 }),
      "GET /health": () => json({ status: "down" }),
    });
    const client = createShenronApiClient({ baseUrl: BASE, fetch: rec.fetch });
    const a = await client.call(endpoints.publicStats, {});
    expect(a.ok ? null : a.kind).toBe("invalid_json");
    const b = await client.call(endpoints.health, {});
    expect(b.ok ? null : b.kind).toBe("invalid_response");
    if (!b.ok && b.kind === "invalid_response") expect(b.issues?.[0]).toContain("status");
  });

  test("fetch resolved per call: replacing globalThis.fetch after creation is honoured", async () => {
    const client = createShenronApiClient({ baseUrl: BASE });
    const first = createRecordingFetch({ "GET /health": () => json({ status: "ok" }) });
    globalThis.fetch = first.fetch;
    expect((await client.call(endpoints.health, {})).ok).toBe(true);
    const second = createRecordingFetch({ "GET /health": () => json({ status: "ok" }) });
    globalThis.fetch = second.fetch;
    expect((await client.call(endpoints.health, {})).ok).toBe(true);
    expect(first.calls).toHaveLength(1);
    expect(second.calls).toHaveLength(1);
  });

  test("admin token only on admin endpoints and only when provided", async () => {
    const routes = {
      "GET /api/stats/totals": () => json(responses.adminStats),
      "GET /api/public/stats": () => json(responses.publicStats),
    };
    const anon = createRecordingFetch(routes);
    await createShenronApiClient({ baseUrl: BASE, fetch: anon.fetch }).admin.stats();
    expect(anon.calls[0]?.headers.get("authorization")).toBeNull();

    const nullToken = createRecordingFetch(routes);
    await createShenronApiClient({
      baseUrl: BASE,
      fetch: nullToken.fetch,
      adminToken: () => null,
    }).admin.stats();
    expect(nullToken.calls[0]?.headers.get("authorization")).toBeNull();

    const withToken = createRecordingFetch(routes);
    const client = createShenronApiClient({
      baseUrl: BASE,
      fetch: withToken.fetch,
      adminToken: () => "s3cret",
    });
    const stats = await client.admin.stats();
    expect(stats.ok).toBe(true);
    await client.call(endpoints.publicStats, {});
    expect(withToken.calls[0]?.headers.get("authorization")).toBe("Bearer s3cret");
    expect(withToken.calls[1]?.headers.get("authorization")).toBeNull();
  });

  test("acting-user headers only through the injected signer", async () => {
    const rec = createRecordingFetch({ "GET /health": () => json({ status: "ok" }) });
    const signed: string[] = [];
    const client = createShenronApiClient({
      baseUrl: BASE,
      fetch: rec.fetch,
      signActingUser: (id) => {
        signed.push(id);
        return { "x-shenron-user": id, "x-shenron-signature": "sig" };
      },
    });
    await client.call(endpoints.health, {});
    await client.call(endpoints.health, { actingUserId: "42" });
    expect(signed).toEqual(["42"]);
    expect(rec.calls[0]?.headers.get("x-shenron-user")).toBeNull();
    expect(rec.calls[1]?.headers.get("x-shenron-user")).toBe("42");
    const unsigned = createRecordingFetch({ "GET /health": () => json({ status: "ok" }) });
    await createShenronApiClient({ baseUrl: BASE, fetch: unsigned.fetch }).call(endpoints.health, {
      actingUserId: "42",
    });
    expect([...unsigned.calls[0]!.headers.keys()].some((k) => k.startsWith("x-shenron"))).toBe(
      false,
    );
  });

  test("paths, query strings, JSON bodies and base path prefix", async () => {
    const rec = createRecordingFetch({
      "POST /bot/api/admin/goals/7/complete": () => json(responses.completeGoal),
      "POST /bot/api/admin/goals": () => json(responses.createGoal, { status: 201 }),
      "GET /bot/api/public/wiki/races/super%20saiyan": () => json({ id: 1, slug: "super saiyan" }),
    });
    const client = createShenronApiClient({ baseUrl: `${BASE}/bot/`, fetch: rec.fetch });
    expect((await client.cockpit.completeGoal(7, { notes: "ok" })).ok).toBe(true);
    const created = await client.cockpit.createGoal({ title: "T", userId: "1" });
    expect(created.ok && created.status).toBe(201);
    expect((await client.wiki.get("races", "super saiyan")).ok).toBe(true);
    expect(rec.calls[0]).toMatchObject({ method: "POST", body: '{"notes":"ok"}' });
    expect(rec.calls[0]?.headers.get("content-type")).toBe("application/json");
    expect(rec.calls[2]?.url).toBe(`${BASE}/bot/api/public/wiki/races/super%20saiyan`);
  });

  test("lenient pagination metadata", async () => {
    const rec = createRecordingFetch({
      "GET /api/public/wiki/planets": () =>
        json({ category: "planets", items: [{ id: 1 }, { id: 2 }], total: "41" }),
      "GET /api/database/users": () => json({ rows: [{ id: 1 }] }),
    });
    const client = createShenronApiClient({ baseUrl: BASE, fetch: rec.fetch });
    const list = await client.wiki.list("planets", { limit: 2, offset: 4 });
    expect(list.ok && list.value).toEqual({
      category: "planets",
      items: [{ id: 1 }, { id: 2 }],
      total: 41,
      limit: 2,
      offset: 4,
    });
    const rows = await client.admin.table("users");
    expect(rows.ok && rows.value).toEqual({ rows: [{ id: 1 }], total: 1, limit: 1, offset: 0 });
  });

  test("every cockpit and admin method reaches its endpoint", async () => {
    const rec = createRecordingFetch({
      "POST /api/training/feedback/5/status": () => json(responses.feedbackStatus),
      "POST /api/training/gold": () => json(responses.goldCase, { status: 201 }),
      "POST /api/training/eval": () => json(responses.runEval),
      "GET /api/services": () => json(responses.adminServices),
      "GET /api/database/tables": () => json(responses.adminTables),
      "GET /api/wiki/stats": () => json(responses.adminWikiStats),
      "GET /api/economy/stats": () => json(responses.adminEconomyStats),
    });
    const client = createShenronApiClient({ baseUrl: BASE, fetch: rec.fetch });
    const results = await Promise.all([
      client.cockpit.setFeedbackStatus(5, { status: "gold_added" }),
      client.cockpit.addGold({ q: "Qui est Bardock ?", expect: ["/wiki/personnages/bardock"] }),
      client.cockpit.runEval(),
      client.admin.services(),
      client.admin.tables(),
      client.admin.wikiStats(),
      client.admin.economyStats(),
    ]);
    expect(results.map((r) => r.ok)).toEqual(Array(7).fill(true));
  });
});

describe("./client browser bundle", () => {
  test("contains no node: or bun: specifier", async () => {
    const outdir = join(tmpdir(), `shenron-api-client-${process.pid}-${Date.now()}`);
    try {
      const result = await Bun.build({
        entrypoints: [join(import.meta.dir, "..", "src", "client", "index.ts")],
        target: "browser",
        outdir,
      });
      expect(result.success).toBe(true);
      const files = existsSync(outdir) ? readdirSync(outdir).filter((f) => f.endsWith(".js")) : [];
      expect(files.length).toBeGreaterThan(0);
      for (const file of files) {
        const code = readFileSync(join(outdir, file), "utf8");
        expect(code).not.toMatch(/["']node:/);
        expect(code).not.toMatch(/["']bun:/);
        expect(code).not.toContain("hono");
      }
    } finally {
      rmSync(outdir, { recursive: true, force: true });
    }
  });
});
