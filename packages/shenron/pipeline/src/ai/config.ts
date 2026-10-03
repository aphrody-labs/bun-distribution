// SPDX-License-Identifier: Apache-2.0
/**
 * `@shenron/pipeline/ai/config` — the single resolver of Shenron's AI configuration
 * (docs/STACK.md §3.4, docs/ENV.md).
 *
 * Runtime class: `pure`. Environment names follow the aphrody-infra local AI
 * contract v1 (`config/local-ai.json`): the canonical
 * `APHRODY_AI_*` name is read first, then each legacy alias in the contract
 * order; an alias written in another URL form (origin, endpoint) is converted
 * to the base form. No URL, host or port default lives here (D16): every
 * endpoint comes from the environment passed by the caller, and a missing one
 * is an error naming the variables to set. Every issue and every disabled
 * capability names variables only, never their values.
 */
import type {
	EmbeddingModelV4,
	EmbeddingModelV4CallOptions,
	EmbeddingModelV4Middleware,
	LanguageModelV4,
	LanguageModelV4CallOptions,
	LanguageModelV4GenerateResult,
	LanguageModelV4StreamResult,
} from "@ai-sdk/provider";
import { envString, type EnvIssue, type EnvSource } from "@shenron/config/env";
import { parseLoopbackHttpUrl } from "@shenron/config/net";
import type { generateText } from "ai";

/** The multilingual E5 embedder served by Aphrody (`aphrody-shenron-embed`). */
export const SHENRON_E5 = Object.freeze({
	modelId: "Xenova/multilingual-e5-small",
	dimensions: 384,
	maxInputs: 16,
	maxChars: 8192,
} as const);

export type ShenronE5 = typeof SHENRON_E5;

/**
 * Vector space of the Shenron RAG index, mirrored from the contract
 * (`indexes.shenron-rag`: `Xenova/multilingual-e5-small`, q8, 384 dimensions).
 * Rule `never-mix-spaces`: an embedder that differs in model or dimensions is
 * refused, never mixed into the index. Changing the space means re-indexing.
 */
export const SHENRON_RAG_INDEX = Object.freeze({
	name: "shenron-rag",
	model: SHENRON_E5.modelId,
	dimensions: SHENRON_E5.dimensions,
} as const);

/** Chat model identifiers understood by `aphrody-ai-http` (identifiers, not addresses). */
export type AphrodyChatModelId =
	| "gemini-web/flash"
	| "gemini-web/flash-lite"
	| "gemini-web/pro"
	| (string & {});

/** Default chat model id (same default as `apps/shenron/bot/src/lib/llm.ts`). */
export const DEFAULT_CHAT_MODEL: AphrodyChatModelId = "gemini-web/flash";

/** Default model of the structured vision review sent to `aphrody-ai-http`. */
export const DEFAULT_VISION_MODEL = "gemini-web/flash";

/** Longest model id accepted by `http_rest.rs` (`model.len() > 128` is rejected). */
export const MAX_CHAT_MODEL_ID_LENGTH = 128;

/** Shortest accepted `aphrody-ai-http` bearer token. */
export const MIN_COMPUTE_TOKEN_LENGTH = 32;

export type AiCapability = "compute" | "chat" | "embed" | "ocr" | "rag";

export interface AiTimeouts {
	health: number;
	embedHot: number;
	embed: number;
	chat: number;
	chatGeminiWeb: number;
	ocr: number;
}

/** Timeouts of the historical clients (compute.ts, shenron-embeddings.ts, rag.ts). */
export const DEFAULT_AI_TIMEOUTS: Readonly<AiTimeouts> = Object.freeze({
	health: 3_000,
	embedHot: 3_000,
	embed: 10_000,
	chat: 90_000,
	chatGeminiWeb: 125_000,
	ocr: 280_000,
});

// ── Environment names (aphrody-infra `config/local-ai.json`, contract v1) ──

