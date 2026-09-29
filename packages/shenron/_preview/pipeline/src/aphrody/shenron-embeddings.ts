// SPDX-License-Identifier: Apache-2.0
/**
 * `@shenron/pipeline/aphrody/embeddings` — legacy facade over the E5-direct embedding
 * model of `@shenron/pipeline/ai/embeddings` (docs/STACK.md §6.3, D10, D16).
 *
 * `ShenronEmbeddingsClient` keeps its constructor (`baseUrl`, `fetcher`), the
 * `embed(texts, kind, { timeoutMs })` signature and error messages. Without an
 * explicit `baseUrl`, the address comes from the single resolver
 * `@shenron/pipeline/ai/config` (`APHRODY_AI_EMBED_BASE_URL`, then the legacy aliases of
 * the aphrody-infra contract, `EMBED_URL` being an origin to which `/v1` is
 * appended); there is no address default. Requests go through `e5DirectEmbeddingModel` (prefix once,
 * whitespace collapsed, 16 inputs per request, 384 dimensions checked);
 * `fetch` is resolved at call time unless a `fetcher` is given.
 */
import { requireEmbedBaseUrl, SHENRON_E5 } from "@shenron/pipeline/ai/config";
import {
	e5DirectEmbeddingModel,
	type EmbedKind,
	embedPassages,
} from "@shenron/pipeline/ai/embeddings";

/** Client for the local OpenAI-compatible Shenron E5 service. */
export const SHENRON_EMBED_MODEL = SHENRON_E5.modelId;
export const SHENRON_EMBED_DIMENSIONS = SHENRON_E5.dimensions;
const MAX_INPUTS = SHENRON_E5.maxInputs;
const DEFAULT_TIMEOUT_MS = 10_000;
const LOOPBACK_HOSTS = ["127.0.0.1", "[::1]", "localhost"];

export type ShenronEmbedKind = EmbedKind;

export interface ShenronEmbeddingsOptions {
	baseUrl?: string;
	fetcher?: typeof fetch;
}

/**
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
		!LOOPBACK_HOSTS.includes(url.hostname) ||
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
 * Calls Aphrody's loopback `/v1/embeddings` service and applies the E5 prefix
 * before sending each text. Requests are split to the server's 16-input limit.
 */
export class ShenronEmbeddingsClient {
	/** E5 base URL, ending in `/v1` (the model posts to `${baseUrl}/embeddings`). */
	readonly baseUrl: URL;
	private readonly fetcher?: typeof fetch;

	constructor(options: ShenronEmbeddingsOptions = {}) {
		this.baseUrl = resolveShenronEmbeddingsBaseUrl(options);
		this.fetcher = options.fetcher;
	}

	async embed(
		texts: string[],
		kind: ShenronEmbedKind,
		options: { timeoutMs?: number } = {}
	): Promise<number[][]> {
		if (texts.some((text) => !text.trim())) throw new Error("Shenron embedding input is empty");
		// Built per call so that, without `fetcher`, the global fetch is read at call time.
		const model = e5DirectEmbeddingModel(
			{ baseUrl: this.baseUrl },
			kind,
			this.fetcher ? { fetch: this.fetcher } : {}
		);
		const output: number[][] = [];
		for (let start = 0; start < texts.length; start += MAX_INPUTS) {
			const batch = texts.slice(start, start + MAX_INPUTS);
			const result = await embedPassages(model, batch, {
				timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
			});
			if (!result.ok) {
				if (result.kind === "http") throw new Error(`Shenron embeddings HTTP ${result.status}`);
				if (result.kind === "invalid_response") {
					throw new Error("Shenron returned invalid embedding vectors");
				}
				const error = new Error(`Shenron embeddings ${result.detail}`);
				if (result.kind === "timeout") error.name = "TimeoutError";
				throw error;
			}
			output.push(...result.value);
		}
		return output;
	}
}
