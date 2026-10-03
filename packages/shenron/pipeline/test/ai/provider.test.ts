// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { createRecordingFetch } from "@shenron/config/testing";
import { generateText } from "ai";
import { createAphrodyCompute } from "../../src/ai/aphrody";
import { resolveAiConfig } from "../../src/ai/config";
import { createOpenAICompatibleChat, createShenronProvider } from "../../src/ai/provider";
import { json, loopbackBase, TOKEN, vector } from "./helpers";

const BASE = loopbackBase();

function config(env: Record<string, string>) {
	const r = resolveAiConfig(env);
	if (!r.ok) throw new Error(JSON.stringify(r.issues));
	return r.config;
}

describe("createShenronProvider", () => {
	test("chat, chat-flash-lite, chat-pro, e5-query and e5-passage", async () => {
		const rec = createRecordingFetch({
			"POST /api/v1/shenron/llm/chat": async (req) => {
				const body = (await req.json()) as { model: string };
				return json({ answer: `via ${body.model}`, model: body.model });
			},
			"POST /api/v1/shenron/embed": async (req) => {
				const body = (await req.json()) as { texts: string[] };
				return json({ vectors: body.texts.map((_, i) => vector(i)) });
			},
		});
		const cfg = config({
			APHRODY_SHENRON_API_URL: BASE.href,
			APHRODY_SHENRON_API_TOKEN: TOKEN,
			APHRODY_LLM_MODEL: "gemini-web/flash",
		});
		const compute = createAphrodyCompute(cfg.compute ?? { baseUrl: BASE, token: TOKEN }, {
			fetch: rec.fetch,
		});
		const provider = createShenronProvider(cfg, { compute });

		for (const [id, model] of [
			["chat", "gemini-web/flash"],
			["chat-flash-lite", "gemini-web/flash-lite"],
			["chat-pro", "gemini-web/pro"],
		] as const) {
			const lm = provider.languageModel(id);
			expect(lm.modelId).toBe(model);
			const { text } = await generateText({ model: lm, prompt: "x", maxRetries: 0 });
			expect(text).toBe(`via ${model}`);
		}
		expect(provider.embeddingModel("e5-query").provider).toBe("aphrody.shenron");
		expect(provider.embeddingModel("e5-passage").modelId).toBe("Xenova/multilingual-e5-small");
	});

	test("disabled capabilities are absent", () => {
		const provider = createShenronProvider(config({}), { compute: null });
		expect(() => provider.languageModel("chat")).toThrow();
		expect(() => provider.embeddingModel("e5-query")).toThrow();
	});

	test("a direct embedder URL alone enables no embedding model", () => {
		const cfg = config({ APHRODY_SHENRON_EMBED_BASE_URL: loopbackBase(18794, "/v1").href });
		const provider = createShenronProvider(cfg, { compute: null });
		expect(() => provider.embeddingModel("e5-passage")).toThrow();
		expect(() => provider.languageModel("chat")).toThrow();
	});

	test("createOpenAICompatibleChat stays ready for APH-3 (not wired)", () => {
		const model = createOpenAICompatibleChat({
			baseUrl: loopbackBase(18800, "/v1"),
			token: TOKEN,
			modelId: "m",
		});
		expect(model.specificationVersion).toBe("v4");
		expect(model.modelId).toBe("m");
	});
});
