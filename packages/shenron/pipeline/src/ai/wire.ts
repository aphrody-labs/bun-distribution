// SPDX-License-Identifier: Apache-2.0
/**
 * `@shenron/pipeline/ai/wire` — zod mirrors of the private Shenron workload boundary
 * served by `aphrody-ai-http` (`crates/ai/mcp/src/http_rest.rs`).
 *
 * Runtime class: `pure`. Request schemas mirror the Rust `Deserialize`
 * structs (field names after serde renaming); response schemas mirror the
 * `json!` bodies of each handler. `scripts/check-contracts.ts` compares
 * {@link SHENRON_ROUTES} and {@link WIRE_STRUCTS} with the Rust source.
 */
import { z } from "zod";

/** Server-side limits enforced by `http_rest.rs`. */
export const APHRODY_LIMITS = Object.freeze({
	/** `shenron_llm_chat_core`: `messages.len() > 32` is rejected. */
	chatMessages: 32,
	/** `shenron_llm_chat_core`: `content.len() > 32 * 1024` bytes is rejected. */
	chatMessageBytes: 32 * 1024,
	/** `shenron_embed`: `texts.len() > 16` is rejected. */
	embedTexts: 16,
	/** `shenron_embed`: `text.len() > 8192` bytes is rejected. */
	embedTextBytes: 8192,
	/** `DefaultBodyLimit::max(24 * 1024 * 1024)` on OCR and vision, and `image_base64.len()` bound. */
	imageBase64Bytes: 24 * 1024 * 1024,
	/** `shenron_vision_structured_core`: `prompt.len() > 64 * 1024` is rejected. */
	visionPromptBytes: 64 * 1024,
	/** `shenron_rag_search_core`: `q` must hold 1..=512 bytes. */
	searchQueryBytes: 512,
	/** `shenron_rag_search_core`: filters above 256 bytes are rejected. */
	searchFilterBytes: 256,
	/** `shenron_rag_ingest_core`: `MAX_INGEST_BYTES`. */
	ingestContentBytes: 512 * 1024,
	/** `sourceId.len() > 255` is rejected. */
	sourceIdBytes: 255,
	/** `model.len() > 128` is rejected. */
	modelIdBytes: 128,
});

/** Every `/api/v1/shenron/*` route of `http_rest.rs::router`, by client name. */
export const SHENRON_ROUTES = Object.freeze({
	health: { method: "GET", path: "/api/v1/shenron/health" },
	ragSearch: { method: "GET", path: "/api/v1/shenron/rag/search" },
	ragDocument: { method: "GET", path: "/api/v1/shenron/rag/document" },
	ragStats: { method: "GET", path: "/api/v1/shenron/rag/stats" },
	ragIngest: { method: "POST", path: "/api/v1/shenron/rag/ingest" },
	ragSyncFinish: { method: "POST", path: "/api/v1/shenron/rag/sync/finish" },
	chat: { method: "POST", path: "/api/v1/shenron/llm/chat" },
	embed: { method: "POST", path: "/api/v1/shenron/embed" },
	visionStructured: { method: "POST", path: "/api/v1/shenron/vision/structured" },
	ocr: { method: "POST", path: "/api/v1/shenron/ocr" },
} as const);

export type ShenronRouteName = keyof typeof SHENRON_ROUTES;

/**
 * Wire field names of the Rust request structs (after serde renaming), used
 * by `scripts/check-contracts.ts` to detect drift.
 */
export const WIRE_STRUCTS = Object.freeze({
	ShenronSearchQuery: ["q", "limit", "lang", "kind", "sourceId", "entity"],
	ShenronDocument: [
		"sourceId",
		"title",
		"url",
		"content",
		"kind",
		"lang",
		"originSourceId",
		"entity",
		"syncGeneration",
	],
	ShenronSyncFinish: ["originSourceId", "syncGeneration", "expectedCount"],
	ChatMessage: ["role", "content"],
	ChatRequest: ["messages", "model"],
	OcrRequest: ["image_base64", "language", "engine", "model", "include_geometry"],
	VisionRequest: ["image_base64", "image_mime", "prompt", "model", "reasoning_effort"],
	ShenronDocumentQuery: ["sourceId"],
	ShenronEmbedRequest: ["texts", "kind"],
} as const);

const nullableString = z.string().nullish();

// ── errors ──
export const ErrorBody = z.object({ error: z.string() });

// ── health ──
export const HealthResponse = z.object({
	status: z.literal("ok"),
	capabilities: z.object({ rag: z.boolean(), llm: z.boolean(), ocr: z.boolean() }),
});

// ── llm/chat ──
export const ChatRole = z.enum(["system", "user", "assistant"]);
export const ChatMessage = z.object({ role: ChatRole, content: z.string() });
export const ChatRequest = z.object({
	messages: z.array(ChatMessage),
	model: z.string().optional(),
});
export const ChatResponse = z.object({ answer: z.string(), model: z.string().optional() });