/**
 * URL form of a value (`resolution.urlForms` of the contract): `base` is
 * `scheme://host:port` plus the capability base path (`/v1`), `origin` has no
 * path, `endpoint` is the full operation URL.
 */
export type AiUrlForm = "base" | "origin" | "endpoint";

export interface AiEnvAlias {
	readonly name: string;
	readonly form?: AiUrlForm;
}

export interface AiEnvSetting {
	readonly canonical: string;
	readonly form?: AiUrlForm;
	readonly aliases: readonly AiEnvAlias[];
}

/**
 * Every AI variable Shenron reads: canonical name, then the legacy aliases in
 * the contract order. `APHRODY_AI_CHAT_BASE_URL` and `APHRODY_AI_VISION_BASE_URL`
 * are deliberately absent: generation and vision go through `aphrody-ai-http`,
 * never to a model server directly.
 */
export const AI_ENV = Object.freeze({
	httpUrl: {
		canonical: "APHRODY_AI_HTTP_URL",
		form: "origin",
		aliases: [{ name: "APHRODY_SHENRON_API_URL", form: "origin" }],
	},
	httpToken: { canonical: "APHRODY_AI_HTTP_TOKEN", aliases: [{ name: "APHRODY_SHENRON_API_TOKEN" }] },
	chatModel: {
		canonical: "APHRODY_AI_CHAT_MODEL",
		aliases: [{ name: "APHRODY_LLM_MODEL" }, { name: "APHRODY_SHENRON_LLM_MODEL" }],
	},
	visionModel: {
		canonical: "APHRODY_AI_VISION_MODEL",
		aliases: [{ name: "APHRODY_SHENRON_VISION_MODEL" }],
	},
	embedBaseUrl: {
		canonical: "APHRODY_AI_EMBED_BASE_URL",
		form: "base",
		aliases: [
			{ name: "APHRODY_SHENRON_EMBED_BASE_URL", form: "base" },
			{ name: "EMBED_URL", form: "origin" },
			{ name: "APHRODY_RAG_EMBED_ENDPOINT", form: "endpoint" },
		],
	},
	embedModel: {
		canonical: "APHRODY_AI_EMBED_MODEL",
		aliases: [{ name: "APHRODY_SHENRON_EMBED_MODEL" }, { name: "APHRODY_RAG_EMBED_MODEL" }],
	},
	embedDimensions: {
		canonical: "APHRODY_AI_EMBED_DIMENSIONS",
		aliases: [{ name: "APHRODY_RAG_EMBED_DIM" }],
	},
	rerankBaseUrl: {
		canonical: "APHRODY_AI_RERANK_BASE_URL",
		form: "base",
		aliases: [
			{ name: "RERANK_URL", form: "endpoint" },
			{ name: "APHRODY_RAG_RERANK_ENDPOINT", form: "endpoint" },
		],
	},
	rerankModel: {
		canonical: "APHRODY_AI_RERANK_MODEL",
		aliases: [{ name: "APHRODY_RAG_RERANK_MODEL" }],
	},
} as const satisfies Record<string, AiEnvSetting>);

/** Base path of the OpenAI-compatible capabilities (embed, rerank). */
const OPENAI_BASE_PATH = "/v1";

const EMBED_TIMEOUT_VAR = "EMBED_TIMEOUT_MS";

/** Names of a setting in reading order: canonical first, then the aliases. */
export function aiEnvNames(setting: AiEnvSetting): string[] {
	return [setting.canonical, ...setting.aliases.map((alias) => alias.name)];
}

/** First set variable of `setting`, in reading order, with its URL form. */
export function readAiEnv(
	env: EnvSource,
	setting: AiEnvSetting
): { name: string; value: string; form?: AiUrlForm } | undefined {
	const candidates: AiEnvAlias[] = [
		{ name: setting.canonical, ...(setting.form ? { form: setting.form } : {}) },
		...setting.aliases,
	];
	for (const candidate of candidates) {
		const value = envString(env, candidate.name);
		if (value !== undefined) return { name: candidate.name, value, form: candidate.form ?? setting.form };
	}
	return undefined;
}

