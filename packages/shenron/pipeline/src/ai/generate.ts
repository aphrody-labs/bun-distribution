// SPDX-License-Identifier: Apache-2.0
/**
 * `@shenron/pipeline/ai/generate` — grounded answer generation behind ports
 * (logic of `generateLlmAnswer` in `apps/shenron/bot/src/lib/llm.ts`).
 *
 * Runtime class: `pure`. `generateText` with `instructions` and
 * `maxRetries: 0`; persona fallbacks and session turns are never cached; a
 * missing chunk content or a failing port never throws.
 */
import type { LanguageModelV4 } from "@ai-sdk/provider";
import { generateText, type ModelMessage } from "ai";
import type {
	ChunkContentPort,
	ConcurrencyPort,
	HistoryPort,
	HistoryTurn,
	SemanticCachePort,
} from "./ports";
import { semanticCacheScope } from "./ports";
import {
	buildGroundingInstructions,
	isChitchat,
	PERSONAS,
	type PersonaId,
	PROMPT_VERSION,
} from "./prompts";

export interface GroundedHit {
	id: string;
	title: string;
	url: string;
	/** Inline full text (Aphrody hits carry it); preferred over the chunk port. */
	content?: string;
	/** Last-resort text when neither `content` nor the port has the chunk. */
	snippet?: string;
}

export interface ContextLimits {
	/** Hits considered (llm.ts: 6). */
	hits: number;
	/** Characters per hit (llm.ts: LLM_CONTEXT_CHARS_PER_HIT, 700). */
	perHit: number;
	/** Stop once the context exceeds this many characters (llm.ts: 3200). */
	total: number;
}

export const DEFAULT_CONTEXT_LIMITS: Readonly<ContextLimits> = Object.freeze({
	hits: 6,
	perHit: 700,
	total: 3200,
});

/** Messages of session memory kept in the prompt (llm.ts: LLM_HISTORY_TURNS, 6). */
export const DEFAULT_HISTORY_TURNS = 6;

export interface GroundedAnswerInput {
	model: LanguageModelV4;
	persona: PersonaId;
	question: string;
	hits: readonly GroundedHit[];
	chunks: ChunkContentPort;
	history?: HistoryPort;
	cache?: SemanticCachePort;
	concurrency?: ConcurrencyPort;
	sessionId?: string;
	abortSignal?: AbortSignal;
	contextLimits?: Partial<ContextLimits>;
	historyTurns?: number;
	/** Diagnostics sink for swallowed port errors (never receives secrets). */
	onError?: (stage: "chunks" | "history" | "cache" | "generate", error: unknown) => void;
}

export interface GroundedAnswer {
	answer: string;
	fallback: boolean;
	cached: boolean;
	promptVersion: string;
}

/** Compact fact context (llm.ts `buildContext`), without dumping it to the user. */
export async function buildGroundedContext(
	hits: readonly GroundedHit[],
	chunks: ChunkContentPort,
	limits: ContextLimits,
	onError?: GroundedAnswerInput["onError"]
): Promise<string> {
	const selected = hits.slice(0, limits.hits);
	let contents: ReadonlyMap<string, string> = new Map();
	const missing = selected.filter((hit) => !hit.content).map((hit) => hit.id);
	if (missing.length > 0) {
		try {
			contents = await chunks.contentFor(missing);
		} catch (error) {
			onError?.("chunks", error);
		}
	}
	let ctx = "";
	for (const hit of selected) {
		const text = (hit.content || contents.get(hit.id) || hit.snippet || "")
			.replace(/\s+/g, " ")
			.trim();
		if (text) ctx += `- ${hit.title}: ${text.slice(0, limits.perHit)}\n`;
		if (ctx.length > limits.total) break;
	}
	return ctx.trim();
}

export async function generateGroundedAnswer(i: GroundedAnswerInput): Promise<GroundedAnswer> {
	const persona = i.persona;
	const fallbackText = PERSONAS[persona].fallback;
	const limits: ContextLimits = { ...DEFAULT_CONTEXT_LIMITS, ...i.contextLimits };
	const chit = isChitchat(i.question);
	const context = chit ? "" : await buildGroundedContext(i.hits, i.chunks, limits, i.onError);

	const appendHistory = async (answer: string): Promise<void> => {
		if (!i.sessionId || !i.history) return;
		try {
			await i.history.append(i.sessionId, { q: i.question, a: answer });
		} catch (error) {
			i.onError?.("history", error);
		}
	};

	// A cached answer is valid only for the exact evidence, model, prompt version
	// and persona. Session history changes the prompt on every turn: never cached.
	const scope =
		context && !i.sessionId && i.cache
			? `${persona}:${await semanticCacheScope(i.model.modelId, context)}`
			: null;

	if (scope && i.cache) {
		try {
			const hit = await i.cache.lookup(scope, i.question);
			if (hit) return { answer: hit, fallback: false, cached: true, promptVersion: PROMPT_VERSION };
		} catch (error) {
			i.onError?.("cache", error);
		}
	}

	let history: readonly HistoryTurn[] = [];
	if (i.sessionId && i.history) {
		try {
			history = await i.history.load(i.sessionId, i.historyTurns ?? DEFAULT_HISTORY_TURNS);
		} catch (error) {
			i.onError?.("history", error);
		}
	}

	const userContent = context
		? `Contexte (faits Dragon Ball, à reformuler) :\n${context}\n\nMessage de l'utilisateur : ${i.question}`
		: i.question;
	const messages: ModelMessage[] = [
		...history
			.filter((turn) => turn.content)
			.map((turn) => ({ role: turn.role, content: turn.content })),
		{ role: "user", content: userContent },
	];
	const instructions = buildGroundingInstructions(persona, undefined, { chitchat: chit });

	const run = async (): Promise<string> => {
		try {
			const result = await generateText({
				model: i.model,
				instructions,
				messages,
				maxRetries: 0,
				...(i.abortSignal ? { abortSignal: i.abortSignal } : {}),
			});
			return result.text.trim();
		} catch (error) {
			i.onError?.("generate", error);
			return "";
		}
	};

	let answer = "";
	if (i.concurrency) {
		const outcome = await i.concurrency.run(run);
		answer = outcome === "busy" ? "" : outcome;
	} else {
		answer = await run();
	}

	const fallback = !answer;
	if (fallback) answer = fallbackText;

	if (scope && i.cache && !fallback) {
		try {
			await i.cache.store(scope, i.question, answer);
		} catch (error) {
			i.onError?.("cache", error);
		}
	}

	await appendHistory(answer);
	return { answer, fallback, cached: false, promptVersion: PROMPT_VERSION };
}
