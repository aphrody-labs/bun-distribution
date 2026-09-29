/**
 * IA & Canon Cockpit (/admin/ia) — concrete data sources.
 *
 * Owners, never local files of another process:
 *   - Aphrody AI private HTTP (`APHRODY_AI_HTTP_URL`, loopback, bearer
 *     `APHRODY_AI_HTTP_TOKEN`, legacy aliases accepted): health, RAG statistics, search mode;
 *   - Aphrody Web (`APHRODY_WEB_API_URL`, bearer `APHRODY_BXC_API_TOKEN`):
 *     crawl queue statistics;
 *   - the bot process over HTTP (`BOT_INTERNAL_URL`, else the configured bot
 *     API URL): its local index while `RAG_BACKEND` is not `aphrody`, and
 *     every write on its runtime tables (admin bearer `SHENRON_ADMIN_TOKEN`);
 *   - PostgreSQL `bot.*`, the mirror of the bot runtime tables, for reads;
 *   - the versioned gold set shipped with the release.
 * The site no longer opens the bot SQLite database.
 */
import "server-only";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { AphrodyComputeClient } from "@shenron/pipeline/aphrody";
import { hasAiHttpToken } from "@shenron/pipeline/ai/config";
import { createShenronApiClient, type ApiResult } from "@shenron/api/client";
import type {
	CompleteGoalBody,
	CreateGoalBody,
	FeedbackStatusBody,
	GoldCaseBody,
} from "@shenron/api/contract";
import { resolveDataPath } from "@shenron/config/paths";
import { db } from "@/lib/db";
import { botApiBaseUrl } from "@/lib/config";
import { listAgentKeys } from "@/lib/agent-keys";
import { getAdminLabRecentMessages } from "@/lib/admin-lab";
import { searchAphrodyRag } from "@/lib/site-rag";
import {
	SourceNotConfiguredError,
	computeRetrievalMetrics,
	describeError,
	fetchAphrodyWebCrawlStats,
	goldCaseView,
	mapDiscordMessage,
	mapEvalRow,
	mapFeedbackRow,
	mapGoalRow,
	parseBotIaStatus,
	parseGoldSet,
	resolveRagBackend,
	summarizeAphrodyRagStats,
	toNumber,
	type CockpitEvalResult,
	type GoldCase,
	type IaCockpitFetchers,
	type RagBackendInfo,
	type RetrievalHit,
	type RetrievalMetrics,
} from "@/lib/ia-cockpit";

const APHRODY_TIMEOUT_MS = 5_000;
const APHRODY_SEARCH_TIMEOUT_MS = 10_000;
const BOT_TIMEOUT_MS = 5_000;
/** Fixed probe query: the answered `mode` says which retrieval really serves. */
const RAG_PROBE_QUERY = "Son Goku";

/** Failure of a cockpit action, with the HTTP status to return. */
export class CockpitActionError extends Error {
	constructor(
		public readonly status: number,
		message: string
	) {
		super(message);
		this.name = "CockpitActionError";
	}
}

export function currentRagBackend(): RagBackendInfo {
	return resolveRagBackend(process.env.RAG_BACKEND);
}

/** `BOT_INTERNAL_URL`, sinon l'URL d'API configurée (résolveur unique de `@/lib/config`). */
function botBaseUrl(): string {
	return botApiBaseUrl();
}

/** `fetch` bounded by a timeout, combined with the caller's own signal. */
function fetchWithTimeout(timeoutMs: number): typeof fetch {
	const bounded = (input: RequestInfo | URL, init?: RequestInit) =>
		fetch(input, {
			...init,
			signal: init?.signal
				? AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)])
				: AbortSignal.timeout(timeoutMs),
		});
	return Object.assign(bounded, { preconnect: fetch.preconnect }) as typeof fetch;
}

/** Aphrody AI client; a missing or invalid configuration is reported as such. */
function aphrodyCompute(timeoutMs = APHRODY_TIMEOUT_MS): AphrodyComputeClient {
	if (!hasAiHttpToken(process.env)) {
		throw new SourceNotConfiguredError(
			"APHRODY_AI_HTTP_TOKEN (ou APHRODY_SHENRON_API_TOKEN) absent de l'environnement du site"
		);
	}
	try {
		return new AphrodyComputeClient({ fetcher: fetchWithTimeout(timeoutMs) });
	} catch (error) {
		throw new SourceNotConfiguredError(describeError(error));
	}
}