// ── embed ──
export const EmbedKind = z.enum(["query", "passage"]);
export const EmbedRequest = z.object({ texts: z.array(z.string()), kind: EmbedKind.optional() });
export const EmbedResponse = z.object({
	vectors: z.array(z.array(z.number())),
	model: z.string().optional(),
});

// ── rag/search ──
export const RagMode = z.enum(["lexical", "hybrid", "hybrid+rerank"]);
export const RagSearchQuery = z.object({
	q: z.string(),
	limit: z.number().int().positive().optional(),
	lang: z.string().optional(),
	kind: z.string().optional(),
	sourceId: z.string().optional(),
	entity: z.string().optional(),
});
export const RagHitWire = z.object({
	sourceId: z.string().optional(),
	title: z.string(),
	url: z.string(),
	snippet: z.string(),
	content: z.string().optional(),
	contentTruncated: z.boolean().optional(),
	score: z.number(),
	kind: z.string(),
	lang: nullableString,
	originSourceId: nullableString,
	entity: nullableString,
});
export const RagSearchResponse = z.object({
	results: z.array(RagHitWire),
	mode: RagMode.optional(),
});

// ── rag/document ──
export const RagDocumentResponse = z.object({
	document: z.object({
		sourceId: z.string(),
		title: z.string(),
		url: z.string(),
		snippet: z.string(),
		kind: z.string(),
		entity: nullableString,
		originSourceId: nullableString,
	}),
});

// ── rag/stats ──
const count = z.number().int().nonnegative();
export const RagStatsResponse = z.object({
	chunks: count,
	vectors: count,
	vectorsStored: count.optional(),
	sources: z
		.array(
			z.object({
				sourceId: z.string(),
				kind: z.string(),
				count,
				vectors: count.optional(),
			})
		)
		.optional(),
});

// ── rag/ingest ──
export const IngestRequest = z.object({
	sourceId: z.string(),
	title: z.string(),
	url: z.string(),
	content: z.string(),
	kind: z.string().optional(),
	lang: z.string().optional(),
	originSourceId: z.string().optional(),
	entity: z.string().optional(),
	syncGeneration: z.string().optional(),
});
export const IngestResponse = z.object({
	id: z.union([z.string(), z.number()]).optional(),
	sourceId: z.string(),
	indexed: z.literal(true),
	vectorIndexed: z.boolean().optional(),
	retrieval: z.enum(["hybrid", "lexical"]).optional(),
});

// ── rag/sync/finish ──
export const SyncFinishRequest = z.object({
	originSourceId: z.string(),
	syncGeneration: z.string(),
	expectedCount: z.number().int(),
});
export const SyncFinishResponse = z.object({
	status: z.literal("complete").optional(),
	active: count.optional(),
	retired: count,
});

// ── ocr ──
export const OcrEngine = z.enum(["ppocr", "gemini-web", "vlm"]);
export const OcrRequest = z.object({
	image_base64: z.string(),
	language: z.string().optional(),
	engine: z.string().optional(),
	model: z.string().optional(),
	include_geometry: z.boolean().optional(),
});
export const OcrResponse = z.object({
	text: z.string(),
	language: z.string(),
	languageApplied: z.boolean().optional(),
	textless: z.boolean().nullish(),
	suspect: z.boolean().nullish(),
	findings: z.array(z.unknown()).nullish(),
	model: nullableString,
	elapsed_ms: z.number().nullish(),
	blocks: z.array(z.unknown()).nullish(),
	quality: z.object({ mean_confidence: z.number() }).nullish(),
});

// ── vision/structured ──
export const VisionMime = z.enum(["image/jpeg", "image/png", "image/webp"]);
export const VisionRequest = z.object({
	image_base64: z.string(),
	image_mime: VisionMime,
	prompt: z.string(),
	model: z.string().optional(),
	reasoning_effort: z.enum(["low", "medium", "high"]).optional(),
});
export const VisionResponse = z.object({
	result: z.record(z.string(), z.unknown()),
	model: z.string(),
});

// ── client-side value types (normalised: `null` becomes absent) ──

export interface AphrodyRagHit {
	title: string;
	url: string;
	snippet: string;
	score: number;
	kind: string;
	sourceId?: string;
	originSourceId?: string;
	entity?: string;
	lang?: string;
	content?: string;
}

export type AphrodyRagMode = z.infer<typeof RagMode>;

export interface AphrodyRagDocument {
	sourceId: string;
	title: string;
	url: string;
	kind: string;
	snippet: string;
	entity?: string;
	originSourceId?: string;
}

export interface AphrodyRagStats {
	chunks: number;
	vectors: number;
	vectorsStored?: number;
	sources: { sourceId: string; kind: string; count: number; vectors?: number }[];
}

export type AphrodyIngestDoc = z.infer<typeof IngestRequest>;

export interface AphrodyOcrResult {
	text: string;
	language: string;
	textless: boolean;
	suspect: boolean;
	model?: string;
	findings?: unknown[];
	elapsedMs?: number;
	blocks?: unknown[];
	meanConfidence?: number;
}
