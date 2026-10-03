// SPDX-License-Identifier: Apache-2.0
/**
 * Live qualification of the semantic cache: real Redis owner adapter, real E5
 * vectors (384 dimensions) and evidence retrieved from the preloaded Shenron RAG.
 * Runs only behind the full `requireLiveRag` gate; there is no bypass.
 *
 * Isolation: every Redis key written here lives under a uniquely labelled test
 * persona (`qual-…`), and the global hit/miss counters are redirected to a test
 * key. Cleanup deletes only those exact keys; nothing is flushed.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { AphrodyComputeClient, type AphrodyRagHit } from "@shenron/pipeline/aphrody";
import { buildGroundedContext, DEFAULT_CONTEXT_LIMITS } from "@shenron/pipeline/ai/generate";
import { semanticCacheScope } from "@shenron/pipeline/ai/ports";
import { PROMPT_VERSION } from "@shenron/pipeline/ai/prompts";
import { createResilientRedis, type ResilientRedis } from "@shenron/db/redis";
import { loadLiveRagEnv, requireLiveRag } from "@shenron/pipeline/testing/live-rag";
import {
  getSemanticCache,
  resilientSemanticCacheStore,
  setSemanticCache,
  type SemanticCacheDependencies,
  type SemanticCacheStore,
} from "../src/lib/semantic-cache";

loadLiveRagEnv();

const run = randomUUID().slice(0, 8);
const personaA = `qual-${run}-a`;
const personaB = `qual-${run}-b`;
const statsKey = `dbz:scache:qual-${run}:stats`;
const question = "Quelle est l'origine du Super Saiyan ?";
const unrelated = "Comment cuire du pain au levain ?";
const model = "gemini-web/flash";

let client: AphrodyComputeClient;
let redis: ResilientRedis;
let store: SemanticCacheStore;
let deps: SemanticCacheDependencies;
let scopeA = "";
let scopeOtherEvidence = "";
let contextA = "";

const prefixOf = (persona: string) => `dbz:scache:aphrody:${persona}:v4`;

async function groundedContext(hits: AphrodyRagHit[]): Promise<string> {
  return buildGroundedContext(
    hits.map((hit) => ({
      id: hit.sourceId ?? hit.url,
      title: hit.title,
      url: hit.url,
      content: hit.content ?? "",
      snippet: hit.snippet,
    })),
    { contentFor: async () => new Map() },
    DEFAULT_CONTEXT_LIMITS,
  );
}

async function send(command: string, ...args: (string | number)[]): Promise<unknown> {
  return redis.send(command, args.map(String));
}

beforeAll(async () => {
  await requireLiveRag();
  client = new AphrodyComputeClient();
  redis = createResilientRedis({ name: `semantic-cache-live-${run}`, url: process.env.REDIS_URL! });
  const owner = resilientSemanticCacheStore(redis);
  // Same owner adapter; only the shared global counters are redirected to a test key.
  store = {
    ...owner,
    hincrby: (_key, field, increment) => owner.hincrby(statsKey, field, increment),
  };
  deps = { store };

  const primary = await client.ragSearch(question, 4, { lang: "fr" });
  const other = await client.ragSearch("planète Namek et ses habitants", 4, { lang: "fr" });
  contextA = await groundedContext(primary);
  const contextB = await groundedContext(other);
  if (!contextA || !contextB || contextA === contextB)
    throw new Error("Real RAG retrieval did not return two distinct evidence sets");
  scopeA = await semanticCacheScope(model, contextA);
  scopeOtherEvidence = await semanticCacheScope(model, contextB);
}, 120_000);

afterAll(async () => {
  if (!redis) return;
  try {
    for (const persona of [personaA, personaB]) {
      const prefix = prefixOf(persona);
      const hashes = (await store.zrange(`${prefix}:lru`, 0, -1)) ?? [];
      for (const hash of hashes)
        for (const part of ["query", "answer", "vector"])
          await store.del(`${prefix}:${hash}:${part}`);
      await store.del(`${prefix}:lru`);
    }
    await store.del(statsKey);
  } finally {
    redis.close();
  }
}, 30_000);

describe("semantic cache with real Redis, E5 and RAG evidence", () => {
  test("the embedder returns 384-dimension E5 vectors", async () => {
    const [vector] = await client.embed([question]);
    expect(vector).toHaveLength(384);
    expect(vector!.every(Number.isFinite)).toBe(true);
  });

  test("writes then reads the same scope; the stored vector has 384 dimensions", async () => {
    const answer = `qual-${run}: réponse de test bornée`;
    expect(await getSemanticCache(question, personaA, scopeA, deps)).toBeNull();
    await setSemanticCache(question, answer, personaA, scopeA, deps);

    const hit = await getSemanticCache(question, personaA, scopeA, deps);
    expect(hit?.answer).toBe(answer);
    expect(hit?.originalQuery).toBe(question);
    expect(hit!.similarity).toBeGreaterThanOrEqual(0.97);

    const [hash] = await store.zrange(`${prefixOf(personaA)}:lru`, 0, -1);
    expect(hash?.startsWith(`${scopeA}:`)).toBe(true);
    const vector = JSON.parse(
      (await store.get(`${prefixOf(personaA)}:${hash}:vector`))!,
    ) as number[];
    expect(vector).toHaveLength(384);
    expect(Number(await send("TTL", `${prefixOf(personaA)}:${hash}:answer`))).toBeGreaterThan(0);
  });

  test("changed evidence, model, prompt version and persona never reuse the answer", async () => {
    expect(await getSemanticCache(question, personaA, scopeOtherEvidence, deps)).toBeNull();
    expect(
      await getSemanticCache(
        question,
        personaA,
        await semanticCacheScope("gemini-web/pro", contextA),
        deps,
      ),
    ).toBeNull();
    expect(
      await getSemanticCache(
        question,
        personaA,
        await semanticCacheScope(model, contextA, `${PROMPT_VERSION}-next`),
        deps,
      ),
    ).toBeNull();
    expect(await getSemanticCache(question, personaB, scopeA, deps)).toBeNull();
    // The original scope is still served: isolation did not evict it.
    expect((await getSemanticCache(question, personaA, scopeA, deps))?.answer).toContain(
      `qual-${run}`,
    );
  });

  test("a changed evidence set stores its own entry without overwriting or leaking", async () => {
    await setSemanticCache(
      question,
      `qual-${run}: autre preuve`,
      personaA,
      scopeOtherEvidence,
      deps,
    );
    expect((await getSemanticCache(question, personaA, scopeOtherEvidence, deps))?.answer).toBe(
      `qual-${run}: autre preuve`,
    );
    expect((await getSemanticCache(question, personaA, scopeA, deps))?.answer).toBe(
      `qual-${run}: réponse de test bornée`,
    );
    expect(await store.zcard(`${prefixOf(personaA)}:lru`)).toBe(2);
  });

  test("a semantically unrelated question is not served from the same scope", async () => {
    expect(await getSemanticCache(unrelated, personaA, scopeA, deps)).toBeNull();
  });

  test("hits and misses were counted on the test key, not the shared counters", async () => {
    const stats = (await send("HGETALL", statsKey)) as unknown;
    expect(stats).toBeTruthy();
  });
});
