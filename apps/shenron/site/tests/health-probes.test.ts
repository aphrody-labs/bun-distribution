import { describe, expect, it } from "bun:test";
import { GET as getLiveness } from "../src/app/api/health/route";
import { GET as getLiveAlias } from "../src/app/api/health/live/route";
import { createReadinessHandler } from "../src/app/api/health/ready/route";
import { probeRag, resetRagProbeCache, type ServiceHealth } from "../src/lib/service-health";

describe("S2 — Site Liveness & Readiness Separation", () => {
  describe("Liveness probe (/api/health and /api/health/live)", () => {
    it("returns 200 with pure process liveness independent of downstream API/DB", async () => {
      const res = await getLiveness();
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");

      const body = (await res.json()) as ServiceHealth;
      expect(body.status).toBe("ok");
      expect(body.service).toBe("site");
      expect(body.probe).toBe("liveness");
      expect(body.checks.http).toBe("ok");
      expect(body.failureSemantics).toBeDefined();
      expect(body.failureSemantics).toContain("Liveness probe");
    });

    it("/api/health/live aliases the liveness probe cleanly", async () => {
      const res = await getLiveAlias();
      expect(res.status).toBe(200);

      const body = (await res.json()) as ServiceHealth;
      expect(body.status).toBe("ok");
      expect(body.probe).toBe("liveness");
      expect(body.checks.http).toBe("ok");
    });
  });

  describe("Readiness probe (/api/health/ready)", () => {
    it("returns 200 when all upstream checks are ok or disabled", async () => {
      const handler = createReadinessHandler({
        probeHttp: async () => "ok",
        probeDatabase: async () => "ok",
        probeRag: async () => "disabled",
      });

      const res = await handler();
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");

      const body = (await res.json()) as ServiceHealth;
      expect(body.status).toBe("ok");
      expect(body.probe).toBe("readiness");
      expect(body.checks.api).toBe("ok");
      expect(body.checks.database).toBe("ok");
      expect(body.failureSemantics).toContain("Readiness probe");
    });

    it("returns 200 when database is not configured (disabled)", async () => {
      const handler = createReadinessHandler({
        probeHttp: async () => "ok",
        probeDatabase: async () => "disabled",
        probeRag: async () => "disabled",
        databaseRequired: () => false,
      });

      const res = await handler();
      expect(res.status).toBe(200);

      const body = (await res.json()) as ServiceHealth;
      expect(body.status).toBe("ok");
      expect(body.checks.database).toBe("disabled");
    });

    it("returns 503 degraded when upstream API is unreachable", async () => {
      const handler = createReadinessHandler({
        probeHttp: async () => "unreachable",
        probeDatabase: async () => "ok",
        probeRag: async () => "disabled",
      });

      const res = await handler();
      expect(res.status).toBe(503);
      expect(res.headers.get("cache-control")).toBe("no-store");

      const body = (await res.json()) as ServiceHealth;
      expect(body.status).toBe("degraded");
      expect(body.probe).toBe("readiness");
      expect(body.checks.api).toBe("unreachable");
      expect(body.checks.database).toBe("ok");
    });

    it("returns 503 degraded when upstream database is unreachable", async () => {
      const handler = createReadinessHandler({
        probeHttp: async () => "ok",
        probeDatabase: async () => "unreachable",
        probeRag: async () => "disabled",
      });

      const res = await handler();
      expect(res.status).toBe(503);

      const body = (await res.json()) as ServiceHealth;
      expect(body.status).toBe("degraded");
      expect(body.checks.database).toBe("unreachable");
    });
  });

  describe("Readiness policy: required database and RAG availability", () => {
    const base = {
      probeHttp: async () => "ok" as const,
      probeRag: async () => "disabled" as const,
    };

    it("returns 503 when database is disabled but required", async () => {
      const res = await createReadinessHandler({
        ...base,
        probeDatabase: async () => "disabled",
        probeRag: async () => "disabled",
        databaseRequired: () => true,
      })();
      expect(res.status).toBe(503);
      expect(((await res.json()) as ServiceHealth).checks.database).toBe("not_configured");
    });

    it("returns 503 when the RAG probe fails or is empty", async () => {
      for (const rag of ["empty", "unreachable", "http_503"] as const) {
        const res = await createReadinessHandler({
          ...base,
          probeDatabase: async () => "ok",
          databaseRequired: () => true,
          probeRag: async () => rag,
        })();
        expect(res.status).toBe(503);
        expect(((await res.json()) as ServiceHealth).checks.rag).toBe(rag);
      }
    });

    it("probeRag is disabled unless RAG_BACKEND=aphrody", async () => {
      expect(await probeRag({})).toBe("disabled");
    });

    it("cancels a stalled availability request at its deadline", async () => {
      let cancelled = false;
      const state = await probeRag({ RAG_BACKEND: "aphrody" }, (_q, _limit, signal) =>
        new Promise((_resolve, reject) => {
          signal!.addEventListener("abort", () => {
            cancelled = true;
            reject(new Error("request cancelled"));
          }, { once: true });
        })
      );
      expect(state).toBe("unreachable");
      expect(cancelled).toBe(true);
    }, 10_000);

    it("probeRag fails on empty hits, error bodies, HTTP errors and invalid shapes", async () => {
      const env = { RAG_BACKEND: "aphrody" };
      resetRagProbeCache();
      expect(await probeRag(env, async () => ({ results: [] }))).toBe("empty");
      expect(await probeRag(env, async () => ({ results: [{}] }))).toBe("unreachable");
      expect(
        await probeRag(env, async () => ({ error: "boom" }) as unknown as { results: unknown[] }),
      ).toBe("unreachable");
      expect(await probeRag(env, async () => ({}) as { results: unknown[] })).toBe("unreachable");
      expect(
        await probeRag(env, async () => {
          throw new Error("Aphrody compute HTTP 401 on /rag/search");
        }),
      ).toBe("http_401");
      expect(
        await probeRag(env, async () => {
          throw new Error("connect refused");
        }),
      ).toBe("unreachable");
    });
  });
});
