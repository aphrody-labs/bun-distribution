// SPDX-License-Identifier: Apache-2.0
/** B5: `runIaTask` injects citations from the real preloaded RAG into the model prompt. */
import { beforeAll, describe, expect, test } from "bun:test";
import type { GroundedAnswerInput } from "@shenron/pipeline/ai/generate";
import { INJECTION_GUARD } from "@shenron/pipeline/ai/prompts";
import { loadLiveRagEnv, requireLiveRag } from "../src/testing/live-rag";
import { runIaTask } from "../src/workflows";

type Model = GroundedAnswerInput["model"];
type CallOptions = Parameters<Model["doGenerate"]>[0];

/** Chat model stub that only captures the prompt; retrieval is never simulated. */
function capturingModel(answer: string) {
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
    provider: "test.capture",
    modelId: "capture-model",
    supportedUrls: {},
    async doGenerate(options) {
      calls.push(options);
      return {
        content: [{ type: "text", text: answer }],
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

loadLiveRagEnv();
let live: Awaited<ReturnType<typeof requireLiveRag>>;
beforeAll(async () => {
  live = await requireLiveRag();
}, 120_000);

describe("runIaTask with the real preloaded Shenron RAG (B5)", () => {
  test("the citations fetched from the database appear in the prompt sent to the model", async () => {
    const question = "D'où viennent les Nameks ?";
    const { model, calls } = capturingModel("Les Nameks viennent de Namek.");

    const response = await runIaTask({
      task: question,
      languageModel: model,
      env: { APHRODY_HOME: "/nonexistent-aphrody-home" },
    });
    if (!response.citations) throw new Error("The grounded workflow returned no citations");

    expect(live.stats.chunks).toBeGreaterThan(0);
    expect(response.content).toBe("Les Nameks viennent de Namek.");
    expect(response.modelUsed).toBe("capture-model");
    expect(response.citations.length).toBeGreaterThan(0);
    expect(response.citations.length).toBeLessThanOrEqual(3);
    for (const citation of response.citations) {
      expect(citation.title.trim()).not.toBe("");
      expect(citation.snippet.trim()).not.toBe("");
      expect(Number.isFinite(citation.score)).toBe(true);
    }
    expect(calls).toHaveLength(1);
    const { system, user } = promptText(calls[0]!);
    for (const citation of response.citations) {
      expect(user).toContain(`- ${citation.title}: ${citation.snippet}`);
    }
    expect(user).toContain(question);
    expect(system).toContain("Tu es Shenron");
    expect(system.endsWith(INJECTION_GUARD)).toBe(true);
  }, 60_000);
});
