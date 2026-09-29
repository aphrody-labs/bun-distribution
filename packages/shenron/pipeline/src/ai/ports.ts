// SPDX-License-Identifier: Apache-2.0
/**
 * `@shenron/pipeline/ai/ports` — storage ports of the grounded generation (D9: no
 * Redis, SQLite, `bun:*` or `node:*` in this package; storage enters here).
 *
 * Runtime class: `pure` (WebCrypto only).
 */
import { PROMPT_VERSION } from "./prompts";

/** Full chunk text by hit id (bot: `rag_chunks` SQLite; Aphrody: `hit.content`). */
export interface ChunkContentPort {
	contentFor(hitIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
}

export interface HistoryTurn {
	role: "user" | "assistant";
	content: string;
}

/** Conversation memory per session (bot: Redis list). */
export interface HistoryPort {
	load(sessionId: string, turns: number): Promise<readonly HistoryTurn[]>;
	append(sessionId: string, turn: { q: string; a: string }): Promise<void>;
}

/** Semantic answer cache; `scope` already binds model, prompt version, persona and evidence. */
export interface SemanticCachePort {
	lookup(scope: string, question: string): Promise<string | null>;
	store(scope: string, question: string, answer: string): Promise<void>;
}

/** Concurrency gate; resolves `"busy"` when no slot is available. */
export interface ConcurrencyPort {
	run<T>(fn: () => Promise<T>): Promise<T | "busy">;
}

const encoder = new TextEncoder();

/**
 * Semantic cache scope: first 24 hex characters of
 * `sha256(model \0 PROMPT_VERSION \0 context)` (WebCrypto). A prompt change
 * (new `PROMPT_VERSION`) therefore never reuses a cached answer (B7).
 */
export async function semanticCacheScope(
	modelId: string,
	context: string,
	promptVersion: string = PROMPT_VERSION
): Promise<string> {
	const data = encoder.encode(`${modelId}\u0000${promptVersion}\u0000${context}`);
	const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
	let hex = "";
	for (const byte of digest) hex += byte.toString(16).padStart(2, "0");
	return hex.slice(0, 24);
}
