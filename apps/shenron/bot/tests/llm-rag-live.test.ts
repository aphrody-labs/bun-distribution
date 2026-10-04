// SPDX-License-Identifier: Apache-2.0
/**
 * Live qualification of `generateLlmAnswer` over the real preloaded Shenron RAG.
 * Hits come from the actual `hybridSearch(null, query)` (native PG, RAG_BACKEND=aphrody);
 * no retrieval source, snippet or rowid is fabricated. Only the `llm/chat` request is
 * captured and answered; every other HTTP call (RAG, E5, Redis gateway) is delegated untouched.
 * Runs only behind the full `requireLiveRag` gate; there is no bypass.
 */
import "./setup";
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { INJECTION_GUARD, PERSONAS } from "@shenron/pipeline/ai/prompts";
import { loadLiveRagEnv, requireLiveRag } from "@shenron/pipeline/testing/live-rag";

loadLiveRagEnv();
const { generateLlmAnswer } = await import("../src/lib/llm");
const { hybridSearch } = await import("../src/lib/rag");

const realFetch = globalThis.fetch;
const savedInference = process.env.APHRODY_SHENRON_INFERENCE;
beforeEach(() => {
  process.env.APHRODY_SHENRON_INFERENCE = "http";
});
const CHAT_PATH = "/api/v1/shenron/llm/chat";

type ChatBody = { messages: Array<{ role: string; content: string }>; model?: string };
let chatBodies: ChatBody[] = [];

/** Captures and answers only `llm/chat`; delegates all other requests to the real fetch. */
function captureChat(answer: string): void {
  chatBodies = [];
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (new URL(url).pathname !== CHAT_PATH) return realFetch(input, init);
    chatBodies.push(JSON.parse(String(init?.body)) as ChatBody);
    return Response.json({ answer, model: "capture" });
  }) as typeof fetch;
}

/** Semantic cache disabled: never returns an answer, never stores one. */
const noCache = {
  getSemanticCache: async () => null,
  setSemanticCache: async () => {},
};

beforeAll(async () => {
  await requireLiveRag();
}, 120_000);

afterEach(() => {
  if (savedInference === undefined) delete process.env.APHRODY_SHENRON_INFERENCE;
  else process.env.APHRODY_SHENRON_INFERENCE = savedInference;
  globalThis.fetch = realFetch;
});

describe("generateLlmAnswer with the real preloaded Shenron RAG (B17)", () => {
  test("the actual hybridSearch hits reach the prompt with the canonical persona guard", async () => {
    const question = "Où vivent les Nameks ?";
    const { results } = await hybridSearch(null, question, 3);
    expect(results.length).toBeGreaterThan(0);

    captureChat("Sur Namek.");
    const db = new Database(":memory:"); // no rag_chunks: the Aphrody backend carries the content
    try {
      const answer = await generateLlmAnswer(db, question, results, "beerus", { cache: noCache });
      expect(answer).toBe("Sur Namek.");
    } finally {
      db.close();
    }

    expect(chatBodies).toHaveLength(1);
    const [system, user] = chatBodies[0]!.messages;
    expect(system?.role).toBe("system");
    expect(system?.content.startsWith(PERSONAS.beerus.instructions)).toBe(true);
    expect(system?.content.endsWith(` ${INJECTION_GUARD}`)).toBe(true);
    expect(user?.role).toBe("user");
    expect(user?.content).toContain(`Message de l'utilisateur : ${question}`);
    // The first real hit appears verbatim (whitespace-normalized, capped per hit) in the context.
    const first = results[0]!;
    const text = (first.content || first.snippet).replace(/\s+/g, " ").trim().slice(0, 700);
    expect(text.length).toBeGreaterThan(0);
    expect(user?.content).toContain(`- ${first.title}: ${text}`);
  }, 120_000);
});