function missing(setting: AiEnvSetting): EnvIssue {
	const aliases = setting.aliases.map((alias) => alias.name);
	return {
		name: setting.canonical,
		problem: "missing",
		...(aliases.length > 0 ? { hint: `or a legacy alias: ${aliases.join(", ")}` } : {}),
	};
}

function describeNames(setting: AiEnvSetting): string {
	const aliases = setting.aliases.map((alias) => alias.name);
	return aliases.length > 0 ? `${setting.canonical} (or ${aliases.join(", ")})` : setting.canonical;
}

type Resolved<T> = { ok: true; value: T } | { ok: false; issues: EnvIssue[] };

/** Error thrown by the `require*` helpers: names variables, never values. */
export class AiConfigError extends Error {
	readonly issues: readonly EnvIssue[];
	constructor(purpose: string, issues: readonly EnvIssue[]) {
		const detail = issues
			.map((issue) => `${issue.name} ${issue.problem}${issue.hint ? ` (${issue.hint})` : ""}`)
			.join("; ");
		super(`${purpose} is not configured: ${detail}`);
		this.name = "AiConfigError";
		this.issues = issues;
	}
}

function required<T>(result: Resolved<T | null>, setting: AiEnvSetting, purpose: string): T {
	if (!result.ok) throw new AiConfigError(purpose, result.issues);
	if (result.value === null) throw new AiConfigError(purpose, [missing(setting)]);
	return result.value;
}

/**
 * Converts a loopback URL read under `hit.name` to the base form (`…/v1`):
 * an origin gets `/v1` appended (a trailing `/v1` is kept), an endpoint loses
 * its operation path, a base must already end with `/v1`.
 */
function toBaseUrl(hit: { name: string; value: string; form?: AiUrlForm }, operation: string): Resolved<URL> {
	const parsed = parseLoopbackHttpUrl(hit.value, hit.name);
	if (!parsed.ok) return { ok: false, issues: [parsed.issue] };
	const url = parsed.url;
	let path = url.pathname.replace(/\/+$/, "");
	if (hit.form === "origin") {
		if (!path.endsWith(OPENAI_BASE_PATH)) path = `${path}${OPENAI_BASE_PATH}`;
	} else if (hit.form === "endpoint") {
		const suffix = `${OPENAI_BASE_PATH}${operation}`;
		if (!path.endsWith(suffix)) {
			return { ok: false, issues: [{ name: hit.name, problem: "invalid", hint: `must end with ${suffix}` }] };
		}
		path = path.slice(0, -operation.length);
	} else if (!path.endsWith(OPENAI_BASE_PATH)) {
		return {
			ok: false,
			issues: [{ name: hit.name, problem: "invalid", hint: `must end with ${OPENAI_BASE_PATH}` }],
		};
	}
	url.pathname = path;
	return { ok: true, value: url };
}

// ── aphrody-ai-http (private `/api/v1/shenron/*` gateway) ──

export interface AiHttpEndpoint {
	/** Origin of `aphrody-ai-http`; the routes carry their absolute paths. */
	baseUrl: URL;
	token: string;
}

/** Origin of `aphrody-ai-http`, or `null` when no URL variable is set. */
export function resolveAiHttpUrl(env: EnvSource): Resolved<URL | null> {
	const hit = readAiEnv(env, AI_ENV.httpUrl);
	if (!hit) return { ok: true, value: null };
	const parsed = parseLoopbackHttpUrl(hit.value, hit.name);
	if (!parsed.ok) return { ok: false, issues: [parsed.issue] };
	return { ok: true, value: new URL(parsed.url.origin) };
}

/** Origin of `aphrody-ai-http`; throws an {@link AiConfigError} when unset or invalid. */
export function requireAiHttpUrl(env: EnvSource): URL {
	return required(resolveAiHttpUrl(env), AI_ENV.httpUrl, "aphrody-ai-http URL");
}

