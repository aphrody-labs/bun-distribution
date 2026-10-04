import "./setup";
import { afterEach, beforeEach, describe, it, expect } from "bun:test";
import { isChitchat, persona, generateLlmAnswer } from "../src/lib/llm";
import { Database } from "bun:sqlite";

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

/** Pure conversational paths may only reach `llm/chat`: any retrieval request fails the test. */
function chatOnly(handler: (init?: RequestInit) => Response | Promise<Response>): typeof fetch {
  return (async (input, init) => {
    const url = String(input);
    if (!url.endsWith("/api/v1/shenron/llm/chat"))
      throw new Error(`Retrieval-path request forbidden in a pure test: ${url}`);
    return handler(init);
  }) as typeof fetch;
}

describe("isChitchat (bavardage -> pas de RAG, juste de la conversation)", () => {
  it("détecte les salutations / smalltalk", () => {
    for (const q of [
      "bonjour",
      "Salut !",
      "ça va ?",
      "coucou",
      "merci",
      "lol",
      "qui es-tu ?",
      "présente-toi",
    ]) {
      expect(isChitchat(q)).toBe(true);
    }
  });
  it("ne classe PAS une vraie question lore comme bavardage", () => {
    for (const q of [
      "qui est le plus fort entre goku et vegeta ?",
      "Parle-moi de la planète Namek",
      "Qu'est-ce que le Kamehameha ?",
    ]) {
      expect(isChitchat(q)).toBe(false);
    }
  });
});

describe("persona (normalisation + défaut)", () => {
  it("normalise et reconnaît les personas connus", () => {
    expect(persona("Whis")).toBe("whis");
    expect(persona("grandPretre")).toBe("grandpretre");
    expect(persona("BEERUS")).toBe("beerus");
  });
  it("retombe sur whis pour un persona inconnu ou vide", () => {
    expect(persona("inconnu")).toBe("whis");
    expect(persona("")).toBe("whis");
  });
});

describe("generateLlmAnswer (chemin conversationnel & repli)", () => {
  it("envoie le contexte à l'API privée Aphrody", async () => {
    const originalFetch = globalThis.fetch;
    const originalToken = process.env.APHRODY_SHENRON_API_TOKEN;
    process.env.APHRODY_SHENRON_API_TOKEN = "test-token";
    let calledBody: unknown;
    globalThis.fetch = chatOnly((init) => {
      calledBody = JSON.parse(String(init?.body));
      return Response.json({ answer: "Réponse Aphrody", model: "fixture" });
    });
    const db = new Database(":memory:");
    try {
      const answer = await generateLlmAnswer(db, "Salut !", [], "whis");
      expect(answer).toBe("Réponse Aphrody");
      expect(
        (calledBody as { messages: Array<{ role: string }> }).messages.map(
          (message) => message.role,
        ),
      ).toEqual(["system", "user"]);
      expect((calledBody as { model?: string }).model).toBe("gemini-web/flash");
    } finally {
      globalThis.fetch = originalFetch;
      if (originalToken === undefined) delete process.env.APHRODY_SHENRON_API_TOKEN;
      else process.env.APHRODY_SHENRON_API_TOKEN = originalToken;
      db.close();
    }
  });

  it("génère une réponse de repli appropriée si Aphrody est injoignable", async () => {
    const originalFetch = globalThis.fetch;
    const originalToken = process.env.APHRODY_SHENRON_API_TOKEN;
    process.env.APHRODY_SHENRON_API_TOKEN = "test-token";
    globalThis.fetch = chatOnly(() => new Response("", { status: 500 }));
    const db = new Database(":memory:");
    try {
      const ans = await generateLlmAnswer(db, "Salut !", [], "whis");
      expect(ans).toContain("Oh oh, pardonnez-moi");
    } finally {
      globalThis.fetch = originalFetch;
      if (originalToken === undefined) delete process.env.APHRODY_SHENRON_API_TOKEN;
      else process.env.APHRODY_SHENRON_API_TOKEN = originalToken;
      db.close();
    }
  });

  it("renvoie la réponse du repli Beerus en cas d'erreur Aphrody", async () => {
    const originalFetch = globalThis.fetch;
    const originalToken = process.env.APHRODY_SHENRON_API_TOKEN;
    process.env.APHRODY_SHENRON_API_TOKEN = "test-token";
    globalThis.fetch = chatOnly(() => new Response("", { status: 500 }));
    const db = new Database(":memory:");
    try {
      const ans = await generateLlmAnswer(db, "Hé !", [], "beerus");
      expect(ans).toContain("Hmpf");
    } finally {
      globalThis.fetch = originalFetch;
      if (originalToken === undefined) delete process.env.APHRODY_SHENRON_API_TOKEN;
      else process.env.APHRODY_SHENRON_API_TOKEN = originalToken;
      db.close();
    }
  });
});

describe("generateLlmAnswer — corps de requête (B17, bavardage sans récupération)", () => {
  it("envoie système persona + règles, plus la seule phrase anti-injection partagée", async () => {
    const { INJECTION_GUARD, PERSONAS, personaRules } =
      await import("@shenron/pipeline/ai/prompts");
    const originalFetch = globalThis.fetch;
    const saved = {
      token: process.env.APHRODY_SHENRON_API_TOKEN,
      backend: process.env.RAG_BACKEND,
      model: process.env.APHRODY_LLM_MODEL,
    };
    process.env.APHRODY_SHENRON_API_TOKEN = "test-token";
    delete process.env.RAG_BACKEND;
    delete process.env.APHRODY_LLM_MODEL;
    let body: { messages: Array<{ role: string; content: string }>; model?: string } | undefined;
    globalThis.fetch = chatOnly((init) => {
      body = JSON.parse(String(init?.body));
      return Response.json({ answer: "Hmpf, salut.", model: "fixture" });
    });
    const db = new Database(":memory:");
    try {
      const answer = await generateLlmAnswer(db, "Salut !", [], "beerus");
      expect(answer).toBe("Hmpf, salut.");
      const system = `${PERSONAS.beerus.instructions}\n${personaRules(true)}`;
      expect(body).toEqual({
        messages: [
          { role: "system", content: `${system} ${INJECTION_GUARD}` },
          { role: "user", content: "Salut !" },
        ],
        model: "gemini-web/flash",
      });
      // Seul écart (B17) : la phrase anti-injection ajoutée en fin de message système.
      expect(body?.messages[0]?.content.slice(system.length)).toBe(` ${INJECTION_GUARD}`);
    } finally {
      globalThis.fetch = originalFetch;
      for (const [name, value] of [
        ["APHRODY_SHENRON_API_TOKEN", saved.token],
        ["RAG_BACKEND", saved.backend],
        ["APHRODY_LLM_MODEL", saved.model],
      ] as const) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      db.close();
    }
  });
});