/** Runs one administrator-supplied image through Aphrody's OCR endpoint. */
export async function runAphrodyOcr(imageBase64: string, language = "ja") {
	if (!/^[A-Za-z0-9+/=\r\n]+$/.test(imageBase64) || imageBase64.length > 8_000_000) {
		throw new CockpitActionError(400, "Image OCR invalide ou trop volumineuse.");
	}
	if (!/^(ja|fr|en)$/.test(language)) {
		throw new CockpitActionError(400, "Langue OCR non prise en charge.");
	}
	return aphrodyCompute(30_000).ocr(imageBase64, language);
}

async function fetchBotJson(path: string, timeoutMs = BOT_TIMEOUT_MS): Promise<unknown> {
	const url = `${botBaseUrl()}${path}`;
	const response = await fetch(url, {
		headers: { accept: "application/json" },
		cache: "no-store",
		signal: AbortSignal.timeout(timeoutMs),
	});
	if (!response.ok) {
		const detail = (await response.text().catch(() => "")).trim().slice(0, 200);
		throw new Error(`Bot HTTP ${response.status} sur ${path.split("?")[0]}${detail ? ` : ${detail}` : ""}`);
	}
	return response.json();
}

// ── Gold set (versioned file shipped with the release) ───────────────────────

const GOLD_RELATIVE = join("apps", "bot", "tests", "rag-gold.jsonl");

/** Historical search inside the release (site cwd, then monorepo root). */
function legacyGoldSetPath(): string | null {
	const candidates = [
		// Site process: cwd = apps/shenron/site of the release.
		join(process.cwd(), "..", "bot", "tests", "rag-gold.jsonl"),
		// Monorepo root (tests, scripts).
		join(process.cwd(), GOLD_RELATIVE),
	];
	return candidates.find((path) => existsSync(path)) ?? null;
}

/**
 * Gold set path (D15): `RAG_GOLD_PATH` / `RAG_GOLD` when set and present,
 * else the historical candidate search.
 */
function goldSetPath(env: Record<string, string | undefined> = process.env): string | null {
	const legacy = legacyGoldSetPath();
	const resolved = resolveDataPath("ragGold", { env, legacyDefault: legacy ?? "" });
	if (resolved.source === "env" && existsSync(resolved.path)) return resolved.path;
	return legacy;
}

async function readGoldCases(): Promise<GoldCase[]> {
	const path = goldSetPath();
	if (!path) throw new Error(`Jeu doré introuvable (${GOLD_RELATIVE} absent de la release)`);
	const cases = parseGoldSet(await readFile(/* turbopackIgnore: true */ path, "utf8"));
	if (cases.length === 0) throw new Error("Jeu doré vide ou illisible");
	return cases;
}

// ── PostgreSQL mirror of the bot runtime tables ─────────────────────────────

async function rows(query: ReturnType<typeof sql>): Promise<Record<string, unknown>[]> {
	return (await db.execute(query)) as unknown as Record<string, unknown>[];
}

// ── Overview sources ─────────────────────────────────────────────────────────

