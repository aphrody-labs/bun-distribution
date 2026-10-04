// SPDX-License-Identifier: Apache-2.0
/**
 * `@shenron/pipeline/ai/chat` — `LanguageModelV4` adapter over `/api/v1/shenron/llm/chat` (D9).
 *
 * Runtime class: `pure`. The route neither streams nor accepts tools, files
 * or images: those are rejected with `UnsupportedFunctionalityError`. System
 * instructions become one leading `system` message.
 */
import {
	InvalidPromptError,
	type LanguageModelV4,
	type LanguageModelV4CallOptions,
	type LanguageModelV4GenerateResult,
	type LanguageModelV4Prompt,
	type LanguageModelV4StreamPart,
	type LanguageModelV4Usage,
	type SharedV4Warning,
	UnsupportedFunctionalityError,
} from "@ai-sdk/provider";
import { AiFailureError, type AphrodyChatRole, type AphrodyCompute } from "./aphrody";
import {
	type AiTimeouts,
	type AphrodyChatModelId,
	chatTimeoutMs,
	DEFAULT_AI_TIMEOUTS,
} from "./config";
import { APHRODY_LIMITS } from "./wire";

export interface AphrodyChatWireMessage {
	role: AphrodyChatRole;
	content: string;
}

const encoder = new TextEncoder();

function emptyUsage(): LanguageModelV4Usage {
	return {
		inputTokens: {
			total: undefined,
			noCache: undefined,
			cacheRead: undefined,
			cacheWrite: undefined,
		},
		outputTokens: { total: undefined, text: undefined, reasoning: undefined },
	};
}

/**
 * Converts an AI SDK prompt to the wire messages of `llm/chat`. Every system
 * message is merged into one leading `system` message; user and assistant
 * text parts are concatenated. Anything else is unsupported.
 */
export function toAphrodyMessages(prompt: LanguageModelV4Prompt): AphrodyChatWireMessage[] {
	const system: string[] = [];
	const turns: AphrodyChatWireMessage[] = [];
	for (const message of prompt) {
		if (message.role === "system") {
			if (message.content) system.push(message.content);
			continue;
		}
		if (message.role === "tool") {
			throw new UnsupportedFunctionalityError({ functionality: "tools" });
		}
		let text = "";
		for (const part of message.content) {
			if (part.type === "text") {
				text += part.text;
				continue;
			}
			if (part.type === "file") {
				const media = typeof part.mediaType === "string" ? part.mediaType : "";
				throw new UnsupportedFunctionalityError({
					functionality: media.startsWith("image/") ? "images" : "files",
				});
			}
			if (part.type === "tool-call" || part.type === "tool-result") {
				throw new UnsupportedFunctionalityError({ functionality: "tools" });
			}
			throw new UnsupportedFunctionalityError({ functionality: `${part.type} parts` });
		}
		turns.push({ role: message.role, content: text });
	}
	const messages: AphrodyChatWireMessage[] =
		system.length > 0 ? [{ role: "system", content: system.join("\n\n") }, ...turns] : turns;
	if (messages.length === 0 || messages.length > APHRODY_LIMITS.chatMessages) {
		throw new InvalidPromptError({
			prompt,
			message: `Aphrody chat accepts 1 to ${APHRODY_LIMITS.chatMessages} messages, received ${messages.length}`,
		});
	}
	for (const message of messages) {
		const bytes = encoder.encode(message.content).length;
		if (bytes === 0 || bytes > APHRODY_LIMITS.chatMessageBytes) {
			throw new InvalidPromptError({
				prompt,
				message: `Aphrody chat messages must hold 1 to ${APHRODY_LIMITS.chatMessageBytes} bytes`,
			});
		}
	}
	return messages;
}

/** Call settings `llm/chat` has no field for: reported as warnings instead of silently dropped. */
const IGNORED_SETTINGS = [
	"maxOutputTokens",
	"temperature",
	"stopSequences",
	"topP",
	"topK",
	"presencePenalty",
	"frequencyPenalty",
	"seed",
] as const;