/** Bearer token of `aphrody-ai-http`; throws an {@link AiConfigError} when unset. */
export function requireAiHttpToken(env: EnvSource): string {
	const hit = readAiEnv(env, AI_ENV.httpToken);
	if (!hit) throw new AiConfigError("aphrody-ai-http token", [missing(AI_ENV.httpToken)]);
	return hit.value;
}

/** `true` when a token variable of `aphrody-ai-http` is set (value never exposed). */
export function hasAiHttpToken(env: EnvSource): boolean {
	return readAiEnv(env, AI_ENV.httpToken) !== undefined;
}

// ── Embeddings ──
// Embeddings go only through Aphrody `POST /api/v1/shenron/embed`. The direct
// embedder variables below are still read for health probes and legacy scripts,
// but never select an embedding transport.

let warnedIgnoredEmbedBaseUrl = false;

/**
 * Warns once per process when a direct embedder URL variable is set: the
 * E5-direct transport is removed and the value is ignored for embeddings.
 * Returns `true` when a variable was set.
 */
export function warnIgnoredEmbedBaseUrl(env: EnvSource): boolean {
	const hit = readAiEnv(env, AI_ENV.embedBaseUrl);
	if (!hit) return false;
	if (!warnedIgnoredEmbedBaseUrl) {
		warnedIgnoredEmbedBaseUrl = true;
		console.warn(
			`${hit.name} is ignored: embeddings use Aphrody POST /api/v1/shenron/embed (${describeNames(AI_ENV.httpUrl)} and ${describeNames(AI_ENV.httpToken)})`
		);
	}
	return true;
}

/** Direct embedder base (`…/v1`), or `null` when no embed URL variable is set. */
export function resolveEmbedBaseUrl(env: EnvSource): Resolved<URL | null> {
	const hit = readAiEnv(env, AI_ENV.embedBaseUrl);
	if (!hit) return { ok: true, value: null };
	return toBaseUrl(hit, "/embeddings");
}

/** Direct embedder base (`…/v1`); throws an {@link AiConfigError} when unset or invalid. */
export function requireEmbedBaseUrl(env: EnvSource): URL {
	return required(resolveEmbedBaseUrl(env), AI_ENV.embedBaseUrl, "embedder");
}

/** Health URL of an AI service, at the origin of its base URL. */
export function aiServiceHealthUrl(base: URL): URL {
	return new URL("/health", base.origin);
}

/** Health URL of the configured embedder, or `null` when unset or invalid (no default address). */
export function embedHealthUrl(env: EnvSource): URL | null {
	const base = resolveEmbedBaseUrl(env);
	return base.ok && base.value ? aiServiceHealthUrl(base.value) : null;
}

export interface EmbeddingSpace {
	readonly model: string;
	readonly dimensions: number;
}

/**
 * Embedding space the configuration asks for: `APHRODY_AI_EMBED_MODEL` and
 * `APHRODY_AI_EMBED_DIMENSIONS` (or their aliases), each defaulting to the
 * contract index {@link SHENRON_RAG_INDEX}.
 */
export function resolveEmbeddingSpace(env: EnvSource): Resolved<EmbeddingSpace> {
	const model = readAiEnv(env, AI_ENV.embedModel)?.value ?? SHENRON_RAG_INDEX.model;
	const dims = readAiEnv(env, AI_ENV.embedDimensions);
	let dimensions: number = SHENRON_RAG_INDEX.dimensions;
	if (dims) {
		const value = Number(dims.value);
		if (!Number.isSafeInteger(value) || value <= 0) {
			return {
				ok: false,
				issues: [{ name: dims.name, problem: "invalid", hint: "must be a positive integer" }],
			};
		}
		dimensions = value;
	}
	return { ok: true, value: { model, dimensions } };
}

