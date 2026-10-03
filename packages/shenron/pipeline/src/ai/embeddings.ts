// SPDX-License-Identifier: Apache-2.0
/**
 * `@shenron/pipeline/ai/embeddings` — E5 embedding models and hot-path helpers (D10).
 *
 * Runtime class: `pure`.
 *
 * Single transport: Aphrody `POST /api/v1/shenron/embed` (Bearer token of
 * `aphrody-ai-http`). The server adds the E5 prefix, so the client adds NONE.
 * Whitespace is collapsed, at most 16 inputs go per call, sequentially, and
 * count, 384 dimensions and finite values are checked. The former E5-direct
 * sidecar transport (`aphrody-shenron-embed` `/v1/embeddings`) is removed: a
 * configured direct embedder URL is ignored with a one-time warning.
 */
import {
	APICallError,
	type EmbeddingModelV4,
	type EmbeddingModelV4Middleware,
	type EmbeddingModelV4Result,
} from "@ai-sdk/provider";
import type { EnvSource } from "@shenron/config/env";
import { embed, embedMany } from "ai";
import {
	type AiFailure,
	AiFailureError,
	type AiResult,
	type AphrodyCompute,
	collapseWhitespace,
	createAphrodyCompute,
} from "./aphrody";
import {
	type AiConfig,
	requireAiHttpToken,
	requireAiHttpUrl,
	SHENRON_E5,
	warnIgnoredEmbedBaseUrl,
} from "./config";

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

/**
 * Embedding model on Aphrody `/api/v1/shenron/embed`, resolved from `env`
 * (`APHRODY_AI_HTTP_URL` / `APHRODY_AI_HTTP_TOKEN` or their aliases). The name
 * is kept for existing callers; the former direct sidecar transport is gone,
 * so `e5.baseUrl` and any direct embedder variable are ignored (one warning).
 * Throws an `AiConfigError` naming the variables when Aphrody is not configured.
 */
export function e5DirectEmbeddingModel(
	e5: { baseUrl?: URL | string } | null | undefined,
	kind: EmbedKind,
	o: { fetch?: typeof fetch; env?: EnvSource } = {}
): EmbeddingModelV4 {
	// Portable lookup: hosts without a process object fall back to an empty env.
	const env = o.env ?? (globalThis as { process?: { env?: EnvSource } }).process?.env ?? {};
	warnIgnoredEmbedBaseUrl(e5?.baseUrl !== undefined ? { ...env, APHRODY_AI_EMBED_BASE_URL: String(e5.baseUrl) } : env);
	const compute = createAphrodyCompute(
		{ baseUrl: requireAiHttpUrl(env), token: requireAiHttpToken(env) },
		o.fetch ? { fetch: o.fetch } : {}
	);
	return aphrodyEmbeddingModel(compute, kind);
}

/** Model chosen by configuration (D10); `null` when embeddings are disabled. */
export function selectEmbeddingModel(
	cfg: Pick<AiConfig, "embed">,
	kind: EmbedKind,
	deps: { compute: AphrodyCompute | null; fetch?: typeof fetch }
): EmbeddingModelV4 | null {
	if (!cfg.embed || !deps.compute) return null;
	return aphrodyEmbeddingModel(deps.compute, kind);
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

function modelPath(_model: EmbeddingModelV4): string {
	return "/api/v1/shenron/embed";
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
