/**
 * Type definitions for the Shenron pipeline and Aphrody IPC bridge (Tauri 2.0 / local web fallback).
 */

// ── Bridge Transport & Config ───────────────────────────────────────────────

export type BridgeTransport = "tauri" | "http";

export interface BridgeConfig {
	/** URL de repli de l'API locale quand Tauri n'est pas injecté */
	fallbackApiUrl?: string;
	/** Forcer un mode de transport spécifique */
	forcedTransport?: BridgeTransport;
	/** Délai d'expiration des requêtes en millisecondes */
	timeoutMs?: number;
}

export interface IpcResponse<T = unknown> {
	success: boolean;
	data?: T;
	error?: string;
	latencyMs?: number;
}

// ── Chat & Dialogue Types ──────────────────────────────────────────────────

export type ChatRole = "user" | "assistant" | "system" | "thought";

export interface SourceCitation {
	id: string;
	title: string;
	sourceTitle?: string;
	quote?: string;
	year?: number | string;
	kind: "manga" | "databook" | "anime" | "interview" | "canon" | "wiki";
	url?: string;
	score?: number;
	truthMultiplier?: number;
	snippet: string;
	tome?: string | number;
	chapitre?: number;
	page?: number;
	databookId?: number;
	imageUrl?: string;
}

export interface ChatMessage {
	id: string;
	role: ChatRole;
	content: string;
	timestamp: string;
	thought?: string;
	citations?: SourceCitation[];
	isStreaming?: boolean;
	error?: string;
}

export type ChatPersona = "whis" | "shenron" | "toriyama" | "kaio" | "vegeta" | "raw";

export interface ModelOption {
	id: string;
	name: string;
	provider: "aphrody-local" | "anthropic" | "openai" | "google" | "mistral";
	description: string;
	supportsStreaming: boolean;
	contextWindow: number;
}

export interface SendPromptRequest {
	prompt: string;
	persona?: ChatPersona;
	modelId?: string;
	context?: string;
	sessionId?: string;
	stream?: boolean;
	entityFilter?: string;
}

export interface StreamTokenEvent {
	messageId: string;
	delta: string;
	isThought?: boolean;
	done?: boolean;
	citations?: SourceCitation[];
}

// ── RAG Types ──────────────────────────────────────────────────────────────

export interface RagHit {
	rowid: number;
	kind: string;
	title: string;
	url: string;
	snippet: string;
	score: number;
	truthMultiplier?: number;
	metadata?: Record<string, unknown>;
}

export interface RagSearchResult {
	query: string;
	results: RagHit[];
	mode: "hybrid" | "lexical" | "dense";
	latencyMs: number;
	totalFound: number;
}

export interface RagStats {
	totalChunks: number;
	totalVectors: number;
	ragSource: "bot" | "replica" | "local-aphrody";
	ragMode: "hybrid" | "lexical" | "unavailable";
	ragBuiltAt: string | null;
	embeddingsModel: string;
	distribution: {
		manga: number;
		databooks: number;
		interviews: number;
		wiki: number;
		episodes: number;
	};
}

// ── Canon Types ────────────────────────────────────────────────────────────

export type CanonTier =
	| "canon_absolu"
	| "canon_supervise"
	| "extension_officielle"
	| "derive_non_canon"
	| "apocryphe";

export interface CanonTierInfo {
	id: CanonTier;
	label: string;
	court: string;
	couleur: string;
	definition: string;
	weight: number;
}

export interface CanonTopic {
	id: string;
	name: string;
	category: "character" | "form" | "lore" | "work" | "myth";
	tier: CanonTier;
	verdict: string;
	explanation: string;
	toriyamaQuote?: {
		text: string;
		source: string;
		year?: number;
	};
	sources: string[];
}

export interface CanonVerdict {
	query: string;
	tier: CanonTier;
	tierLabel: string;
	rank?: number;
	rankLabel?: string;
	score: number;
	verdict: string;
	explanation: string;
	nature: "verdict" | "troll" | "inconnu";
	toriyamaQuote?: {
		text: string;
		source: string;
		year?: number;
	};
	references: SourceCitation[];
	citations?: SourceCitation[];
}

