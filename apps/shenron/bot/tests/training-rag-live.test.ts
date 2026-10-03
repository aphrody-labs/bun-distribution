// SPDX-License-Identifier: Apache-2.0
import "./setup-training";
import { beforeAll, describe, expect, test } from "bun:test";
import { loadLiveRagEnv, requireLiveRag, type LiveRag } from "@shenron/pipeline/testing/live-rag";

loadLiveRagEnv();
const { TrainingService } = await import("../src/services/TrainingService");
const { DatabaseService } = await import("../src/db/index");
const { CanonService } = await import("../src/services/CanonService");

let live: LiveRag;
beforeAll(async () => {
  live = await requireLiveRag();
}, 120_000);

// :memory: ne stocke que les retours/historique ; aucun chunk RAG fabriqué,
// le backend RAG est l'index Aphrody réel.
const fresh = () => {
  const dbs = DatabaseService.forPath(":memory:");
  return { dbs, service: new TrainingService(dbs, new CanonService(null as any)) };
};

describe("TrainingService — runtime réel (RAG_BACKEND=aphrody)", () => {
  test("isSidecarOnline sonde l'embedding réel après le préchargement complet", async () => {
    expect(await fresh().service.isSidecarOnline()).toBe(true);
  }, 60_000);

  test("inspectRag diagnostique tokens, pondérations de vérité et scores", async () => {
    const diag = await fresh().service.inspectRag("Kamehameha");
    expect(diag.query).toBe("Kamehameha");
    expect(diag.tokens.length).toBeGreaterThan(0);
    expect(diag.mode).toBe("hybrid");
    expect(diag.sidecarActive).toBe(true);
    expect(diag.results.length).toBeGreaterThan(0);
    for (const r of diag.results) {
      expect(Number.isFinite(r.truthMultiplier)).toBe(true);
      expect(r.truthMultiplier).toBeGreaterThan(0);
      expect(r.score).toBeGreaterThan(0);
      expect(r.url.length).toBeGreaterThan(0);
      expect(r.title.length).toBeGreaterThan(0);
    }
  }, 60_000);

  test("hitTruthWeight lit le groupe source réel : canon pondéré au-dessus des jeux", async () => {
    const { hybridSearch, hitTruthWeight, tokenize } = await import("../src/lib/rag");
    const tokens = tokenize("Son Goku");
    const weigh = async (sourceId: string) => {
      const { results } = await hybridSearch(null, "Son Goku", 5, { sourceId });
      expect(results.length).toBeGreaterThan(0);
      return results.map((hit) => {
        expect(hit.sourceId).toBe(sourceId);
        expect(hit.documentId).toBeTruthy();
        const w = hitTruthWeight(hit, tokens);
        expect(Number.isFinite(w)).toBe(true);
        expect(w).toBeGreaterThan(0);
        return w;
      });
    };
    const canon = await weigh("db_characters");
    const games = await weigh("xv2");
    expect(Math.max(...canon)).toBeGreaterThan(Math.max(...games));
  }, 60_000);

  test("evaluateRag (persist:false) calcule les métriques réelles sans écrire d'historique", async () => {
    const { dbs, service } = fresh();
    const metrics = await service.evaluateRag(3, { persist: false });
    expect(metrics.cases).toBe(3);
    expect(metrics.sidecarActive).toBe(true);
    for (const k of [1, 3, 5, 10]) {
      expect(metrics.recall[k]).toBeGreaterThanOrEqual(0);
      expect(metrics.recall[k]).toBeLessThanOrEqual(1);
    }
    expect(metrics.recall[5]!).toBeGreaterThanOrEqual(metrics.recall[1]!);
    expect(metrics.mrr).toBeGreaterThanOrEqual(0);
    expect(metrics.mrr).toBeLessThanOrEqual(1);
    expect(metrics.durationMs).toBeGreaterThan(0);
    expect(service.getEvalHistory()).toHaveLength(0);
    expect(dbs.sqlite.query("SELECT count(*) AS c FROM rag_eval_history").get()).toEqual({ c: 0 });
  }, 180_000);

  test("getStats reflète exactement l'index Aphrody entièrement chargé", async () => {
    const stats = await fresh().service.getStats();
    expect(stats.totalChunks).toBe(live.stats.chunks);
    expect(stats.totalVectors).toBe(live.stats.vectors);
    expect(stats.totalChunks).toBeGreaterThan(0);
    expect(stats.totalVectors).toBe(stats.totalChunks);
    expect(stats.totalGoldCases).toBeGreaterThanOrEqual(60);
    expect(stats.totalFeedbacks).toBe(0);
    expect(stats.pendingFeedbacks).toBe(0);
    expect(stats.goldFeedbacks).toBe(0);
    expect(stats.sidecarStatus).toBe("online");
    expect(["online", "offline"]).toContain(stats.siteApiStatus);
    expect(["online", "offline"]).toContain(stats.botApiStatus);
  }, 60_000);
});
