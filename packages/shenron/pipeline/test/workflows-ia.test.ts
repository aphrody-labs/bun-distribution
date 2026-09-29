// SPDX-License-Identifier: Apache-2.0
/** B5: `runIaTask` injects the citations it fetches into the prompt. */
import { afterEach, describe, expect, test } from "bun:test";
import type { GroundedAnswerInput } from "@shenron/pipeline/ai/generate";
import { INJECTION_GUARD } from "@shenron/pipeline/ai/prompts";
import { runIaTask } from "../src/workflows";

type Model = GroundedAnswerInput["model"];
type CallOptions = Parameters<Model["doGenerate"]>[0];

function mockModel(answer: string) {
	const calls: CallOptions[] = [];
	const usage = {
		inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
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

const savedFetch = globalThis.fetch;
const savedToken = process.env.APHRODY_SHENRON_API_TOKEN;
const savedUrl = process.env.APHRODY_SHENRON_API_URL;

afterEach(() => {
	globalThis.fetch = savedFetch;
	if (savedToken === undefined) delete process.env.APHRODY_SHENRON_API_TOKEN;
	else process.env.APHRODY_SHENRON_API_TOKEN = savedToken;
	if (savedUrl === undefined) delete process.env.APHRODY_SHENRON_API_URL;
	else process.env.APHRODY_SHENRON_API_URL = savedUrl;
});

describe("runIaTask (B5)", () => {
	test("the fetched citations appear in the prompt sent to the model", async () => {
		process.env.APHRODY_SHENRON_API_TOKEN = "fixture-token";
		process.env.APHRODY_SHENRON_API_URL = "http://127.0.0.1:8789";
		const searched: string[] = [];
		globalThis.fetch = (async (input: RequestInfo | URL) => {
			const url = new URL(String(input));
			searched.push(`${url.pathname}?${url.searchParams.get("q")}&${url.searchParams.get("limit")}`);
			return Response.json({
				mode: "hybrid",
				results: [
					{ title: "Namek", url: "/wiki/planetes/namek", snippet: "Planète natale des Nameks.", score: 0.9, kind: "planet" },
					{ title: "Piccolo", url: "/wiki/personnages/piccolo", snippet: "Namek fusionné avec Kami.", score: 0.7, kind: "character" },
				],
			});
		}) as typeof fetch;
		const { model, calls } = mockModel("Les Nameks viennent de Namek.");

		const response = await runIaTask({ task: "D'où viennent les Nameks ?", languageModel: model });

		expect(searched).toEqual(["/api/v1/shenron/rag/search?D'où viennent les Nameks ?&3"]);
		expect(response.content).toBe("Les Nameks viennent de Namek.");
		expect(response.modelUsed).toBe("mock-model");
		expect(response.citations).toEqual([
			{ title: "Namek", snippet: "Planète natale des Nameks.", score: 0.9 },
			{ title: "Piccolo", snippet: "Namek fusionné avec Kami.", score: 0.7 },
		]);
		expect(calls).toHaveLength(1);
		const { system, user } = promptText(calls[0]!);
		expect(user).toContain("- Namek: Planète natale des Nameks.");
		expect(user).toContain("- Piccolo: Namek fusionné avec Kami.");
		expect(user).toContain("D'où viennent les Nameks ?");
		expect(system).toContain("Tu es Shenron");
		expect(system.endsWith(INJECTION_GUARD)).toBe(true);
	});

	test("without RAG the prompt carries the question only", async () => {
		const { model, calls } = mockModel("Réponse.");
		const response = await runIaTask({ task: "Qui est Kami ?", withRag: false, languageModel: model });
		expect(response.citations).toEqual([]);
		expect(promptText(calls[0]!).user).toBe("Qui est Kami ?");
	});

	test("an empty generation is an error, never a silent fallback", async () => {
		const { model } = mockModel("");
		await expect(runIaTask({ task: "Qui est Kami ?", withRag: false, languageModel: model })).rejects.toThrow(
			"Agent Aphrody terminé sans réponse"
		);
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
