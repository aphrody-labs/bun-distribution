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
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { AphrodyComputeClient } from "../../../../../packages/shenron/pipeline/src/aphrody/compute";
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
const COMPUTE_SERVICES = ["aphrody-shenron-embed", "aphrody-ai-http"];

const sha256 = (bytes: string | Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

async function fileSha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function command(args: string[], cwd: string): Promise<string> {
  const child = Bun.spawn(args, { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, , exit] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  // Command errors may contain private paths or env-derived connection data.
  if (exit !== 0) throw new Error(`Qualification command failed: ${args[0]} (exit ${exit})`);
  return stdout.trim();
}

async function requireProcessBinary(pid: number, release: string, binary: string): Promise<void> {
  if (!Number.isSafeInteger(pid) || pid < 1) throw new Error(`No live process for ${binary}`);
  const expected = await realpath(join(release, "bin", binary));
  if (
    (await realpath(`/proc/${pid}/exe`)) !== expected ||
    (await fileSha256(`/proc/${pid}/exe`)) !== (await fileSha256(expected))
  ) {
    throw new Error(`Live ${binary} does not belong to the release`);
  }
}

async function requireListenerBinary(url: URL, release: string, binary: string): Promise<void> {
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
    throw new Error("Compute attestation requires local loopback services");
  const port = Number(url.port || "80");
  const listeners = await command(["ss", "-H", "-ltnp", `( sport = :${port} )`], REPO_ROOT);
  const pids = [...new Set([...listeners.matchAll(/pid=(\d+)/g)].map((match) => Number(match[1])))];
  if (pids.length !== 1) throw new Error(`Cannot identify one live listener for ${binary}`);
  await requireProcessBinary(pids[0]!, release, binary);
}

/** Begin a qualification of actual release processes and the complete real corpus. */
async function prepareAttestation(releasePath: string) {
  if (process.platform !== "linux")
    throw new Error("Compute attestation requires Linux process provenance");
  const { loadLiveRagEnv, requireLiveRag } =
    await import("../../../../../packages/shenron/pipeline/src/testing/live-rag");
  loadLiveRagEnv();
  const preload = await requireLiveRag();
  const release = await realpath(resolve(releasePath));
  if (await Bun.file(join(release, "SMOKE.json")).exists())
    throw new Error("Release already has SMOKE.json; qualify a new immutable release");
  await command(["sha256sum", "--quiet", "--check", "SHA256SUMS"], release);
  const source = (await Bun.file(join(release, "SOURCE.json")).json()) as {
    repositoryCommit?: string;
  };
  if (!/^[0-9a-f]{40}$/.test(source.repositoryCommit ?? ""))
    throw new Error("Release source commit is missing");
  const canonicalGold = await command(
    ["git", "show", `${source.repositoryCommit}:apps/shenron/bot/tests/rag-gold.jsonl`],
    REPO_ROOT,
  );
  await requireListenerBinary(new URL(aphrodyApiUrlFromEnv()), release, "aphrody-mcp");
  const embedUrl =
    process.env.APHRODY_AI_EMBED_BASE_URL ?? process.env.APHRODY_SHENRON_EMBED_BASE_URL;
  if (!embedUrl) throw new Error("Real E5 endpoint is not configured");
  await requireListenerBinary(new URL(embedUrl), release, "aphrody-embed");
  const reportPath =
    process.env.SHENRON_RAG_REPORT ??
    join(homedir(), ".aphrody/workspaces/dbfr/indexes/shenron-rag-latest.json");
  const preloadSha256 = sha256(await Bun.file(reportPath).bytes());
  return { release, canonicalGold, preload, preloadSha256, reportPath, requireLiveRag, embedUrl };
}

type Attestation = Awaited<ReturnType<typeof prepareAttestation>>;

async function attestCompute(
  attestation: Attestation,
  client: AphrodyComputeClient,
  recall5: number,
  p95Ms: number,
  modes: Record<string, number>,
  goldSha256: string,
): Promise<void> {
  if (
    recall5 < 0.8 ||
    p95Ms >= 8000 ||
    Object.keys(modes).some((mode) => !["hybrid", "hybrid+rerank"].includes(mode))
  )
    throw new Error("Compute attestation requires Recall@5 >= 0.8, p95 < 8 s and hybrid retrieval");
  const { results } = await client.ragSearchWithMode("Quelle race est Vegeta ?", 3);
  const vectors = await client.embed(["Quelle race est Vegeta ?"]);
  if (vectors.length !== 1 || vectors[0]!.length !== 384 || !vectors[0]!.every(Number.isFinite))
    throw new Error("Real E5 embedding is invalid");
  const started = performance.now();
  const answer = await client.chat([
    {
      role: "system",
      content:
        "Réponds en une phrase française avec uniquement les passages fournis. Cite une URL exacte des sources.",
    },
    {
      role: "user",
      content:
        "Quelle race est Vegeta ?\n" +
        results
          .map((hit) => `${hit.title}\n${hit.url}\n${(hit.content ?? hit.snippet).slice(0, 850)}`)
          .join("\n\n"),
    },
  ]);
  const latencyMs = Math.round(performance.now() - started);
  if (
    latencyMs >= 90_000 ||
    answer.model.startsWith("gemini-web/") ||
    !results.some(
      (hit) => hit.url.startsWith("https://dragonballfr.com/") && answer.answer.includes(hit.url),
    )
  )
    throw new Error(
      "Managed model did not provide a timely answer citing a retrieved Dragon Ball source",
    );
  const stateRoot = process.env.APHRODY_HOME ?? join(homedir(), ".aphrody");
  const state = (await Bun.file(join(stateRoot, "run/llama-server-chat.json")).json()) as {
    ready?: boolean;
    daemon_pid: number;
    server_pid: number;
    alias: string;
    model: string;
  };
  if (!state.ready || state.alias !== answer.model)
    throw new Error("Managed model state disagrees with the answer");
  await requireProcessBinary(state.daemon_pid, attestation.release, "aphrody-llama-daemon");
  const lora = process.env.APHRODY_SHENRON_CHAT_LORA;
  if (!lora) throw new Error("Shenron LoRA is not configured");
  const argv = (await Bun.file(`/proc/${state.server_pid}/cmdline`).text()).split("\0");
  if (!argv.some((arg, index) => arg === "--lora" && argv[index + 1] === lora))
    throw new Error("Live managed model did not load the configured Shenron LoRA");
  const health = await client.health();
  if (!health.llm || !health.rag) throw new Error("Real LLM/RAG health is unavailable");
  const after = await attestation.requireLiveRag();
  if (
    after.completedAt !== attestation.preload.completedAt ||
    sha256(await Bun.file(attestation.reportPath).bytes()) !== attestation.preloadSha256
  )
    throw new Error("Corpus preload changed during qualification");
  await requireListenerBinary(new URL(aphrodyApiUrlFromEnv()), attestation.release, "aphrody-mcp");
  await requireListenerBinary(new URL(attestation.embedUrl), attestation.release, "aphrody-embed");
  await command(["sha256sum", "--quiet", "--check", "SHA256SUMS"], attestation.release);
  const smoke = {
    schema: "aphrody-compute-smoke/v1",
    status: "ok",
    mode: "compute",
    source: "live-services",
    measuredAt: new Date().toISOString(),
    releaseId: (await Bun.file(join(attestation.release, "RELEASE_ID")).text()).trim(),
    sha256sums: sha256(await Bun.file(join(attestation.release, "SHA256SUMS")).bytes()),
    services: COMPUTE_SERVICES,
    goldSha256,
    preloadSha256: attestation.preloadSha256,
    rag: {
      chunks: after.stats.chunks,
      vectors: after.stats.vectors,
      corpusComplete: true,
      recall5,
      p95Ms,
      retrievalErrors: 0,
      modes,
    },
    llm: {
      ready: true,
      provider: "managed",
      model: answer.model,
      latencyMs,
      citedRetrievedSource: true,
      modelSha256: await fileSha256(state.model),
      adapterSha256: await fileSha256(lora),
    },
  };
  // Nothing is published until every real-data and process check has passed.
  const temporary = join(attestation.release, `.SMOKE.${process.pid}.json`);
  await Bun.write(temporary, JSON.stringify(smoke, null, 2) + "\n");
  const { rename } = await import("node:fs/promises");
  await rename(temporary, join(attestation.release, "SMOKE.json"));
}

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
  const args = process.argv.slice(2);
  let releasePath: string | undefined;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--ci") continue;
    if (args[index] === "--attest-release" && !releasePath && args[index + 1])
      releasePath = args[++index];
    else throw new Error("Usage: eval-aphrody-rag.ts [--ci] [--attest-release <compute-release>]");
  }
  const attestation = releasePath ? await prepareAttestation(releasePath) : undefined;
  const goldPath = resolveDataPath("ragGold", {
    env: process.env,
    legacyDefault: join(REPO_ROOT, "apps", "shenron", "bot", "tests", "rag-gold.jsonl"),
  }).path;
  const goldText = await Bun.file(goldPath).text();
  if (attestation && goldText.trim() !== attestation.canonicalGold)
    throw new Error(
      "Compute attestation requires the canonical gold set from the release source commit",
    );
  const gold = parseGold(goldText);
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
  if (attestation) {
    if (!gate.pass)
      throw new Error("Real retrieval activation gate failed; no SMOKE.json was written");
    await attestCompute(
      attestation,
      client,
      metrics.recall[5],
      latencyMs.p95,
      modes,
      sha256(goldText),
    );
  }
  if (process.argv.includes("--ci") && !gate.pass) process.exitCode = 1;
}

if (import.meta.main) await main();
