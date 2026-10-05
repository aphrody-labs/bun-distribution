// SPDX-License-Identifier: Apache-2.0
/**
 * `@shenron/pipeline/aphrody/embeddings` — legacy facade over Aphrody
 * `POST /api/v1/shenron/embed` (docs/STACK.md §6.3, D10, D16).
 *
 * `ShenronEmbeddingsClient` keeps its constructor (`baseUrl`, `fetcher`, plus
 * optional `token` and `env`), the `embed(texts, kind, { timeoutMs })`
 * signature and error messages. The former E5-direct sidecar transport is
 * gone: `baseUrl` now means the Aphrody `aphrody-ai-http` URL and defaults to
 * `APHRODY_AI_HTTP_URL`; the token defaults to `APHRODY_AI_HTTP_TOKEN`. The
 * server adds the E5 prefix; the client collapses whitespace, sends 16 inputs
 * per request and checks 384 dimensions. `fetch` is resolved at call time
 * unless a `fetcher` is given.
 */
import { createAphrodyCompute } from "@shenron/pipeline/ai/aphrody";
import {
	requireAiHttpToken,
	requireAiHttpUrl,
	requireEmbedBaseUrl,
	SHENRON_E5,
} from "@shenron/pipeline/ai/config";
import type { EmbedKind } from "@shenron/pipeline/ai/embeddings";

/** Client for the local OpenAI-compatible Shenron E5 service. */
export const SHENRON_EMBED_MODEL = SHENRON_E5.modelId;
export const SHENRON_EMBED_DIMENSIONS = SHENRON_E5.dimensions;
const DEFAULT_TIMEOUT_MS = 10_000;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "[::1]", "localhost"]);

export type ShenronEmbedKind = EmbedKind;

export interface ShenronEmbeddingsOptions {
	/** Aphrody `aphrody-ai-http` URL; defaults to `APHRODY_AI_HTTP_URL` (or its aliases). */
	baseUrl?: string;
	/** Bearer token; defaults to `APHRODY_AI_HTTP_TOKEN` (or its aliases). */
	token?: string;
	fetcher?: typeof fetch;
	/** Environment read for the defaults (`process.env` when omitted). */
	env?: Record<string, string | undefined>;
}

/**
 * @deprecated Direct embedder resolver, kept for exports and health probes
 * only: embeddings no longer use this address (see {@link ShenronEmbeddingsClient}).
 * E5 base URL (ending in `/v1`): the explicit option, else the resolver of
 * `@shenron/pipeline/ai/config`. Throws on a missing, malformed or non-loopback address.
 */
export function resolveShenronEmbeddingsBaseUrl(
	options: { baseUrl?: string } = {},
	env: Record<string, string | undefined> = process.env
): URL {
	if (options.baseUrl === undefined) return requireEmbedBaseUrl(env);
	const url = new URL(options.baseUrl);
	if (
		url.protocol !== "http:" ||
		!LOOPBACK_HOSTS.has(url.hostname) ||
		url.username ||
		url.password
	) {
		throw new Error("Shenron embeddings URL must use loopback HTTP");
	}
	const path = url.pathname.replace(/\/+$/, "");
	url.pathname = path.endsWith("/v1") ? path : `${path}/v1`;
	url.search = "";
	url.hash = "";
	return url;
}

/**
 * Calls Aphrody `POST /api/v1/shenron/embed` (`{ texts, kind }`, Bearer
 * token). The server applies the E5 `query: ` / `passage: ` prefix; the client
 * collapses whitespace and splits requests to 16 inputs.
 *
 * Options: `baseUrl` is the Aphrody `aphrody-ai-http` URL (loopback HTTP, only
 * its origin is used) and overrides `APHRODY_AI_HTTP_URL`; `token` overrides
 * `APHRODY_AI_HTTP_TOKEN`. Both fall back to `@shenron/pipeline/ai/config`
 * and the constructor throws an `AiConfigError` naming the variables when
 * neither is available. A direct embedder URL (`/v1` path) passed as
 * `baseUrl` keeps working only in the sense that its origin is used as the
 * Aphrody address; callers should pass the Aphrody URL or nothing.
 */
export class ShenronEmbeddingsClient {
	/** Origin of `aphrody-ai-http` (requests go to `${baseUrl}api/v1/shenron/embed`). */
	readonly baseUrl: URL;
	private readonly token: string;
	private readonly fetcher?: typeof fetch;

	constructor(options: ShenronEmbeddingsOptions = {}) {
		const env = options.env ?? process.env;
		this.baseUrl =
			options.baseUrl === undefined
				? requireAiHttpUrl(env)
				: requireAiHttpUrl({ APHRODY_AI_HTTP_URL: options.baseUrl });
		this.token = options.token ?? requireAiHttpToken(env);
		this.fetcher = options.fetcher;
	}

	async embed(
		texts: string[],
		kind: ShenronEmbedKind,
		options: { timeoutMs?: number } = {}
	): Promise<number[][]> {
		if (texts.some((text) => !text.trim())) throw new Error("Shenron embedding input is empty");
		if (texts.length === 0) return [];
		// Built per call so that, without `fetcher`, the global fetch is read at call time.
		const compute = createAphrodyCompute(
			{ baseUrl: this.baseUrl, token: this.token },
			{
				timeouts: { embed: options.timeoutMs ?? DEFAULT_TIMEOUT_MS },
				...(this.fetcher ? { fetch: this.fetcher } : {}),
			}
		);
		const result = await compute.embed({ texts, kind });
		if (result.ok) return result.value.vectors;
		if (result.kind === "http") throw new Error(`Shenron embeddings HTTP ${result.status}`);
		if (result.kind === "invalid_response" || result.kind === "invalid_json") {
			throw new Error("Shenron returned invalid embedding vectors");
		}
		const error = new Error(`Shenron embeddings ${result.detail}`);
		if (result.kind === "timeout") error.name = "TimeoutError";
		throw error;
	}
}
