// SPDX-License-Identifier: Apache-2.0
/**
 * `@shenron/pipeline/ai/embeddings` — E5 embedding models and hot-path helpers (D10).
 *
 * Runtime class: `pure`.
 *
 * - Aphrody transport (`POST /api/v1/shenron/embed`): the server adds the E5
 *   prefix, so the client adds NONE.
 * - E5-direct transport (`aphrody-shenron-embed` `/v1/embeddings`): the
 *   client prefixes exactly once.
 * Both collapse whitespace, send at most 16 inputs per call, sequentially,
 * and check count, index order, 384 dimensions and finite values. The
 * transport is chosen by configuration, never by per-request failover.
 */
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
	APICallError,
	type EmbeddingModelV4,
	type EmbeddingModelV4Middleware,
	type EmbeddingModelV4Result,
} from "@ai-sdk/provider";
import { embed, embedMany, wrapEmbeddingModel } from "ai";
import {
	type AiFailure,
	AiFailureError,
	type AiResult,
	type AphrodyCompute,
	collapseWhitespace,
} from "./aphrody";
import { type AiConfig, SHENRON_E5 } from "./config";

export type EmbedKind = "query" | "passage";

/** Error raised when an embedding response breaks the E5 contract. */
export class InvalidEmbeddingResponseError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "InvalidEmbeddingResponseError";
	}
}

function assertVectors(embeddings: readonly unknown[], expected: number): void {
	if (embeddings.length !== expected) {
		throw new InvalidEmbeddingResponseError(
			`expected ${expected} embeddings, received ${embeddings.length}`
		);
	}
	for (const vector of embeddings) {
		if (!Array.isArray(vector) || vector.length !== SHENRON_E5.dimensions) {
			throw new InvalidEmbeddingResponseError(
				`embedding is not ${SHENRON_E5.dimensions}-dimensional`
			);
		}
		if (!vector.every((value) => typeof value === "number" && Number.isFinite(value))) {
			throw new InvalidEmbeddingResponseError("embedding holds a non-finite value");
		}
	}
}

/** Model on `/api/v1/shenron/embed`. No client prefix: the server adds it. */
export function aphrodyEmbeddingModel(compute: AphrodyCompute, kind: EmbedKind): EmbeddingModelV4 {
	return {
		specificationVersion: "v4",
		provider: "aphrody.shenron",
		modelId: SHENRON_E5.modelId,
		maxEmbeddingsPerCall: SHENRON_E5.maxInputs,
		supportsParallelCalls: false,
		async doEmbed({ values, abortSignal }): Promise<EmbeddingModelV4Result> {
			const result = await compute.embed({
				texts: values,
				kind,
				...(abortSignal ? { signal: abortSignal } : {}),
			});
			if (!result.ok) throw new AiFailureError(result);
			assertVectors(result.value.vectors, values.length);
			return { embeddings: result.value.vectors, warnings: [] };
		},
	};
}

/**
 * E5 middleware: `${kind}: ` prefix exactly once (an existing prefix is not
 * doubled), whitespace collapsed, empty input rejected, 16 inputs per call,
 * sequential calls, and response checks (count, index order and uniqueness
 * read from `response.body`, 384 dimensions, finite values).
 */
export function e5Middleware(kind: EmbedKind): EmbeddingModelV4Middleware {
	const prefix = `${kind}: `;
	return {
		specificationVersion: "v4",
		overrideMaxEmbeddingsPerCall: () => SHENRON_E5.maxInputs,
		overrideSupportsParallelCalls: () => false,
		async transformParams({ params }) {
			const values = params.values.map((value) => {
				let text = collapseWhitespace(value);
				if (text.startsWith(prefix)) text = text.slice(prefix.length).trim();
				if (!text) throw new InvalidEmbeddingResponseError("embedding input is empty");
				return `${prefix}${text}`;
			});
			return { ...params, values };
		},
		async wrapEmbed({ doEmbed, params }) {
			const result = await doEmbed();
			assertVectors(result.embeddings, params.values.length);
			const body = result.response?.body as { data?: unknown } | undefined;
			if (!body || !Array.isArray(body.data) || body.data.length !== params.values.length) {
				throw new InvalidEmbeddingResponseError("embedding response carries no index list");
			}
			body.data.forEach((item: unknown, position: number) => {
				const index = (item as { index?: unknown } | null)?.index;
				if (index !== position) {
					throw new InvalidEmbeddingResponseError(
						"embedding indexes are shuffled, duplicated or missing"
					);
				}
			});
			return result;
		},
	};
}