/** Model ids compare case-insensitively and without their hub namespace (`Xenova/`). */
function sameModel(a: string, b: string): boolean {
	const bare = (id: string) => id.trim().toLowerCase().replace(/^[^/]*\//, "");
	return bare(a) === bare(b);
}

/** Raised when a configured embedding space differs from the index it would read or write. */
export class EmbeddingSpaceMismatchError extends Error {
	readonly configured: EmbeddingSpace;
	readonly index: EmbeddingSpace;
	constructor(configured: EmbeddingSpace, index: EmbeddingSpace, indexLabel: string) {
		super(
			`embedding space mismatch: ${describeNames(AI_ENV.embedModel)} / ${describeNames(AI_ENV.embedDimensions)} ` +
				`ask for ${configured.model} (${configured.dimensions} dimensions), but index ${indexLabel} holds ` +
				`${index.model} (${index.dimensions} dimensions). Embedding spaces are never mixed: fix the ` +
				"configuration or re-index."
		);
		this.name = "EmbeddingSpaceMismatchError";
		this.configured = configured;
		this.index = index;
	}
}

/** Throws an {@link EmbeddingSpaceMismatchError} unless both spaces are the same. */
export function assertEmbeddingSpace(
	configured: EmbeddingSpace,
	index: EmbeddingSpace,
	indexLabel: string = SHENRON_RAG_INDEX.name
): void {
	if (configured.dimensions !== index.dimensions || !sameModel(configured.model, index.model)) {
		throw new EmbeddingSpaceMismatchError(configured, index, indexLabel);
	}
}

/**
 * Configured embedding space, validated against `index` (the contract index
 * by default). Throws an {@link AiConfigError} on a malformed variable and an
 * {@link EmbeddingSpaceMismatchError} on a different space.
 */
export function requireEmbeddingSpace(
	env: EnvSource,
	index: EmbeddingSpace = SHENRON_RAG_INDEX,
	indexLabel: string = SHENRON_RAG_INDEX.name
): EmbeddingSpace {
	const resolved = resolveEmbeddingSpace(env);
	if (!resolved.ok) throw new AiConfigError("embedding space", resolved.issues);
	assertEmbeddingSpace(resolved.value, index, indexLabel);
	return resolved.value;
}

// ── Reranking (optional) ──

/**
 * `llama-server`: `{model, query, documents}` → `{results: [{index, relevance_score}]}`.
 * `shenron-sidecar`: `{query, passages}` → `{scores}`, kept for `RERANK_URL` only.
 */
export type RerankDialect = "llama-server" | "shenron-sidecar";

export interface RerankEndpoint {
	/** Full operation URL the request is posted to. */
	endpoint: URL;
	dialect: RerankDialect;
	model?: string;
	/** Variable the endpoint was read from. */
	source: string;
}

/** Reranker, or `null` when no rerank variable is set (the capability is optional). */
export function resolveRerank(env: EnvSource): Resolved<RerankEndpoint | null> {
	const hit = readAiEnv(env, AI_ENV.rerankBaseUrl);
	if (!hit) return { ok: true, value: null };
	const model = readAiEnv(env, AI_ENV.rerankModel)?.value;
	const extra = model ? { model } : {};
	if (hit.form === "endpoint") {
		const parsed = parseLoopbackHttpUrl(hit.value, hit.name);
		if (!parsed.ok) return { ok: false, issues: [parsed.issue] };
		const dialect: RerankDialect = hit.name === "RERANK_URL" ? "shenron-sidecar" : "llama-server";
		return { ok: true, value: { endpoint: parsed.url, dialect, source: hit.name, ...extra } };
	}
	const base = toBaseUrl(hit, "/rerank");
	if (!base.ok) return base;
	const endpoint = new URL(base.value.href);
	endpoint.pathname = `${endpoint.pathname}/rerank`;
	return { ok: true, value: { endpoint, dialect: "llama-server", source: hit.name, ...extra } };
}

// ── Model identifiers ──

function modelId(
	env: EnvSource,
	setting: AiEnvSetting,
	fallback: string,
	issues: EnvIssue[]
): string {
	const hit = readAiEnv(env, setting);
	if (!hit) return fallback;
	if (hit.value.length > MAX_CHAT_MODEL_ID_LENGTH) {
		issues.push({
			name: hit.name,
			problem: "invalid",
			hint: `must hold at most ${MAX_CHAT_MODEL_ID_LENGTH} characters`,
		});
		return fallback;
	}
	return hit.value;
}

/** Chat model id sent to `aphrody-ai-http` (`APHRODY_AI_CHAT_MODEL` or aliases, else the default). */
export function resolveChatModel(env: EnvSource): AphrodyChatModelId {
	return modelId(env, AI_ENV.chatModel, DEFAULT_CHAT_MODEL, []);
}

/** Vision model id sent to `aphrody-ai-http` (`APHRODY_AI_VISION_MODEL` or alias, else the default). */
export function resolveVisionModel(env: EnvSource): string {
	return modelId(env, AI_ENV.visionModel, DEFAULT_VISION_MODEL, []);
}

// ── Full configuration ──

/** Embedding transport: Aphrody `/api/v1/shenron/embed` only (E5-direct removed). */
export type EmbedTransport = { transport: "aphrody" };

export interface AiConfig {
	compute: AiHttpEndpoint | null;
	embed: EmbedTransport | null;
	/** Direct embedder base (`…/v1`) when configured; informational only, never used to embed. */
	e5BaseUrl: URL | null;
	/** Configured embedding space; compared with the index before any vector is read or written. */
	embedSpace: EmbeddingSpace;
	rerank: RerankEndpoint | null;
	chatModel: AphrodyChatModelId;
	visionModel: string;
	ragBackend: "aphrody" | "local";
	timeouts: AiTimeouts;
	disabled: readonly { capability: AiCapability; reason: string }[];
}

/** Chat timeout for a model id: 125 s for `gemini-web/*`, 90 s otherwise (compute.ts parity). */
export function chatTimeoutMs(
	modelId: string | undefined,
	timeouts: Pick<AiTimeouts, "chat" | "chatGeminiWeb"> = DEFAULT_AI_TIMEOUTS
): number {
	return modelId?.startsWith("gemini-web") ? timeouts.chatGeminiWeb : timeouts.chat;
}

/**
 * Resolves the AI configuration from `env`. Never throws. An empty environment
 * is valid (every capability disabled, with a reason naming the variables); a
 * partial or malformed one yields issues that name variables only.
 */
export function resolveAiConfig(
	env: EnvSource
): { ok: true; config: AiConfig } | { ok: false; issues: readonly EnvIssue[] } {
	const issues: EnvIssue[] = [];
	const disabled: { capability: AiCapability; reason: string }[] = [];
	const httpNames = `${describeNames(AI_ENV.httpUrl)} and ${describeNames(AI_ENV.httpToken)}`;

	// ── compute ──
	const url = resolveAiHttpUrl(env);
	const token = readAiEnv(env, AI_ENV.httpToken);
	let compute: AiConfig["compute"] = null;
	if (url.ok && url.value === null && token === undefined) {
		disabled.push({ capability: "compute", reason: `${httpNames} are not set` });
	} else {
		if (!url.ok) issues.push(...url.issues);
		else if (url.value === null) issues.push(missing(AI_ENV.httpUrl));
		if (token === undefined) {
			issues.push(missing(AI_ENV.httpToken));
		} else if (token.value.length < MIN_COMPUTE_TOKEN_LENGTH) {
			issues.push({
				name: token.name,
				problem: "invalid",
				hint: `must hold at least ${MIN_COMPUTE_TOKEN_LENGTH} characters`,
			});
		} else if (url.ok && url.value) {
			compute = { baseUrl: url.value, token: token.value };
		}
	}

	// ── embed: Aphrody only; a direct embedder URL is ignored (one-time warning) ──
	const e5 = resolveEmbedBaseUrl(env);
	const e5BaseUrl = e5.ok ? e5.value : null;
	warnIgnoredEmbedBaseUrl(env);
	let embed: EmbedTransport | null = null;
	if (compute) embed = { transport: "aphrody" };
	else disabled.push({ capability: "embed", reason: `requires ${httpNames}` });

	const space = resolveEmbeddingSpace(env);
	if (!space.ok) issues.push(...space.issues);

	const rerank = resolveRerank(env);
	if (!rerank.ok) issues.push(...rerank.issues);

	if (!compute) {
		const reason = `requires ${httpNames}`;
		disabled.push({ capability: "chat", reason });
		disabled.push({ capability: "ocr", reason });
		disabled.push({ capability: "rag", reason });
	}

	// ── model ids ──
	const chatModel = modelId(env, AI_ENV.chatModel, DEFAULT_CHAT_MODEL, issues);
	const visionModel = modelId(env, AI_ENV.visionModel, DEFAULT_VISION_MODEL, issues);

	// ── timeouts ──
	const timeouts: AiTimeouts = { ...DEFAULT_AI_TIMEOUTS };
	const rawEmbedTimeout = envString(env, EMBED_TIMEOUT_VAR);
	if (rawEmbedTimeout !== undefined) {
		const ms = Number(rawEmbedTimeout);
		if (!Number.isSafeInteger(ms) || ms <= 0) {
			issues.push({
				name: EMBED_TIMEOUT_VAR,
				problem: "invalid",
				hint: "must be a positive integer (ms)",
			});
		} else {
			timeouts.embedHot = ms;
		}
	}

	if (issues.length > 0 || !space.ok || !rerank.ok) return { ok: false, issues };
	return {
		ok: true,
		config: {
			compute,
			embed,
			e5BaseUrl,
			embedSpace: space.value,
			rerank: rerank.value,
			chatModel,
			visionModel,
			// Exact match, like the historical `process.env.RAG_BACKEND === "aphrody"`.
			ragBackend: env.RAG_BACKEND === "aphrody" ? "aphrody" : "local",
			timeouts,
			disabled,
		},
	};
}

// ── Type-only probes of the AI SDK declarations (checked by `tsc`, erased at runtime) ──

type Expect<T extends true> = T;
type Extends<A, B> = [A] extends [B] ? true : false;

/** Minimal object shape a Shenron chat model adapter must have. */
interface ProbeLanguageModel {
	readonly specificationVersion: "v4";
	readonly provider: "shenron.probe";
	readonly modelId: string;
	readonly supportedUrls: Record<string, RegExp[]>;
	doGenerate(options: LanguageModelV4CallOptions): PromiseLike<LanguageModelV4GenerateResult>;
	doStream(options: LanguageModelV4CallOptions): PromiseLike<LanguageModelV4StreamResult>;
}

/** E5 middleware shape: cap the batch at {@link SHENRON_E5}.maxInputs, pass params through. */
interface ProbeEmbeddingMiddleware {
	readonly specificationVersion: "v4";
	overrideMaxEmbeddingsPerCall: (options: { model: EmbeddingModelV4 }) => number;
	transformParams: (options: {
		params: EmbeddingModelV4CallOptions;
		model: EmbeddingModelV4;
	}) => PromiseLike<EmbeddingModelV4CallOptions>;
}

/** `generateText` must accept `instructions` (system prompt) next to `prompt`. */
interface ProbeGenerateTextCall {
	model: LanguageModelV4;
	instructions: string;
	prompt: string;
}

export type AiSdkTypeProbe = [
	Expect<Extends<ProbeLanguageModel, LanguageModelV4>>,
	Expect<Extends<ProbeEmbeddingMiddleware, EmbeddingModelV4Middleware>>,
	Expect<Extends<ProbeGenerateTextCall, Parameters<typeof generateText>[0]>>,
];
