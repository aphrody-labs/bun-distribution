import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { loadLiveRagEnv, requireLiveRag } from "@shenron/pipeline/testing/live-rag";
import { recordLiveRagRequests } from "../../../../packages/shenron/pipeline/src/testing/live-rag-requests";
import { createReadinessHandler } from "../src/app/api/health/ready/route";
import { probeRag, resetRagProbeCache, type ServiceHealth } from "../src/lib/service-health";

mock.module("server-only", () => ({}));
afterAll(async () => {
  const { closeDb } = await import("../src/lib/db");
  await closeDb();
});

// Real PG/E5/Redis runtime behind a full, fresh preload; no stub on retrieval.
loadLiveRagEnv();
beforeAll(async () => {
  await requireLiveRag();
  resetRagProbeCache();
}, 120_000);

describe("readiness against the live native RAG", () => {
  it("shares concurrent real searches and reuses the bounded success cache", async () => {
    const transport = globalThis.fetch;
    const observed = recordLiveRagRequests();
    resetRagProbeCache();
    globalThis.fetch = observed.fetcher;
    try {
      expect(await Promise.all([probeRag(), probeRag(), probeRag()])).toEqual(["ok", "ok", "ok"]);
      expect(observed.calls.filter((call) => call.path.endsWith("/rag/search"))).toHaveLength(1);
      expect(await probeRag()).toBe("ok");
      expect(observed.calls.filter((call) => call.path.endsWith("/rag/search"))).toHaveLength(1);
    } finally {
      globalThis.fetch = transport;
      resetRagProbeCache();
    }
  }, 30_000);

  it("ready route reports rag ok; only the bot liveness dependency is isolated", async () => {
    const res = await createReadinessHandler({ probeHttp: async () => "ok" })();
    const body = (await res.json()) as ServiceHealth;
    expect(body.checks.rag).toBe("ok");
    expect(body.checks.database).toBe("ok");
    expect(res.status).toBe(200);
  }, 30_000);
});
