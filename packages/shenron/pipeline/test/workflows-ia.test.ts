// SPDX-License-Identifier: Apache-2.0
/** B5: `runIaTask` offline contracts (withRag:false); the RAG contract lives in workflows-rag-live.test.ts. */
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GroundedAnswerInput } from "@shenron/pipeline/ai/generate";
import { buildGroundingInstructions, INJECTION_GUARD } from "@shenron/pipeline/ai/prompts";
import { runIaTask as run, type IaTaskOptions } from "../src/workflows";

type Model = GroundedAnswerInput["model"];
type CallOptions = Parameters<Model["doGenerate"]>[0];

function mockModel(answer: string) {
  const calls: CallOptions[] = [];
  const usage = {
    inputTokens: {
      total: undefined,
      noCache: undefined,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: { total: undefined, text: undefined, reasoning: undefined },
  };
  const model: Model = {
    specificationVersion: "v4",
    provider: "test.mock",
    modelId: "mock-model",
    supportedUrls: {},
    async doGenerate(options) {
      calls.push(options);
      return {
        content: answer ? [{ type: "text", text: answer }] : [],
        finishReason: { unified: "stop", raw: undefined },
        usage,
        warnings: [],
      };
    },
    async doStream() {
      throw new Error("stream not used");
    },
  };
  return { model, calls };
}

function promptText(options: CallOptions): { system: string; user: string } {
  let system = "";
  let user = "";
  for (const message of options.prompt) {
    if (message.role === "system") system += message.content;
    else if (message.role === "user") {
      for (const part of message.content) if (part.type === "text") user += part.text;
    }
  }
  return { system, user };
}

// Environnement hermétique : un état Agent Home vide, jamais le profil réel de la machine.
const sandbox = mkdtempSync(join(tmpdir(), "shenron-ia-home-"));
const noHome = { APHRODY_HOME: join(sandbox, "vide") };
const runIaTask = (options: IaTaskOptions) => run({ env: noHome, ...options });

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

const savedFetch = globalThis.fetch;
const savedToken = process.env.APHRODY_SHENRON_API_TOKEN;
const savedUrl = process.env.APHRODY_SHENRON_API_URL;

let fetchCalls = 0;
beforeEach(() => {
  fetchCalls = 0;
  globalThis.fetch = (() => {
    fetchCalls++;
    throw new Error("retrieval is forbidden in unit tests");
  }) as unknown as typeof fetch;
});

afterEach(() => {
  expect(fetchCalls).toBe(0);
  globalThis.fetch = savedFetch;
  if (savedToken === undefined) delete process.env.APHRODY_SHENRON_API_TOKEN;
  else process.env.APHRODY_SHENRON_API_TOKEN = savedToken;
  if (savedUrl === undefined) delete process.env.APHRODY_SHENRON_API_URL;
  else process.env.APHRODY_SHENRON_API_URL = savedUrl;
});

describe("runIaTask (B5)", () => {
  test("without RAG the prompt carries the question only", async () => {
    const { model, calls } = mockModel("Réponse.");
    const response = await runIaTask({
      task: "Qui est Kami ?",
      withRag: false,
      languageModel: model,
    });
    expect(response.citations).toEqual([]);
    expect(promptText(calls[0]!).user).toBe("Qui est Kami ?");
  });

  test("an empty generation is an error, never a silent fallback", async () => {
    const { model } = mockModel("");
    await expect(
      runIaTask({ task: "Qui est Kami ?", withRag: false, languageModel: model }),
    ).rejects.toThrow("Agent Aphrody terminé sans réponse");
  });

  test("the legacy chat function receives the grounded prompt and names the model", async () => {
    let received = "";
    const response = await runIaTask({
      task: "Qui est Kami ?",
      withRag: false,
      model: "gemini-web/pro",
      chat: async (prompt, model) => {
        received = prompt;
        return { answer: `ok ${model}`, model: "gemini-web/pro" };
      },
    });
    expect(response).toMatchObject({ content: "ok gemini-web/pro", modelUsed: "gemini-web/pro" });
    expect(received).toContain("Tu es Shenron");
    expect(received.endsWith("Qui est Kami ?")).toBe(true);
  });
});

function fixtureState(name: string, domain: string, tone: string): Record<string, string> {
  const state = join(sandbox, name);
  const dir = join(state, "workspaces", domain);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "SOUL.md"),
    `---\ntone: "${tone}"\nbrevity: "terse"\n---\n\nCORPUS-SENTINEL\n`,
  );
  writeFileSync(join(dir, "IDENTITY.md"), '---\nvibe: "Vibe fixture"\n---\n');
  writeFileSync(join(dir, "MEMORY.md"), "MEMORY-SENTINEL");
  return { APHRODY_HOME: state, APHRODY_AGENT_DOMAIN: domain, APHRODY_WORKSPACE: dir };
}

