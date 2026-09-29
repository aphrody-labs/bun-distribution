// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import type { LanguageModelV4 } from "@ai-sdk/provider";
import { UnsupportedFunctionalityError } from "@ai-sdk/provider";
import { createRecordingFetch } from "@shenron/config/testing";
import { generateText, jsonSchema, streamText, tool } from "ai";
import { createAphrodyCompute } from "../../src/ai/aphrody";
import { chatModelTimeoutMs, createAphrodyChatModel } from "../../src/ai/chat";
import { json, loopbackBase, TOKEN } from "./helpers";

const BASE = loopbackBase();

function setup(modelId = "gemini-web/flash") {
	const rec = createRecordingFetch({
		"POST /api/v1/shenron/llm/chat": () => json({ answer: " Oh oh, bonjour. ", model: modelId }),
	});
	const compute = createAphrodyCompute({ baseUrl: BASE, token: TOKEN }, { fetch: rec.fetch });
	const model = createAphrodyChatModel(compute, { modelId });
	return { rec, model };
}

describe("createAphrodyChatModel", () => {
	test("satisfies LanguageModelV4 (spec v4, provider, no supported URLs)", () => {
		const { model } = setup();
		const typed = model satisfies LanguageModelV4;
		expect(typed.specificationVersion).toBe("v4");
		expect(typed.provider).toBe("aphrody.shenron");
		expect(typed.supportedUrls).toEqual({});
	});

	test("instructions become the leading system message", async () => {
		const { rec, model } = setup();
		const result = await generateText({
			model,
			instructions: "X",
			messages: [{ role: "user", content: "Salut" }],
			maxRetries: 0,
		});
		expect(result.text).toBe("Oh oh, bonjour.");
		expect(result.finishReason).toBe("stop");
		expect(result.usage.inputTokens).toBeUndefined();
		expect(JSON.parse(rec.calls[0]?.body ?? "null")).toEqual({
			messages: [
				{ role: "system", content: "X" },
				{ role: "user", content: "Salut" },
			],
			model: "gemini-web/flash",
		});
	});

	test("assistant history is forwarded as text", async () => {
		const { rec, model } = setup();
		await generateText({
			model,
			messages: [
				{ role: "user", content: "a" },
				{ role: "assistant", content: "b" },
				{
					role: "user",
					content: [
						{ type: "text", text: "c" },
						{ type: "text", text: "d" },
					],
				},
			],
			maxRetries: 0,
		});
		expect(JSON.parse(rec.calls[0]?.body ?? "null").messages).toEqual([
			{ role: "user", content: "a" },
			{ role: "assistant", content: "b" },
			{ role: "user", content: "cd" },
		]);
	});

	test("tools are rejected with UnsupportedFunctionalityError", async () => {
		const { rec, model } = setup();
		const call = generateText({
			model,
			prompt: "x",
			tools: {
				t: tool({ description: "t", inputSchema: jsonSchema({ type: "object", properties: {} }) }),
			},
			maxRetries: 0,
		});
		expect(UnsupportedFunctionalityError.isInstance(await call.catch((e: unknown) => e))).toBe(
			true
		);
		expect(rec.calls.length).toBe(0);
	});

	test("images are rejected with UnsupportedFunctionalityError", async () => {
		const { model } = setup();
		const call = generateText({
			model,
			messages: [
				{
					role: "user",
					content: [{ type: "file", data: new Uint8Array([1, 2, 3]), mediaType: "image/png" }],
				},
			],
			maxRetries: 0,
		});
		expect(UnsupportedFunctionalityError.isInstance(await call.catch((e: unknown) => e))).toBe(
			true
		);
	});

	test("33 messages are rejected, 32 accepted", async () => {
		const { rec, model } = setup();
		const make = (n: number) =>
			Array.from({ length: n }, () => ({ role: "user" as const, content: "x" }));
		await expect(generateText({ model, messages: make(33), maxRetries: 0 })).rejects.toThrow(
			/1 to 32 messages/
		);
		expect(rec.calls.length).toBe(0);
		await generateText({ model, messages: make(32), maxRetries: 0 });
		expect(rec.calls.length).toBe(1);
	});

	test("messages above 32 KiB are rejected", async () => {
		const { model } = setup();
		await expect(
			generateText({ model, prompt: "é".repeat(16 * 1024 + 1), maxRetries: 0 })
		).rejects.toThrow(/32768 bytes/);
	});

	test("timeout choice: 125 s for gemini-web/*, 90 s otherwise", async () => {
		expect(chatModelTimeoutMs("gemini-web/pro")).toBe(125_000);
		expect(chatModelTimeoutMs("qwen3-8b")).toBe(90_000);
		const seen: number[] = [];
		const original = AbortSignal.timeout;
		AbortSignal.timeout = (ms: number) => {
			seen.push(ms);
			return original.call(AbortSignal, ms);
		};
		try {
			await generateText({ model: setup("gemini-web/flash").model, prompt: "x", maxRetries: 0 });
			await generateText({ model: setup("qwen3-8b").model, prompt: "x", maxRetries: 0 });
		} finally {
			AbortSignal.timeout = original;
		}
		expect(seen).toEqual([125_000, 90_000]);
	});

	test("doStream yields a single text chunk", async () => {
		const { model } = setup();
		const result = streamText({ model, prompt: "x", maxRetries: 0 });
		const chunks: string[] = [];
		for await (const part of result.textStream) chunks.push(part);
		expect(chunks).toEqual(["Oh oh, bonjour."]);
	});

	test("HTTP failures surface as errors without the token", async () => {
		const rec = createRecordingFetch({ "*": () => json({ error: "x" }, { status: 502 }) });
		const compute = createAphrodyCompute({ baseUrl: BASE, token: TOKEN }, { fetch: rec.fetch });
		const model = createAphrodyChatModel(compute, { modelId: "gemini-web/flash" });
		const error = await generateText({ model, prompt: "x", maxRetries: 0 }).catch(
			(e: unknown) => e
		);
		expect(String(error)).toContain("HTTP 502");
		expect(String(error)).not.toContain(TOKEN);
	});
});
