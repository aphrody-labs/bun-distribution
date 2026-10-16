// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors & Google DeepMind
/** Model execution belongs to the configured native provider; this module owns its HTTP protocol. */
import { GEMMA4_MODELS, type Gemma4Config } from "./models";
import {
  formatGemma4ChatPrompt,
  Gemma4ResponseParser,
  parseGemma4Response,
  type Gemma4Message,
} from "./tokenizer";
import {
  InferenceError,
  postInferenceEvents,
  postInferenceJson,
  type InferenceTransportOptions,
} from "./transport";
export { InferenceError, type InferenceTransportOptions } from "./transport";

export type InferenceBackend = "local" | "jan" | "openai" | "mock";
export interface UnifiedInferenceRequest extends InferenceTransportOptions {
  readonly prompt: string;
  readonly model?: string | undefined;
  readonly backend?: InferenceBackend | undefined;
  readonly systemPrompt?: string | undefined;
  readonly history?: readonly Gemma4Message[] | undefined;
  /** Legacy simulation prefill; unsupported by the real Chat Completions transport. */
  readonly thought?: string | undefined;
  readonly temperature?: number | undefined;
  readonly maxTokens?: number | undefined;
  readonly topP?: number | undefined;
  /** Provider base URL ending in /v1, or a full /v1/chat/completions URL. */
  readonly endpointUrl?: string | undefined;
}
export interface UnifiedInferenceResponse {
  readonly text: string;
  readonly thought: string | null;
  readonly model: string;
  readonly backend: InferenceBackend;
  readonly latencyMs: number;
  readonly usage: {
    readonly promptTokensEst: number;
    readonly completionTokensEst: number;
    readonly totalTokensEst: number;
    readonly source?: "provider" | "estimate";
  };
}
export interface UnifiedInferenceOptions extends InferenceTransportOptions {
  readonly endpointUrl?: string | undefined;
  /** An explicit caller-owned test double; never selected as an error fallback. */
  readonly mock?:
    | ((request: UnifiedInferenceRequest) => Promise<UnifiedInferenceResponse>)
    | undefined;
}
export interface EmbeddingRequestOptions extends InferenceTransportOptions {
  readonly model?: string | undefined;
  readonly backend?: Exclude<InferenceBackend, "mock"> | undefined;
  readonly endpointUrl?: string | undefined;
  readonly dimensions?: number | undefined;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new InferenceError("Invalid inference provider response");
  return value as Record<string, unknown>;
}
function firstChoice(value: unknown): Record<string, unknown> {
  const choices = object(value).choices;
  if (!Array.isArray(choices) || !choices.length)
    throw new InferenceError("Inference response has no choices");
  return object(choices[0]);
}
function positiveInteger(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new InferenceError(`${name} must be a positive safe integer`);
}

export class UnifiedInferenceEngine {
  readonly defaultConfig: Gemma4Config | undefined;
  readonly defaultModel: string;
  constructor(
    defaultModel: string = "gemma4-e2b",
    readonly options: UnifiedInferenceOptions = {},
  ) {
    if (typeof defaultModel !== "string" || !defaultModel.trim())
      throw new InferenceError("model must be non-empty");
    this.defaultModel = defaultModel;
    const profile = defaultModel.toLowerCase().replace(/_/g, "-");
    this.defaultConfig = Object.hasOwn(GEMMA4_MODELS, profile)
      ? GEMMA4_MODELS[profile]
      : undefined;
  }

