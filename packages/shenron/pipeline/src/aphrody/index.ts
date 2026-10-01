// SPDX-License-Identifier: Apache-2.0
/**
 * @shenron/pipeline/aphrody — HTTP clients for the Aphrody Rust services (B16, docs/STACK.md).
 *
 * The root only exposes the network clients: compute (LLM, RAG, translation),
 * Shenron E5 embeddings and the web crawler. No `bun:ffi`, no `bun:sqlite`, no
 * `sharp`. The A2A hub lives at `@shenron/pipeline/aphrody/a2a` and the `aphrody` CLI
 * wrappers (Bun only) at `@shenron/pipeline/aphrody/cli`.
 */

export {
	AphrodyComputeClient,
	type AphrodyChatMessage,
	type AphrodyComputeOptions,
	type AphrodyRagDocument,
	type AphrodyRagHit,
	type AphrodyRagMode,
	type AphrodyRagStats,
	type AphrodyRagStoredDocument,
} from "./compute";
export {
	SHENRON_EMBED_DIMENSIONS,
	SHENRON_EMBED_MODEL,
	ShenronEmbeddingsClient,
	type ShenronEmbedKind,
	type ShenronEmbeddingsOptions,
} from "./shenron-embeddings";
export {
	aphrodyWebRecon,
	aphrodyWebScrape,
	type AphrodyWebScrapeOptions,
	AphrodyWebClient,
	type AphrodyCrawlJob,
	type AphrodyCrawlOptions,
	type AphrodyCrawlRequest,
} from "./web";
export {
	aphrodyInfraCheck,
	aphrodyInfraStatus,
	type AphrodyInfraCheck,
	type AphrodyInfraTargetCheck,
} from "./infra";
