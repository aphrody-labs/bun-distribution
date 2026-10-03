// SPDX-License-Identifier: Apache-2.0
// Admin IA cockpit retrieval on the preloaded Shenron production services: real Aphrody HTTP
// transport, PostgreSQL corpus, E5 vectors and Redis. Nothing here fakes a retrieval result: the
// hermetic route suite (admin-ia-cockpit.test.ts) cannot reach retrieval, this suite is its
// runtime counterpart. Only auth, canon doctrine and Discord stay stubbed (not retrieval); the
// manga OCR search runs on the real PostgreSQL transcripts, and the cockpit sources owned by
// another process report "unconfigured" instead of inventing data.
import { beforeAll, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadLiveRagEnv, requireLiveRag, type LiveRag } from "@shenron/pipeline/testing/live-rag";
import {
  SourceNotConfiguredError,
  computeRetrievalMetrics,
  parseGoldSet,
  resolveRagBackend,
  type IaCockpitFetchers,
  type SourceSpec,
} from "../src/lib/ia-cockpit";

mock.module("server-only", () => ({}));
loadLiveRagEnv();
// Absolute path: the evaluation must not depend on the working directory of the runner.
const GOLD_PATH = path.resolve(import.meta.dir, "../../bot/tests/rag-gold.jsonl");
process.env.RAG_GOLD_PATH = GOLD_PATH;

mock.module("@/lib/session", () => ({
  isCurrentUserAdmin: async () => true,
  getCurrentUser: async () => ({
    sessionUserId: "s",
    discordId: "1527405876695142620",
    user: {
      id: "admin-test-user",
      username: "AdminTest",
      roleAdmin: true,
      discordId: "1527405876695142620",
    },
  }),
  requireAdmin: async () => {},
}));
mock.module("@/lib/canon-config", () => ({
  getCanonConfig: async () => ({ tiers: [], rules: [] }),
  saveCanonConfig: async (patch: unknown) => patch,
}));
mock.module("@/lib/canon-preuves", () => ({ canonPreuves: async () => ({ references: [] }) }));
mock.module("@/lib/admin-lab", () => ({
  sendAdminLabMessage: async () => ({ id: "m1", ok: true }),
  getAdminLabRecentMessages: async () => [],
}));

const notInScope = (label: string): SourceSpec<never> => ({
  label,
  target: label,
  run: async () => {
    throw new SourceNotConfiguredError("Hors périmètre de la suite RAG live");
  },
});

// The real server module serves every retrieval call; only the sources that read another owner
// (crawl, bot process, PostgreSQL bot.* mirror, Discord, agent keys) are marked out of scope.
const realServer = { ...(await import("../src/lib/ia-cockpit-server")) };
mock.module("@/lib/ia-cockpit-server", () => ({
  ...realServer,
  createIaCockpitFetchers: (): IaCockpitFetchers => ({
    ...realServer.createIaCockpitFetchers(),
    aphrodyWeb: notInScope("Aphrody Web — crawl"),
    botRag: notInScope("Bot Shenron — index local"),
    evalHistory: notInScope("Historique d'évaluation (PostgreSQL)"),
    feedbacks: notInScope("Retours d'entraînement (PostgreSQL)"),
    goals: notInScope("Objectifs actifs (PostgreSQL)"),
    labMessages: notInScope("Discord — salon admin"),
    agentKeys: notInScope("Clés d'agents"),
  }),
}));

const { GET, POST } = await import("../src/app/api/admin/ia/route");
const { NextRequest } = await import("next/server");

let live: LiveRag;
beforeAll(async () => {
  live = await requireLiveRag();
}, 120_000);