/** Model on the E5 sidecar (`/v1/embeddings`), prefixing once on the client. */
export function e5DirectEmbeddingModel(
	e5: { baseUrl: URL },
	kind: EmbedKind,
	o: { fetch?: typeof fetch } = {}
): EmbeddingModelV4 {
	const provider = createOpenAICompatible({
		name: "shenron-e5",
		baseURL: e5.baseUrl.href.replace(/\/+$/, ""),
		...(o.fetch ? { fetch: o.fetch } : {}),
	});
	return wrapEmbeddingModel({
		model: provider.embeddingModel(SHENRON_E5.modelId),
		middleware: e5Middleware(kind),
	});
}

/** Model chosen by configuration (D10); `null` when embeddings are disabled. */
export function selectEmbeddingModel(
	cfg: Pick<AiConfig, "embed">,
	kind: EmbedKind,
	deps: { compute: AphrodyCompute | null; fetch?: typeof fetch }
): EmbeddingModelV4 | null {
	if (!cfg.embed) return null;
	if (cfg.embed.transport === "aphrody") {
		return deps.compute ? aphrodyEmbeddingModel(deps.compute, kind) : null;
	}
	return e5DirectEmbeddingModel(
		{ baseUrl: cfg.embed.baseUrl },
		kind,
		deps.fetch ? { fetch: deps.fetch } : {}
	);
}

function findCause<T>(error: unknown, test: (e: unknown) => e is T): T | undefined {
	let current: unknown = error;
	for (let depth = 0; depth < 8 && current; depth++) {
		if (test(current)) return current;
		const next: unknown =
			(current as { cause?: unknown; lastError?: unknown }).lastError ??
			(current as { cause?: unknown }).cause;
		current = next;
	}
	return undefined;
}

function isAiFailureError(e: unknown): e is AiFailureError {
	return e instanceof AiFailureError;
}

function isNamed(name: string) {
	return (e: unknown): e is Error => e instanceof Error && e.name === name;
}

/** Maps an embedding error to an {@link AiFailure} (no URL, no body, no secret). */
export function embeddingFailure(error: unknown, path: string, timedOut: boolean): AiFailure {
	const wrapped = findCause(error, isAiFailureError);
	if (wrapped) return wrapped.failure;
	if (timedOut || findCause(error, isNamed("TimeoutError"))) {
		return { ok: false, kind: "timeout", path, detail: `timeout ${path}` };
	}
	const api = findCause(error, (e): e is APICallError => APICallError.isInstance(e));
	if (api) {
		if (api.statusCode !== undefined) {
			return {
				ok: false,
				kind: "http",
				path,
				status: api.statusCode,
				detail: `HTTP ${api.statusCode} ${path}`,
			};
		}
		return { ok: false, kind: "unreachable", path, detail: `unreachable ${path}` };
	}
	if (
		findCause(
			error,
			(e): e is InvalidEmbeddingResponseError => e instanceof InvalidEmbeddingResponseError
		)
	) {
		return { ok: false, kind: "invalid_response", path, detail: `invalid response ${path}` };
	}
	if (
		findCause(error, isNamed("AI_TypeValidationError")) ||
		findCause(error, isNamed("AI_JSONParseError"))
	) {
		return { ok: false, kind: "invalid_response", path, detail: `invalid response ${path}` };
	}
	return { ok: false, kind: "unreachable", path, detail: `unreachable ${path}` };
}

function modelPath(model: EmbeddingModelV4): string {
	return model.provider.startsWith("aphrody") ? "/api/v1/shenron/embed" : "/v1/embeddings";
}

/** Hot path: one query embedding, `maxRetries: 0`. */
export async function embedQuery(
	model: EmbeddingModelV4,
	text: string,
	o: { timeoutMs: number; signal?: AbortSignal }
): Promise<AiResult<number[]>> {
	const timeout = AbortSignal.timeout(o.timeoutMs);
	const abortSignal = o.signal ? AbortSignal.any([timeout, o.signal]) : timeout;
	try {
		const { embedding } = await embed({ model, value: text, maxRetries: 0, abortSignal });
		return { ok: true, value: embedding };
	} catch (error) {
		return embeddingFailure(error, modelPath(model), timeout.aborted);
	}
}

/** Batch path: passages in calls of 16, strictly sequential, `maxRetries: 0`. */
export async function embedPassages(
	model: EmbeddingModelV4,
	texts: readonly string[],
	o: { timeoutMs: number }
): Promise<AiResult<number[][]>> {
	const timeout = AbortSignal.timeout(o.timeoutMs);
	try {
		const { embeddings } = await embedMany({
			model,
			values: [...texts],
			maxRetries: 0,
			maxParallelCalls: 1,
			abortSignal: timeout,
		});
		return { ok: true, value: embeddings };
	} catch (error) {
		return embeddingFailure(error, modelPath(model), timeout.aborted);
	}
}