export function createIaCockpitFetchers(): IaCockpitFetchers {
	return {
		aphrodyHealth: {
			label: "Aphrody AI — santé",
			target: "GET /api/v1/shenron/health",
			run: () => aphrodyCompute().health(),
		},
		aphrodyRagStats: {
			label: "Aphrody RAG — statistiques",
			target: "GET /api/v1/shenron/rag/stats",
			run: async () => summarizeAphrodyRagStats(await aphrodyCompute().ragStats()),
		},
		aphrodyRagProbe: {
			label: "Aphrody RAG — sonde de recherche",
			target: `GET /api/v1/shenron/rag/search?q=${RAG_PROBE_QUERY}`,
			run: async () => {
				const { results, mode } = await aphrodyCompute().ragSearchWithMode(RAG_PROBE_QUERY, 1);
				return { query: RAG_PROBE_QUERY, mode, hits: results.length };
			},
		},
		aphrodyWeb: {
			label: "Aphrody Web — crawl",
			target: "GET /crawl/stats",
			run: () =>
				fetchAphrodyWebCrawlStats({
					baseUrl: process.env.APHRODY_WEB_API_URL,
					token: process.env.APHRODY_BXC_API_TOKEN,
					timeoutMs: APHRODY_TIMEOUT_MS,
				}),
		},
		botRag: {
			label: "Bot Shenron — index local",
			target: "GET /api/ia/status",
			run: async () => parseBotIaStatus(await fetchBotJson("/api/ia/status")),
		},
		evalHistory: {
			label: "Historique d'évaluation (PostgreSQL)",
			target: "bot.rag_eval_history",
			run: async () =>
				(
					await rows(sql`
						SELECT id, recall_1, recall_3, recall_5, recall_10, mrr, ndcg, duration_ms,
						       cases_count, sidecar_online, misses_count, created_at
						FROM bot.rag_eval_history
						ORDER BY created_at DESC, id DESC
						LIMIT 10
					`)
				).map(mapEvalRow),
		},
		goldSet: {
			label: "Jeu doré versionné",
			target: GOLD_RELATIVE.replaceAll("\\", "/"),
			run: async () => {
				const cases = await readGoldCases();
				return { cases: cases.length, sample: cases.slice(0, 100).map(goldCaseView) };
			},
		},
		feedbacks: {
			label: "Retours d'entraînement (PostgreSQL)",
			target: "bot.rag_training_feedback",
			run: async () => {
				const [latest, [counts]] = await Promise.all([
					rows(sql`
						SELECT id, user_tag, type, query, status, expected, comment, created_at
						FROM bot.rag_training_feedback
						ORDER BY id DESC
						LIMIT 20
					`),
					rows(sql`
						SELECT count(*)::int AS total,
						       count(*) FILTER (WHERE status = 'pending')::int AS pending
						FROM bot.rag_training_feedback
					`),
				]);
				return {
					total: toNumber(counts?.total, "total"),
					pending: toNumber(counts?.pending, "pending"),
					rows: latest.map(mapFeedbackRow),
				};
			},
		},
		goals: {
			label: "Objectifs actifs (PostgreSQL)",
			target: "bot.admin_goals",
			run: async () => {
				const active = await rows(sql`
					SELECT id, title, description, priority, status, created_at
					FROM bot.admin_goals
					WHERE status IN ('pending', 'in_progress')
					ORDER BY id DESC
				`);
				return { active: active.length, rows: active.slice(0, 50).map(mapGoalRow) };
			},
		},
		labMessages: {
			label: "Discord — salon admin",
			target: "GET /channels/{salon admin}/messages",
			run: async () => (await getAdminLabRecentMessages(10)).map(mapDiscordMessage),
		},
		agentKeys: {
			label: "Clés d'agents",
			target: "public.agent_keys",
			run: async () =>
				(await listAgentKeys()).map((key) => ({
					id: key.id,
					name: key.name,
					scopes: [...key.scopes],
					createdAt: key.createdAt,
				})),
		},
	};
}

// ── Search through the configured engine ─────────────────────────────────────

function parseBotSearch(json: unknown): { mode: string; results: RetrievalHit[] } {
	const body = json as { results?: unknown; mode?: unknown } | null;
	if (!body || !Array.isArray(body.results)) throw new Error("Réponse de recherche du bot invalide");
	const results = body.results.map((value) => {
		const hit = value as Record<string, unknown>;
		if (typeof hit?.title !== "string" || typeof hit.snippet !== "string") {
			throw new Error("Résultat de recherche du bot invalide");
		}
		return {
			title: hit.title,
			snippet: hit.snippet,
			url: typeof hit.url === "string" ? hit.url : null,
			score: typeof hit.score === "number" ? hit.score : undefined,
		};
	});
	return { mode: typeof body.mode === "string" ? body.mode : "inconnu", results };
}

/** One search on the engine selected by RAG_BACKEND; failures propagate. */
export async function searchConfiguredRag(
	query: string,
	limit: number,
	backend: RagBackendInfo
): Promise<{ mode: string; results: RetrievalHit[] }> {
	if (backend.value === "aphrody") {
		const { mode, results } = await searchAphrodyRag(query, limit, {}, aphrodyCompute(APHRODY_SEARCH_TIMEOUT_MS));
		return { mode, results };
	}
	const params = new URLSearchParams({ q: query, limit: String(limit) });
	return parseBotSearch(await fetchBotJson(`/api/public/rag/search?${params}`, APHRODY_SEARCH_TIMEOUT_MS));
}

// ── Bot writes (the bot owns its runtime tables and the gold set) ────────────

const BOT_WRITE_TIMEOUT_MS = 15_000;
const BOT_EVAL_TIMEOUT_MS = 180_000;

/** Typed client of the bot cockpit routes (`@shenron/api/client`, admin bearer). */
function botCockpitClient(timeoutMs: number) {
	const token = process.env.SHENRON_ADMIN_TOKEN?.trim();
	if (!token) {
		throw new CockpitActionError(
			503,
			"SHENRON_ADMIN_TOKEN absent de l'environnement du site : écriture vers le bot impossible"
		);
	}
	const noStore = ((input: RequestInfo | URL, init?: RequestInit) =>
		fetch(input, { ...init, cache: "no-store" })) as typeof fetch;
	return createShenronApiClient({
		baseUrl: botBaseUrl(),
		fetch: noStore,
		timeoutMs,
		adminToken: () => token,
	}).cockpit;
}