export function ignoredSettingWarnings(options: LanguageModelV4CallOptions): SharedV4Warning[] {
	const warnings: SharedV4Warning[] = [];
	for (const feature of IGNORED_SETTINGS) {
		const value = options[feature];
		if (value === undefined || (Array.isArray(value) && value.length === 0)) continue;
		warnings.push({ type: "unsupported", feature, details: "not forwarded to llm/chat" });
	}
	if (options.responseFormat?.type === "json") {
		warnings.push({
			type: "unsupported",
			feature: "responseFormat",
			details: "llm/chat answers plain text only",
		});
	}
	return warnings;
}

function rejectUnsupported(options: LanguageModelV4CallOptions): void {
	if (options.tools && options.tools.length > 0) {
		throw new UnsupportedFunctionalityError({ functionality: "tools" });
	}
	if (
		options.toolChoice &&
		options.toolChoice.type !== "none" &&
		options.toolChoice.type !== "auto"
	) {
		throw new UnsupportedFunctionalityError({ functionality: "toolChoice" });
	}
}

export interface AphrodyChatModelOptions {
	modelId: AphrodyChatModelId;
}

/** Timeout chosen for a chat model: 125 s for `gemini-web/*`, 90 s otherwise. */
export function chatModelTimeoutMs(
	modelId: string,
	timeouts?: Pick<AiTimeouts, "chat" | "chatGeminiWeb">
): number {
	return chatTimeoutMs(modelId, timeouts ?? DEFAULT_AI_TIMEOUTS);
}

/** `LanguageModelV4` over `llm/chat`. */
export function createAphrodyChatModel(
	compute: Pick<AphrodyCompute, "chat">,
	o: AphrodyChatModelOptions
): LanguageModelV4 {
	const modelId = o.modelId;
	// A blank id sends no `model`: Aphrody keeps its default (compute rejects `model: ""`).
	const wireModel = modelId.trim();

	async function doGenerate(
		options: LanguageModelV4CallOptions
	): Promise<LanguageModelV4GenerateResult> {
		rejectUnsupported(options);
		const messages = toAphrodyMessages(options.prompt);
		// The compute client applies chatTimeoutMs(modelId); an explicit abort signal is combined with it.
		const result = await compute.chat({
			messages,
			...(wireModel ? { model: wireModel } : {}),
			...(options.abortSignal ? { signal: options.abortSignal } : {}),
		});
		if (!result.ok) throw new AiFailureError(result);
		return {
			content: [{ type: "text", text: result.value.answer }],
			finishReason: { unified: "stop", raw: undefined },
			usage: emptyUsage(),
			request: { body: { messages, ...(wireModel ? { model: wireModel } : {}) } },
			response: { modelId: result.value.model },
			warnings: ignoredSettingWarnings(options),
		};
	}

	const model = {
		specificationVersion: "v4",
		provider: "aphrody.shenron",
		modelId,
		supportedUrls: {},
		doGenerate,
		async doStream(options: LanguageModelV4CallOptions) {
			const generated = await doGenerate(options);
			const first = generated.content[0];
			const text = first && first.type === "text" ? first.text : "";
			const parts: LanguageModelV4StreamPart[] = [
				{ type: "stream-start", warnings: generated.warnings },
				{ type: "response-metadata", modelId: generated.response?.modelId ?? modelId },
				{ type: "text-start", id: "0" },
				{ type: "text-delta", id: "0", delta: text },
				{ type: "text-end", id: "0" },
				{ type: "finish", usage: generated.usage, finishReason: generated.finishReason },
			];
			const stream = new ReadableStream<LanguageModelV4StreamPart>({
				start(controller) {
					for (const part of parts) controller.enqueue(part);
					controller.close();
				},
			});
			return { stream, request: generated.request };
		},
	} satisfies LanguageModelV4;
	return model;
}