describe("runIaTask : Agent Home du domaine", () => {
  test("le ton et le style du profil entrent dans le système, le garde reste en dernier", async () => {
    const env = fixtureState("home-dbfr", "dbfr", "ton profil fixture");
    const { model, calls } = mockModel("Réponse.");
    await runIaTask({ task: "Qui est Kami ?", withRag: false, languageModel: model, env });
    const { system, user } = promptText(calls[0]!);
    expect(system).toContain("Tu es Shenron");
    expect(system).toContain(
      "- Ton : ton profil fixture\n- Concision : terse\n- Ambiance : Vibe fixture",
    );
    expect(system.endsWith(INJECTION_GUARD)).toBe(true);
    expect(system.split(INJECTION_GUARD)).toHaveLength(2);
    // Ni le corps du profil, ni la mémoire, ni le corpus n'atteignent le prompt.
    for (const sentinel of ["CORPUS-SENTINEL", "MEMORY-SENTINEL"]) {
      expect(system).not.toContain(sentinel);
      expect(user).not.toContain(sentinel);
    }
    expect(user).toBe("Qui est Kami ?");
  });

  test("la fonction `chat` héritée reçoit aussi la persona du profil", async () => {
    const env = fixtureState("home-chat", "dbfr", "ton chat fixture");
    let received = "";
    await runIaTask({
      task: "Qui est Kami ?",
      withRag: false,
      env,
      chat: async (prompt) => {
        received = prompt;
        return { answer: "ok", model: "fixture" };
      },
    });
    expect(received).toContain("- Ton : ton chat fixture");
    expect(received.indexOf("- Ton : ton chat fixture")).toBeLessThan(
      received.indexOf(INJECTION_GUARD),
    );
    expect(received.endsWith("Qui est Kami ?")).toBe(true);
  });

  test("profil absent : le système est exactement la persona canonique", async () => {
    const { model, calls } = mockModel("Réponse.");
    await runIaTask({ task: "Qui est Kami ?", withRag: false, languageModel: model });
    expect(promptText(calls[0]!).system).toBe(
      buildGroundingInstructions("shenron", undefined, { chitchat: false }),
    );
  });

  test("domaine ie : persona canonique, le profil ie n'est pas appliqué et dbfr n'est pas lu", async () => {
    const ieEnv = fixtureState("home-ie", "ie", "ton ie fixture");
    // Un profil dbfr piégé dans le même état : s'il était lu, SOUL.md (un dossier) lèverait EISDIR.
    mkdirSync(join(ieEnv.APHRODY_HOME!, "workspaces", "dbfr", "SOUL.md"), { recursive: true });
    const { model, calls } = mockModel("Réponse.");
    await runIaTask({ task: "Qui est Kami ?", withRag: false, languageModel: model, env: ieEnv });
    const { system } = promptText(calls[0]!);
    expect(system).toBe(buildGroundingInstructions("shenron", undefined, { chitchat: false }));
    expect(system).not.toContain("ton ie fixture");
  });

  test("configuration invalide : rejet avant toute récupération ou génération", async () => {
    const { model, calls } = mockModel("Réponse.");
    const env = { ...fixtureState("home-conflit", "dbfr", "x"), APHRODY_AGENT_DOMAIN: "ie" };
    await expect(runIaTask({ task: "Qui est Kami ?", languageModel: model, env })).rejects.toThrow(
      "Agent Home invalide",
    );
    expect(fetchCalls).toBe(0);
    expect(calls).toHaveLength(0);
  });
});
