// SPDX-License-Identifier: Apache-2.0
/**
 * Evaluate the Aphrody served Shenron corpus against Shenron's source URL gold
 * set, through the real private HTTP route (`/api/v1/shenron/rag/search`).
 *
 * The report records the retrieval mode Aphrody actually returns, the latency
 * of every case and every transport error. `--ci` enforces the activation gate
 * of `RAG_BACKEND=aphrody`: Recall@5 >= `RAG_CI_RECALL5_MIN` (0.8), p95 latency
 * strictly below `RAG_CI_P95_MAX_MS` (8000) and zero failed requests.
 */
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { AphrodyComputeClient } from "../../../../../packages/shenron/pipeline/src/aphrody";
import {
  aggregate,
  aggregateByTag,
  parseGold,
  runCase,
  type CaseResult,
} from "../../../../../packages/shenron/pipeline/src/ai/eval";
import { requireAiHttpUrl } from "../../../../../packages/shenron/pipeline/src/ai/config";
import { resolveDataPath } from "../../../../../packages/shenron/config/src/paths";

const REPO_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));

/**
 * B13: the private Aphrody API address has no default here. Returns the origin
 * resolved by `@shenron/pipeline/ai/config` (`APHRODY_AI_HTTP_URL`, then the legacy
 * `APHRODY_SHENRON_API_URL`), or throws an error naming the variables.
 */
export function aphrodyApiUrlFromEnv(
  env: Record<string, string | undefined> = process.env,
): string {
  return requireAiHttpUrl(env).href;
}

export interface GateThresholds {
  recall5Min: number;
  p95MaxMs: number;
}

export interface GateInput {
  cases: number;
  recall5: number;
  p95Ms: number;
  errors: number;
}

/** Nearest-rank percentile; 0 for an empty sample. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = values.toSorted((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index]!;
}

/** Activation gate: every failed condition is reported, none is waived. */
export function evaluateGate(
  input: GateInput,
  thresholds: GateThresholds,
): { pass: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (input.cases === 0) reasons.push("no gold case was evaluated");
  if (!(input.recall5 >= thresholds.recall5Min))
    reasons.push(`Recall@5 ${input.recall5.toFixed(4)} < ${thresholds.recall5Min}`);
  if (!(input.p95Ms < thresholds.p95MaxMs))
    reasons.push(`p95 ${input.p95Ms} ms >= ${thresholds.p95MaxMs} ms`);
  if (input.errors > 0) reasons.push(`${input.errors} request(s) failed`);
  return { pass: reasons.length === 0, reasons };
}

export function gateThresholdsFromEnv(
  env: Record<string, string | undefined> = process.env,
): GateThresholds {
  const recall5Min = Number(env.RAG_CI_RECALL5_MIN ?? 0.8);
  const p95MaxMs = Number(env.RAG_CI_P95_MAX_MS ?? 8000);
  if (!Number.isFinite(recall5Min) || recall5Min < 0 || recall5Min > 1)
    throw new Error("RAG_CI_RECALL5_MIN must be within [0, 1]");
  if (!Number.isFinite(p95MaxMs) || p95MaxMs <= 0)
    throw new Error("RAG_CI_P95_MAX_MS must be a positive number");
  return { recall5Min, p95MaxMs };
}

async function main(): Promise<void> {
  const goldPath = resolveDataPath("ragGold", {
    env: process.env,
    legacyDefault: join(REPO_ROOT, "apps", "shenron", "bot", "tests", "rag-gold.jsonl"),
  }).path;
  const gold = parseGold(await Bun.file(goldPath).text());
  if (gold.length === 0) throw new Error("RAG gold set is empty");
  const thresholds = gateThresholdsFromEnv();
  const client = new AphrodyComputeClient({ baseUrl: aphrodyApiUrlFromEnv() });
  const health = await client.health();
  if (!health.rag) throw new Error("Aphrody RAG is unavailable");
  const stats = await client.ragStats().then(
    (value) => ({
      chunks: value.chunks,
      vectors: value.vectors,
      vectorsStored: value.vectorsStored ?? null,
      sources: value.sources.length,
    }),
    (error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }),
  );

  const results: CaseResult[] = [];
  const errors: { q: string; error: string }[] = [];
  const modes: Record<string, number> = {};
  const startedAt = performance.now();
  for (const testCase of gold) {
    const t0 = performance.now();
    try {
      const result = await runCase(testCase, async (query) => {
        const { results: hits, mode } = await client.ragSearchWithMode(query, 10);
        return { mode, results: hits };
      });
      modes[result.mode] = (modes[result.mode] ?? 0) + 1;
      results.push(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push({ q: testCase.q, error: message });
      modes.error = (modes.error ?? 0) + 1;
      results.push({
        case: testCase,
        rank: 0,
        ndcg: 0,
        top: [],
        latencyMs: Math.round(performance.now() - t0),
        mode: "error",
      });
    }
  }

  const metrics = aggregate(results);
  const latencies = results.map((result) => result.latencyMs);
  const latencyMs = {
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    max: percentile(latencies, 100),
  };
  const gate = evaluateGate(
    { cases: gold.length, recall5: metrics.recall[5], p95Ms: latencyMs.p95, errors: errors.length },
    thresholds,
  );
  const report = {
    status: "measured",
    backend: "aphrody",
    measuredAt: new Date().toISOString(),
    durationMs: Math.round(performance.now() - startedAt),
    health,
    stats,
    cases: gold.length,
    modes,
    metrics,
    latencyMs,
    errors,
    gate: { ...gate, thresholds },
    byTag: aggregateByTag(results),
    misses: results
      .filter((result) => result.rank === 0 && result.mode !== "error")
      .map((result) => ({
        q: result.case.q,
        expected: result.case.expectUrl ?? result.case.expectTitle ?? result.case.expect,
        got: result.top,
      })),
  };
  console.log(JSON.stringify(report, null, 2));
  if (process.argv.includes("--ci") && !gate.pass) process.exitCode = 1;
}

if (import.meta.main) await main();
