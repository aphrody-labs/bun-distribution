import { afterEach, beforeEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { generateLlmAnswer } from "../src/lib/llm";

// No address default since the AI env contract (aphrody-infra local-ai.json): the
// tests pin the aphrody-ai-http origin through its canonical name.
const savedAiHttpUrl = process.env.APHRODY_AI_HTTP_URL;
const savedInference = process.env.APHRODY_SHENRON_INFERENCE;
beforeEach(() => {
  process.env.APHRODY_SHENRON_INFERENCE = "http";
  process.env.APHRODY_AI_HTTP_URL = "http://127.0.0.1:8789";
});
afterEach(() => {
  if (savedInference === undefined) delete process.env.APHRODY_SHENRON_INFERENCE;
  else process.env.APHRODY_SHENRON_INFERENCE = savedInference;
  if (savedAiHttpUrl === undefined) delete process.env.APHRODY_AI_HTTP_URL;
  else process.env.APHRODY_AI_HTTP_URL = savedAiHttpUrl;
});

const savedFetch = globalThis.fetch;
const savedBackend = process.env.RAG_BACKEND;
const savedToken = process.env.APHRODY_SHENRON_API_TOKEN;
const savedModel = process.env.APHRODY_LLM_MODEL;

afterEach(() => {
  globalThis.fetch = savedFetch;
  for (const [key, value] of Object.entries({
    RAG_BACKEND: savedBackend,
    APHRODY_SHENRON_API_TOKEN: savedToken,
    APHRODY_LLM_MODEL: savedModel,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("the same question only reuses a cached answer with the same evidence and model", async () => {
  process.env.RAG_BACKEND = "aphrody";
  process.env.APHRODY_SHENRON_API_TOKEN = "fixture";
  delete process.env.APHRODY_LLM_MODEL;
  const answers = new Map<string, string>();
  const scopes: string[] = [];
  const cache = {
    getSemanticCache: async (query: string, persona: string, scope: string) => {
      scopes.push(scope);
      const answer = answers.get(`${persona}:${scope}:${query}`);
      return answer ? { answer, originalQuery: query, similarity: 1 } : null;
    },
    setSemanticCache: async (query: string, answer: string, persona: string, scope: string) => {
      answers.set(`${persona}:${scope}:${query}`, answer);
    },
  };
  let modelCalls = 0;
  globalThis.fetch = (async () =>
    Response.json({ answer: `Réponse ${++modelCalls}`, model: "fixture" })) as typeof fetch;
  const db = new Database(":memory:");
  const hit = (content: string) => ({
    rowid: 1,
    kind: "planet",
    title: "Namek",
    url: "/wiki/planetes/namek",
    snippet: content,
    content,
    score: 1,
  });
  try {
    const first = await generateLlmAnswer(
      db,
      "Où vivent les Nameks ?",
      [hit("Ils vivent sur Namek.")],
      "whis",
      { cache },
    );
    const changedEvidence = await generateLlmAnswer(
      db,
      "Où vivent les Nameks ?",
      [hit("Ils vivent sur Terre.")],
      "whis",
      { cache },
    );
    const repeat = await generateLlmAnswer(
      db,
      "Où vivent les Nameks ?",
      [hit("Ils vivent sur Namek.")],
      "whis",
      { cache },
    );
    process.env.APHRODY_LLM_MODEL = "gemini-web/pro";
    const changedModel = await generateLlmAnswer(
      db,
      "Où vivent les Nameks ?",
      [hit("Ils vivent sur Namek.")],
      "whis",
      { cache },
    );
    expect([first, changedEvidence, repeat, changedModel]).toEqual([
      "Réponse 1",
      "Réponse 2",
      "Réponse 1",
      "Réponse 3",
    ]);
    expect(modelCalls).toBe(3);
    expect(scopes[0]).toBe(scopes[2]);
    expect(scopes[0]).not.toBe(scopes[1]);
    expect(scopes[0]).not.toBe(scopes[3]);
  } finally {
    db.close();
  }
});

test("B7: the cache scope binds the model, PROMPT_VERSION and the evidence", async () => {
  const { semanticCacheScope } = await import("@shenron/pipeline/ai/ports");
  const { PROMPT_VERSION } = await import("@shenron/pipeline/ai/prompts");
  process.env.RAG_BACKEND = "aphrody";
  process.env.APHRODY_SHENRON_API_TOKEN = "fixture";
  delete process.env.APHRODY_LLM_MODEL;
  const scopes: string[] = [];
  const cache = {
    getSemanticCache: async (_query: string, _persona: string, scope: string) => {
      scopes.push(scope);
      return null;
    },
    setSemanticCache: async () => {},
  };
  globalThis.fetch = (async () =>
    Response.json({ answer: "Réponse", model: "fixture" })) as typeof fetch;
  const db = new Database(":memory:");
  try {
    await generateLlmAnswer(
      db,
      "Où vivent les Nameks ?",
      [
        {
          rowid: 1,
          kind: "planet",
          title: "Namek",
          url: "/wiki/planetes/namek",
          snippet: "Ils vivent sur Namek.",
          content: "Ils vivent sur Namek.",
          score: 1,
        },
      ],
      "whis",
      { cache },
    );
    const context = "- Namek: Ils vivent sur Namek.";
    expect(scopes).toEqual([await semanticCacheScope("gemini-web/flash", context, PROMPT_VERSION)]);
    expect(scopes[0]).not.toBe(
      await semanticCacheScope("gemini-web/flash", context, `${PROMPT_VERSION}-next`),
    );
  } finally {
    db.close();
  }
});