function post(body: unknown) {
  return POST(
    new NextRequest("http://127.0.0.1:5011/api/admin/ia", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

/** Real transport towards a loopback port nobody listens on: a genuine connection failure. */
async function withUnreachableAphrody<T>(run: () => Promise<T>): Promise<T> {
  const previous = process.env.APHRODY_AI_HTTP_URL;
  process.env.APHRODY_AI_HTTP_URL = "http://127.0.0.1:1";
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.APHRODY_AI_HTTP_URL;
    else process.env.APHRODY_AI_HTTP_URL = previous;
  }
}

const urls = (hits: Array<{ url?: string | null }>) => hits.map((hit) => hit.url ?? "");

describe("cockpit IA : sources de récupération réelles", () => {
  test("GET rend la santé, les statistiques et la sonde du vrai RAG Aphrody", async () => {
    const before = await live.client.ragStats();
    const res = await GET();
    const after = await live.client.ragStats();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const json = await res.json();

    expect(json.backend).toEqual({ value: "aphrody", raw: "aphrody", engine: "Aphrody AI" });
    expect(json.sources.aphrodyHealth).toMatchObject({ status: "ok", error: null });
    expect(json.sources.aphrodyHealth.data.rag).toBe(true);

    const stats = json.sources.aphrodyRagStats;
    expect(stats).toMatchObject({ status: "ok", error: null });
    // Counters move while the editorial sync runs: the route answer sits between two direct reads.
    expect(stats.data.chunks).toBeGreaterThanOrEqual(Math.min(before.chunks, after.chunks));
    expect(stats.data.chunks).toBeLessThanOrEqual(Math.max(before.chunks, after.chunks));
    expect(stats.data.vectors).toBeGreaterThan(0);
    expect(stats.data.vectors).toBeLessThanOrEqual(stats.data.chunks);
    expect(stats.data.sources).toBeGreaterThan(0);
    expect(stats.data.kinds.length).toBeGreaterThan(0);

    const probe = json.sources.aphrodyRagProbe;
    expect(probe).toMatchObject({ status: "ok", error: null });
    expect(probe.data).toEqual({ query: "Son Goku", mode: "hybrid", hits: 1 });
    expect(probe.latencyMs).toBeGreaterThan(0);

    expect(json.summary.serving).toEqual({
      engine: "Aphrody AI",
      source: "aphrodyRagProbe",
      status: "ok",
      error: null,
    });
    expect(json.summary.countsSource).toBe("aphrodyRagStats");
    expect(json.summary.documents).toBe(stats.data.chunks);
    expect(json.summary.vectors).toBe(stats.data.vectors);
    expect(json.summary.mode).toBe("hybrid");

    // The gold set is a versioned local file: the route reports the real one.
    const gold = parseGoldSet(readFileSync(GOLD_PATH, "utf8"));
    expect(json.sources.goldSet).toMatchObject({ status: "ok", data: { cases: gold.length } });
    expect(json.summary.goldCases).toBe(gold.length);
  });

  test("test_prompt : la recherche sert les vrais passages hybrides du moteur actif", async () => {
    const res = await post({ action: "test_prompt", query: "Son Goku" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.backend.value).toBe("aphrody");
    expect(json.rag).toMatchObject({ status: "ok", error: null, label: "Aphrody AI" });
    expect(json.rag.data.mode).toBe("hybrid");
    const hits = json.rag.data.results;
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.length).toBeLessThanOrEqual(5);
    expect(
      hits.every(
        (hit: { title: string; snippet: string; url: string }) =>
          hit.title.trim() && hit.snippet.trim() && hit.url.trim(),
      ),
    ).toBe(true);

    // Same query straight on the shared client: the route must return what the service ranks.
    const direct = await live.client.ragSearchWithMode("Son Goku", 5);
    expect(direct.mode).toBe("hybrid");
    expect(urls(hits).toSorted()).toEqual(urls(direct.results).toSorted());
    expect(json.latencyMs).toBeGreaterThan(0);

    // Manga OCR search runs on the real PostgreSQL transcripts, not on a stub.
    expect(json.manga).toMatchObject({ status: "ok", error: null });
    expect(Array.isArray(json.manga.data)).toBe(true);
    expect(json.manga.data.length).toBeLessThanOrEqual(5);
  });

  test("searchConfiguredRag borne le nombre de résultats et rend le mode réel", async () => {
    const { searchConfiguredRag } = realServer;
    const backend = resolveRagBackend(process.env.RAG_BACKEND);
    expect(backend.value).toBe("aphrody");
    const one = await searchConfiguredRag("Kamehameha", 1, backend);
    const three = await searchConfiguredRag("Kamehameha", 3, backend);
    expect(one.mode).toBe("hybrid");
    expect(one.results).toHaveLength(1);
    expect(three.mode).toBe("hybrid");
    expect(three.results.length).toBeGreaterThan(0);
    expect(three.results.length).toBeLessThanOrEqual(3);
    expect(three.results.every((hit) => typeof hit.score === "number")).toBe(true);
  });
});

describe("cockpit IA : évaluation du jeu doré sur le vrai RAG", () => {
  test("evaluate_rag mesure les vrais classements du service, sans historiser", async () => {
    const gold = parseGoldSet(readFileSync(GOLD_PATH, "utf8")).slice(0, 3);
    expect(gold).toHaveLength(3);
    const runs = await Promise.all(
      gold.map(async (goldCase) => ({
        case: goldCase,
        hits: (await live.client.ragSearchWithMode(goldCase.q, 10)).results,
      })),
    );
    const expected = computeRetrievalMetrics(runs, 0);

    const res = await post({ action: "evaluate_rag", samples: 3 });
    expect(res.status).toBe(200);
    const { ok, metrics } = await res.json();
    expect(ok).toBe(true);
    expect(metrics).toMatchObject({ cases: 3, engine: "Aphrody AI", persisted: false });
    expect(metrics.durationMs).toBeGreaterThan(0);
    // Recomputed outside the route from the shared client, over the same gold cases and hits.
    expect(metrics.recall).toEqual(expected.recall);
    expect(metrics.mrr).toBe(expected.mrr);
    expect(metrics.ndcg).toBe(expected.ndcg);
    expect(metrics.misses).toEqual(expected.misses);
    // Recall@k only grows with k, and every figure is a ratio.
    const recall = [1, 3, 5, 10].map((k) => metrics.recall[k] as number);
    expect(recall.every((value) => value >= 0 && value <= 1)).toBe(true);
    expect(recall).toEqual(recall.toSorted((a, b) => a - b));
    expect(metrics.mrr).toBeGreaterThanOrEqual(0);
    expect(metrics.mrr).toBeLessThanOrEqual(1);
    expect(metrics.ndcg).toBeGreaterThanOrEqual(0);
    expect(metrics.ndcg).toBeLessThanOrEqual(1);
  }, 120_000);
});

describe("cockpit IA : pannes réelles du transport Aphrody", () => {
  test("test_prompt signale la recherche en échec au lieu d'une liste vide", async () => {
    const json = await withUnreachableAphrody(async () =>
      (await post({ action: "test_prompt", query: "Son Goku" })).json(),
    );
    expect(json.ok).toBe(true);
    expect(json.rag.status).toBe("unavailable");
    expect(json.rag.data).toBeNull();
    expect(json.rag.error).toMatch(/^Aphrody compute /);
    // One failing source never hides the others.
    expect(json.manga.status).toBe("ok");
  });

  test("evaluate_rag renvoie 503 et le cas en cause quand le service est injoignable", async () => {
    const res = await withUnreachableAphrody(() => post({ action: "evaluate_rag", samples: 1 }));
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/^Recherche Aphrody indisponible \(cas « .+ »\) : Aphrody compute /);
  });

  test("le service réel répond de nouveau une fois le transport rétabli", async () => {
    const json = await (await post({ action: "test_prompt", query: "Son Goku" })).json();
    expect(json.rag).toMatchObject({ status: "ok" });
    expect(json.rag.data.mode).toBe("hybrid");
  });
});