/**
 * Maps a client failure onto the historical `postToBot` errors: unreachable →
 * 502 "Bot injoignable", bot 400/404 kept, any other bot status → 502.
 */
function cockpitErrorFrom(failure: Exclude<ApiResult<unknown>, { ok: true }>): CockpitActionError {
	if (failure.kind === "unreachable" || failure.kind === "timeout") {
		return new CockpitActionError(502, `Bot injoignable : ${failure.detail}`);
	}
	if (failure.kind === "http") {
		const status = failure.status === 400 || failure.status === 404 ? failure.status : 502;
		return new CockpitActionError(status, `Bot (HTTP ${failure.status} sur ${failure.path}) : ${failure.detail}`);
	}
	return new CockpitActionError(502, `Bot : réponse invalide sur ${failure.path} (${failure.detail})`);
}

async function unwrap<T>(pending: Promise<ApiResult<T>>): Promise<T> {
	const result = await pending;
	if (!result.ok) throw cockpitErrorFrom(result);
	return result.value;
}

// ── Bot writes (the bot owns its runtime tables and the gold set) ────────────

/** Cockpit writes delegated to the bot through the typed contract client. */
export const botCockpit = {
	createGoal: (body: CreateGoalBody) =>
		unwrap(botCockpitClient(BOT_WRITE_TIMEOUT_MS).createGoal(body)),
	completeGoal: (id: number, body: CompleteGoalBody) =>
		unwrap(botCockpitClient(BOT_WRITE_TIMEOUT_MS).completeGoal(id, body)),
	setFeedbackStatus: (id: number, body: FeedbackStatusBody) =>
		unwrap(botCockpitClient(BOT_WRITE_TIMEOUT_MS).setFeedbackStatus(id, body)),
	addGold: (body: GoldCaseBody) => unwrap(botCockpitClient(BOT_WRITE_TIMEOUT_MS).addGold(body)),
	runEval: (samples: number) => unwrap(botCockpitClient(BOT_EVAL_TIMEOUT_MS).runEval({ samples })),
};

// ── Live evaluation ─────────────────────────────────────────────────────────

/**
 * Aphrody: measured here against Aphrody search, not historised (the history
 * table belongs to the bot). Local engine: delegated to the bot, which runs
 * the same measure on its own index and records the snapshot itself.
 */
export async function evaluateConfiguredRag(samples: number, backend: RagBackendInfo): Promise<CockpitEvalResult> {
	if (backend.value !== "aphrody") {
		const result = await botCockpit.runEval(samples);
		// `metrics` is a loose object in the contract: the retrieval fields are checked here.
		const raw = result.metrics;
		if (
			typeof raw.mrr !== "number" ||
			typeof raw.ndcg !== "number" ||
			typeof raw.recall !== "object" ||
			raw.recall === null
		) {
			throw new CockpitActionError(502, "Le bot a renvoyé une évaluation invalide");
		}
		const metrics = raw as unknown as Omit<RetrievalMetrics, "misses"> & {
			misses?: RetrievalMetrics["misses"];
		};
		return {
			cases: metrics.cases,
			recall: metrics.recall,
			mrr: metrics.mrr,
			ndcg: metrics.ndcg,
			durationMs: metrics.durationMs,
			misses: metrics.misses ?? [],
			engine: backend.engine,
			persisted: result.persisted === true,
		};
	}

	let gold: GoldCase[];
	try {
		gold = await readGoldCases();
	} catch (error) {
		throw new CockpitActionError(503, describeError(error));
	}
	const cases = samples > 0 && samples < gold.length ? gold.slice(0, samples) : gold;
	const start = performance.now();
	const runs: Array<{ case: GoldCase; hits: RetrievalHit[] }> = [];
	for (const c of cases) {
		try {
			runs.push({ case: c, hits: (await searchConfiguredRag(c.q, 10, backend)).results });
		} catch (error) {
			throw new CockpitActionError(503, `Recherche Aphrody indisponible (cas « ${c.q} ») : ${describeError(error)}`);
		}
	}
	return {
		...computeRetrievalMetrics(runs, Math.round(performance.now() - start)),
		engine: backend.engine,
		persisted: false,
	};
}