export interface CanonDoctrineConfig {
	tiers: CanonTierInfo[];
	entries: CanonTopic[];
	intro?: string;
	placeholder?: string;
	strictMode?: boolean;
}

// ── Transcriptions & OCR Types ─────────────────────────────────────────────

export interface OcrPlate {
	databookId: number;
	databookTitle: string;
	pageNumber: number;
	imageUrl: string | null;
	textJa: string | null;
	textFr: string | null;
	verified: boolean;
	defectKind?: "empty" | "loop" | "short" | "foreign" | "han-sans-kana" | "suspect" | "clean";
	charCount: number;
	ocrScore?: number;
}

export interface OcrBatch {
	id: string;
	name: string;
	status: "pending" | "running" | "completed" | "failed";
	progress: number;
	totalPages: number;
	processedPages: number;
	defectsCount: number;
	engine: "manga-ocr" | "paddle-ocr" | "aphrody-vision";
	startedAt: string;
}

export interface OcrOverview {
	totalPlates?: number;
	transcribedPlates?: number;
	translatedPlates?: number;
	defectivePlates?: number;
	databooks: {
		totalBooks: number;
		totalPages: number;
		transcribedPages: number;
		translatedPages: number;
		defectivePages: number;
		missingScans: number;
		transcriptionRate: number;
		translationRate: number;
	};
	manga: {
		totalChapters: number;
		totalPages: number;
		ocrPages: number;
		ocrWithText: number;
	};
	activeBatches: OcrBatch[];
}

// ── Traduction & Lexique Types ─────────────────────────────────────────────

export interface TranslationBatch {
	id: string;
	title: string;
	count: number;
	pageCount?: number;
	engine?: string;
	path: string;
	status: "ready" | "in_progress" | "completed";
	targetLanguage: "fr" | "en";
	progressPercentage: number;
}

export interface LexiqueEntry {
	id: string;
	kanji: string;
	kana?: string;
	romaji: string;
	french: string;
	category: "personnage" | "technique" | "race" | "planete" | "objet" | "transformation";
	canonTier: CanonTier;
	notes?: string;
	verified: boolean;
}

export interface BilingualAlignment {
	segmentId: string;
	sourceJa: string;
	targetFr: string;
	alignedTokens: Array<{ ja: string; fr: string }>;
	score: number;
	status: "unreviewed" | "approved" | "rejected";
}

// ── A2A & Agents Types ─────────────────────────────────────────────────────

export interface A2aMessage {
	id: string;
	from: string;
	to: string;
	subject: string;
	content: string;
	summary?: string;
	timestamp: string;
	type: "goal" | "report" | "task" | "heartbeat" | "notification";
	status: "unread" | "read" | "processed";
}

export interface AgentHeartbeat {
	agentId: string;
	peerId?: string;
	name: string;
	role: string;
	status: "online" | "idle" | "busy" | "offline";
	lastSeen: string;
	currentTask?: string;
	latencyMs: number;
	host: string;
}

export interface AgentTask {
	id: string;
	assignedTo: string;
	title: string;
	status: "pending" | "in_progress" | "completed" | "failed";
	priority: "high" | "normal" | "low";
	createdAt: string;
	completedAt?: string;
}

// ── IA Cockpit Types ───────────────────────────────────────────────────────

export interface IaObjective {
	id: string;
	title: string;
	description: string;
	progress: number;
	status: "active" | "completed" | "paused";
	priority: "p0" | "p1" | "p2";
	ownerAgent: string;
	targetMetric?: string;
}

export interface AutoEvalMetric {
	totalSamples: number;
	accuracy: number;
	precision: number;
	recall: number;
	toriyamaScore: number;
	avgLatencyMs: number;
	evaluatedAt: string;
}

export interface IaHealthStatus {
	overallStatus: "healthy" | "degraded" | "critical";
	services: Array<{
		name: string;
		url: string;
		status: "ok" | "degraded" | "down";
		latencyMs: number;
		details?: string;
	}>;
	activeGoalsCount: number;
	openReportsCount: number;
}