  #endpoint(
    backend: InferenceBackend,
    url: string | undefined,
    operation: "chat/completions" | "embeddings",
  ) {
    if (!["local", "jan", "openai"].includes(backend))
      throw new InferenceError(`Unsupported inference backend: ${backend}`);
    const supplied =
      url ??
      this.options.endpointUrl ??
      process.env["YOLO_INFERENCE_ENDPOINT"] ??
      (backend === "jan" ? "http://127.0.0.1:1337/v1" : undefined);
    if (!supplied)
      throw new InferenceError(
        "Configure endpointUrl or YOLO_INFERENCE_ENDPOINT for the native inference provider",
      );
    let endpoint: URL;
    try {
      endpoint = new URL(supplied);
    } catch {
      throw new InferenceError("Invalid inference endpoint URL");
    }
    if (
      !["http:", "https:"].includes(endpoint.protocol) ||
      endpoint.username ||
      endpoint.password
    )
      throw new InferenceError(
        "Inference endpoint must use HTTP(S) without embedded credentials",
      );
    endpoint.pathname =
      endpoint.pathname
        .replace(/\/(?:chat\/completions|embeddings)\/?$/, "")
        .replace(/\/$/, "") + `/${operation}`;
    return endpoint.href;
  }

  #transport(request: InferenceTransportOptions): InferenceTransportOptions {
    const signal =
      request.signal && this.options.signal
        ? AbortSignal.any([request.signal, this.options.signal])
        : (request.signal ?? this.options.signal);
    return {
      apiKey: request.apiKey ?? this.options.apiKey,
      signal,
      timeoutMs: request.timeoutMs ?? this.options.timeoutMs,
      maxResponseBytes:
        request.maxResponseBytes ?? this.options.maxResponseBytes,
    };
  }

  #chat(request: UnifiedInferenceRequest, streaming: boolean) {
    if (typeof request.prompt !== "string" || !request.prompt.trim())
      throw new InferenceError("prompt must be non-empty text");
    if (request.thought !== undefined)
      throw new InferenceError(
        "thought prefill is unsupported by the native Chat Completions transport",
      );
    const messages: Gemma4Message[] = [];
    if (request.systemPrompt)
      messages.push({ role: "system", content: request.systemPrompt });
    messages.push(...(request.history ?? []), {
      role: "user",
      content: request.prompt,
    });
    const formatted = formatGemma4ChatPrompt(messages);
    if (messages.some((message) => message.thought !== undefined))
      throw new InferenceError(
        "History thought prefill is unsupported by the native Chat Completions transport",
      );
    if (messages.some((message) => message.imageCount || message.audioCount))
      throw new InferenceError(
        "Multimodal placeholders are not media payloads; this inference transport supports text messages",
      );
    if (
      request.temperature !== undefined &&
      (!Number.isFinite(request.temperature) ||
        request.temperature < 0 ||
        request.temperature > 2)
    )
      throw new InferenceError("temperature must be between 0 and 2");
    if (
      request.topP !== undefined &&
      (!Number.isFinite(request.topP) || request.topP <= 0 || request.topP > 1)
    )
      throw new InferenceError("topP must be greater than 0 and at most 1");
    positiveInteger(request.maxTokens ?? 1024, "maxTokens");
    const model = request.model ?? this.defaultModel;
    if (typeof model !== "string" || !model.trim())
      throw new InferenceError("model must be non-empty");
    return {
      formatted,
      body: {
        model,
        messages: messages.map((message) => ({
          role: message.role === "model" ? "assistant" : message.role,
          content: message.content,
        })),
        ...(request.temperature !== undefined
          ? { temperature: request.temperature }
          : {}),
        ...(request.topP !== undefined ? { top_p: request.topP } : {}),
        max_tokens: request.maxTokens ?? 1024,
        stream: streaming,
      },
    };
  }

  async infer(
    request: UnifiedInferenceRequest,
  ): Promise<UnifiedInferenceResponse> {
    if (request.backend === "mock") {
      this.#transport(request).signal?.throwIfAborted();
      if (!this.options.mock)
        throw new InferenceError(
          "The mock backend requires an explicitly injected mock handler",
        );
      return { ...(await this.options.mock(request)), backend: "mock" };
    }
    const started = performance.now();
    const backend = request.backend ?? "local";
    const { formatted, body } = this.#chat(request, false);
    const data = object(
      await postInferenceJson(
        this.#endpoint(backend, request.endpointUrl, "chat/completions"),
        body,
        this.#transport(request),
      ),
    );
    const message = object(firstChoice(data).message);
    if (typeof message.content !== "string")
      throw new InferenceError(
        "Inference response has no text message content",
      );
    const parsed = parseGemma4Response(message.content);
    const providerThought = message.reasoning_content ?? message.reasoning;
    if (
      providerThought !== undefined &&
      providerThought !== null &&
      typeof providerThought !== "string"
    )
      throw new InferenceError("Invalid provider reasoning content");
    const usage =
      data.usage === undefined || data.usage === null
        ? undefined
        : object(data.usage);
    const counts = [
      usage?.prompt_tokens,
      usage?.completion_tokens,
      usage?.total_tokens,
    ];
    const providerUsage = counts.every(
      (count) =>
        typeof count === "number" && Number.isSafeInteger(count) && count >= 0,
    );
    if (usage && !providerUsage)
      throw new InferenceError("Invalid inference provider token usage");
    const promptTokensEst = providerUsage
      ? (counts[0] as number)
      : Math.ceil(formatted.length / 4);
    const completionTokensEst = providerUsage
      ? (counts[1] as number)
      : Math.ceil(message.content.length / 4);
    return {
      text: parsed.content,
      thought:
        typeof providerThought === "string" ? providerThought : parsed.thought,
      model:
        typeof data.model === "string" && data.model ? data.model : body.model,
      backend,
      latencyMs: Number((performance.now() - started).toFixed(2)),
      usage: {
        promptTokensEst,
        completionTokensEst,
        totalTokensEst: providerUsage
          ? (counts[2] as number)
          : promptTokensEst + completionTokensEst,
        source: providerUsage ? "provider" : "estimate",
      },
    };
  }

  async *stream(request: UnifiedInferenceRequest): AsyncGenerator<string> {
    if (request.backend === "mock") {
      yield (await this.infer(request)).text;
      return;
    }
    const backend = request.backend ?? "local";
    const { body } = this.#chat(request, true);
    const parser = new Gemma4ResponseParser(false);
    let completed = false;
    let terminal = false;
    for await (const event of postInferenceEvents(
      this.#endpoint(backend, request.endpointUrl, "chat/completions"),
      body,
      this.#transport(request),
    )) {
      if (event.trim() === "[DONE]") {
        completed = true;
        break;
      }
      let data: Record<string, unknown>;
      try {
        data = object(JSON.parse(event));
      } catch {
        throw new InferenceError("Invalid JSON in inference stream");
      }
      if (data.error)
        throw new InferenceError(
          "Inference provider reported a streaming error",
        );
      if (
        Array.isArray(data.choices) &&
        data.choices.length === 0 &&
        data.usage
      )
        continue;
      const choice = firstChoice(data);
      const delta = object(choice.delta);
      if (delta.content !== undefined && delta.content !== null) {
        if (typeof delta.content !== "string")
          throw new InferenceError("Invalid inference stream text delta");
        const text = parser.push(delta.content);
        if (text) yield text;
      }
      if (typeof choice.finish_reason === "string") terminal = true;
    }
    if (!completed && !terminal)
      throw new InferenceError(
        "Inference stream ended without a completion marker",
      );
    const final = parser.finish();
    if (final.text) yield final.text;
  }

  /** Use the provider's real /embeddings endpoint; unsupported providers return an explicit HTTP error. */
  async embed(
    input: string,
    request: EmbeddingRequestOptions = {},
  ): Promise<Float32Array> {
    if (typeof input !== "string" || !input.trim())
      throw new InferenceError("embedding input must be non-empty text");
    if (input.length > 1_048_576)
      throw new InferenceError("embedding input exceeds the text budget");
    if (request.dimensions !== undefined)
      positiveInteger(request.dimensions, "dimensions");
    const model = request.model ?? this.defaultModel;
    if (typeof model !== "string" || !model.trim())
      throw new InferenceError("model must be non-empty");
    const data = object(
      await postInferenceJson(
        this.#endpoint(
          request.backend ?? "local",
          request.endpointUrl,
          "embeddings",
        ),
        {
          model,
          input,
          encoding_format: "float",
          ...(request.dimensions !== undefined
            ? { dimensions: request.dimensions }
            : {}),
        },
        this.#transport(request),
      ),
    );
    if (!Array.isArray(data.data) || data.data.length !== 1)
      throw new InferenceError(
        "Embedding response must contain exactly one vector",
      );
    const vector = object(data.data[0]).embedding;
    if (
      !Array.isArray(vector) ||
      vector.length < 1 ||
      !vector.every(
        (value) => typeof value === "number" && Number.isFinite(value),
      )
    )
      throw new InferenceError("Embedding response contains an invalid vector");
    if (
      request.dimensions !== undefined &&
      vector.length !== request.dimensions
    )
      throw new InferenceError("Embedding response dimension mismatch");
    const result = Float32Array.from(vector as number[]);
    if (!result.every(Number.isFinite))
      throw new InferenceError("Embedding values exceed Float32 range");
    return result;
  }
}
