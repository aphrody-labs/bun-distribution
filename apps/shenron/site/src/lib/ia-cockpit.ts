/**
 * IA & Canon Cockpit (/admin/ia) — pure status aggregation.
 *
 * Aphrody owns RAG, LLM, OCR, embeddings and crawl for Shenron. The cockpit
 * reports what each owner actually answers, source by source:
 *   - `ok`           the source answered and its payload was validated;
 *   - `unavailable`  the source failed (HTTP error, timeout, invalid payload),
 *                    with the error message;
 *   - `unconfigured` the site lacks the environment needed to query it.
 * There is no silent fallback: a failing source never becomes an empty list or
 * a zero counter, and one failing source never hides the others.
 *
 * This module performs no I/O by itself (fetchers are injected), so the whole
 * aggregation is testable with fakes. The concrete fetchers live in
 * `ia-cockpit-server.ts`.
 */

import {
	firstHitRank,
	type GoldCase as SharedGoldCase,
	isHit,
	ndcgAtK,
	normalizeUrl,
	RANKS,
} from "@shenron/pipeline/ai/eval";

// ── Source reports ───────────────────────────────────────────────────────────

export type SourceStatus = "ok" | "unavailable" | "unconfigured";

export interface SourceReport<T> {
	status: SourceStatus;
	/** Human label (French UI). */
	label: string;
	/** What was queried: route, table or file. Never carries a secret. */
	target: string;
	/** Measured duration; null when the source was not queried at all. */
	latencyMs: number | null;
	data: T | null;
	error: string | null;
}

/** Thrown by a fetcher when the site lacks the configuration to query a source. */
export class SourceNotConfiguredError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SourceNotConfiguredError";
	}
}

export interface SourceSpec<T> {
	label: string;
	target: string;
	run: () => Promise<T>;
}

/** Readable error message; timeouts are named as such. */
export function describeError(error: unknown): string {
	if (error instanceof Error) {
		if (error.name === "TimeoutError") return "Délai de réponse dépassé";
		return error.message || error.name;
	}
	return String(error);
}

/** Runs one source; never throws. */
export async function probeSource<T>(
	spec: SourceSpec<T>,
	clock: () => number = () => performance.now()
): Promise<SourceReport<T>> {
	const start = clock();
	const base = { label: spec.label, target: spec.target };
	try {
		const data = await spec.run();
		return { ...base, status: "ok", latencyMs: Math.round(clock() - start), data, error: null };
	} catch (error) {
		if (error instanceof SourceNotConfiguredError) {
			return { ...base, status: "unconfigured", latencyMs: null, data: null, error: error.message };
		}
		return {
			...base,
			status: "unavailable",
			latencyMs: Math.round(clock() - start),
			data: null,
			error: describeError(error),
		};
	}
}

// ── Serving engine (RAG_BACKEND) ─────────────────────────────────────────────

type RagBackend = "aphrody" | "local";

export interface RagBackendInfo {
	value: RagBackend;
	/** Raw `RAG_BACKEND` value, null when unset. */
	raw: string | null;
	/** Engine that serves search traffic for this value. */
	engine: string;
}

/** Same rule as `usesAphrodyRag()` in `site-rag.ts`: only the exact value `aphrody` switches. */
export function resolveRagBackend(raw: string | undefined | null): RagBackendInfo {
	const value: RagBackend = raw === "aphrody" ? "aphrody" : "local";
	return {
		value,
		raw: raw ?? null,
		engine: value === "aphrody" ? "Aphrody AI" : "Bot Shenron (index local)",
	};
}

// ── Payloads ─────────────────────────────────────────────────────────────────

interface AphrodyHealthData {
	rag: boolean;
	llm: boolean;
	ocr: boolean;
}

export interface AphrodyRagStatsData {
	chunks: number;
	/** Vectors aligned with visible documents (usable by the hybrid fusion). */
	vectors: number;
	/** Every stored vector row, aligned or not; null when not reported. */
	vectorsStored: number | null;
	/** Number of distinct source groups reported by Aphrody. */
	sources: number;
	kinds: Array<{ kind: string; count: number; vectors: number }>;
}

interface RagProbeData {
	query: string;
	mode: string;
	hits: number;
}

interface WebCrawlQueue {
	pending: number;
	locked: number;
	done: number;
	failed: number;
	total: number;
}

export interface WebCrawlData {
	queue: WebCrawlQueue;
	jobs: number;
	runningJobs: number;
}

export interface BotRagData {
	chunks: number;
	vectors: number;
	mode: string;
	builtAt: string | null;
	gatewayReady: boolean | null;
}

export interface EvalSnapshot {
	id: number;
	createdAt: string;
	casesCount: number;
	recall1: number;
	recall3: number;
	recall5: number;
	recall10: number;
	mrr: number;
	ndcg: number;
	durationMs: number;
	sidecarOnline: boolean;
	missesCount: number;
}

export interface GoldCaseView {
	q: string;
	/** Expected source: URL prefixes first, then titles, then legacy keywords. */
	expected: string[];
}

interface GoldSetData {
	cases: number;
	sample: GoldCaseView[];
}

export interface FeedbackRow {
	id: number;
	userTag: string | null;
	type: string | null;
	query: string;
	status: string;
	expected: string | null;
	comment: string | null;
	createdAt: string | null;
}

interface FeedbackData {
	total: number;
	pending: number;
	rows: FeedbackRow[];
}

export interface GoalRow {
	id: number;
	title: string;
	description: string | null;
	priority: string | null;
	status: string;
	createdAt: string | null;
}

interface GoalsData {
	active: number;
	rows: GoalRow[];
}

export interface LabMessage {
	id: string;
	author: string;
	content: string;
	timestamp: string | null;
}

interface AgentKeySummary {
	id: string;
	name: string;
	scopes: string[];
	createdAt: string | null;
}

// ── Parsers (validate every external payload) ────────────────────────────────

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const isCount = (value: unknown): value is number =>
	typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** Numeric PostgreSQL column: postgres-js returns `bigint` as a string. */
export function toNumber(value: unknown, column: string): number {
	const n = typeof value === "bigint" ? Number(value) : typeof value === "string" ? Number(value) : value;
	if (typeof n !== "number" || !Number.isFinite(n)) throw new Error(`Colonne ${column} invalide`);
	return n;
}

function toText(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

/** Epoch milliseconds (bigint column) → ISO string, null when absent. */
function epochMsToIso(value: unknown, column: string): string | null {
	if (value === null || value === undefined) return null;
	const date = new Date(toNumber(value, column));
	if (Number.isNaN(date.getTime())) throw new Error(`Colonne ${column} invalide`);
	return date.toISOString();
}

/** Groups Aphrody `/rag/stats` sources by kind (largest first). */
export function summarizeAphrodyRagStats(stats: {
	chunks: number;
	vectors: number;
	vectorsStored?: number;
	sources: Array<{ kind: string; count: number; vectors?: number }>;
}): AphrodyRagStatsData {
	const byKind = new Map<string, { count: number; vectors: number }>();
	for (const source of stats.sources) {
		const entry = byKind.get(source.kind) ?? { count: 0, vectors: 0 };
		entry.count += source.count;
		entry.vectors += source.vectors ?? 0;
		byKind.set(source.kind, entry);
	}
	return {
		chunks: stats.chunks,
		vectors: stats.vectors,
		vectorsStored: stats.vectorsStored ?? null,
		sources: stats.sources.length,
		kinds: [...byKind]
			.map(([kind, entry]) => ({ kind, ...entry }))
			.toSorted((a, b) => b.count - a.count),
	};
}

/** Bot `GET /api/ia/status` → index of the bot process (served when RAG_BACKEND is local). */
export function parseBotIaStatus(json: unknown): BotRagData {
	if (!isRecord(json)) throw new Error("Réponse du bot invalide");
	if (json.ok !== true) throw new Error(toText(json.error) ?? "Le bot signale un état en erreur");
	const rag = json.rag;
	if (!isRecord(rag) || !isCount(rag.chunks) || !isCount(rag.vectors) || typeof rag.mode !== "string") {
		throw new Error("Statut RAG du bot invalide");
	}
	return {
		chunks: rag.chunks,
		vectors: rag.vectors,
		mode: rag.mode,
		builtAt: toText(rag.builtAt),
		gatewayReady: typeof json.gatewayReady === "boolean" ? json.gatewayReady : null,
	};
}

/** Aphrody Web `GET <prefix>/crawl/stats` (no jobId): persistent queue + in-memory jobs. */
export function parseCrawlStats(json: unknown): WebCrawlData {
	if (!isRecord(json) || json.success !== true) throw new Error("Aphrody Web n'a pas confirmé les statistiques de crawl");
	const stats = json.stats;
	if (
		!isRecord(stats) ||
		!isCount(stats.pending) ||
		!isCount(stats.locked) ||
		!isCount(stats.done) ||
		!isCount(stats.failed) ||
		!isCount(stats.total)
	) {
		throw new Error("Statistiques de file de crawl invalides");
	}
	const jobs = json.jobs === undefined ? [] : json.jobs;
	if (!Array.isArray(jobs)) throw new Error("Liste des travaux de crawl invalide");
	return {
		queue: {
			pending: stats.pending,
			locked: stats.locked,
			done: stats.done,
			failed: stats.failed,
			total: stats.total,
		},
		jobs: jobs.length,
		runningJobs: jobs.filter((job) => isRecord(job) && job.status === "running").length,
	};
}

/** Row of PostgreSQL `bot.rag_eval_history` (mirror of the bot SQLite table). */
export function mapEvalRow(row: Record<string, unknown>): EvalSnapshot {
	const createdAt = epochMsToIso(row.created_at, "created_at");
	if (!createdAt) throw new Error("Colonne created_at absente");
	return {
		id: toNumber(row.id, "id"),
		createdAt,
		casesCount: toNumber(row.cases_count, "cases_count"),
		recall1: toNumber(row.recall_1, "recall_1"),
		recall3: toNumber(row.recall_3, "recall_3"),
		recall5: toNumber(row.recall_5, "recall_5"),
		recall10: toNumber(row.recall_10, "recall_10"),
		mrr: toNumber(row.mrr, "mrr"),
		ndcg: toNumber(row.ndcg, "ndcg"),
		durationMs: toNumber(row.duration_ms, "duration_ms"),
		sidecarOnline: toNumber(row.sidecar_online ?? 0, "sidecar_online") !== 0,
		missesCount: toNumber(row.misses_count ?? 0, "misses_count"),
	};
}

export function mapFeedbackRow(row: Record<string, unknown>): FeedbackRow {
	return {
		id: toNumber(row.id, "id"),
		userTag: toText(row.user_tag),
		type: toText(row.type),
		query: toText(row.query) ?? "",
		status: toText(row.status) ?? "pending",
		expected: toText(row.expected),
		comment: toText(row.comment),
		createdAt: epochMsToIso(row.created_at, "created_at"),
	};
}

export function mapGoalRow(row: Record<string, unknown>): GoalRow {
	return {
		id: toNumber(row.id, "id"),
		title: toText(row.title) ?? "",
		description: toText(row.description),
		priority: toText(row.priority),
		status: toText(row.status) ?? "pending",
		createdAt: epochMsToIso(row.created_at, "created_at"),
	};
}

/** Discord REST message → display row (author, text or first embed title). */
export function mapDiscordMessage(raw: unknown): LabMessage {
	const message = isRecord(raw) ? raw : {};
	const author = isRecord(message.author) ? message.author : {};
	const embeds = Array.isArray(message.embeds) ? message.embeds : [];
	const firstEmbed = isRecord(embeds[0]) ? embeds[0] : null;
	const embedText = firstEmbed
		? [toText(firstEmbed.title), toText(firstEmbed.description)].filter(Boolean).join(" — ")
		: "";
	return {
		id: toText(message.id) ?? "",
		author: toText(author.global_name) ?? toText(author.username) ?? "inconnu",
		content: toText(message.content) ?? embedText,
		timestamp: toText(message.timestamp),
	};
}

// ── Gold set and retrieval metrics ───────────────────────────────────────────
// One definition shared with the bot and the pipeline: `@shenron/pipeline/ai/eval`
// (matchers, rank, binary-gain nDCG). A case prefers `expectUrl` (URL prefix
// with a path boundary), then `expectTitle`, and only falls back to legacy
// `expect` keywords when neither is present. The cockpit helpers keep their
// names and accept a nullable hit URL.

export type GoldCase = Pick<SharedGoldCase, "q" | "expect" | "expectUrl" | "expectTitle">;

;

const stringList = (value: unknown): string[] | undefined =>
	Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
		: undefined;

/** JSONL gold set; invalid lines and `//` comments are skipped. */
export function parseGoldSet(text: string): GoldCase[] {
	const cases: GoldCase[] = [];
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("//")) continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(trimmed);
		} catch {
			continue;
		}
		if (!isRecord(parsed) || typeof parsed.q !== "string" || !parsed.q.trim()) continue;
		const c: GoldCase = {
			q: parsed.q,
			expect: stringList(parsed.expect),
			expectUrl: stringList(parsed.expectUrl),
			expectTitle: stringList(parsed.expectTitle),
		};
		if (c.expectUrl?.length || c.expectTitle?.length || c.expect?.length) cases.push(c);
	}
	return cases;
}

export function goldCaseView(c: GoldCase): GoldCaseView {
	const expected = c.expectUrl?.length ? c.expectUrl : c.expectTitle?.length ? c.expectTitle : (c.expect ?? []);
	return { q: c.q, expected };
}

/** Comparable URL path: no origin, no trailing slash, lower case. */
const normalizeRagUrl: (url: string) => string = normalizeUrl;

export interface RetrievalHit {
	title: string;
	snippet: string;
	url?: string | null;
	score?: number;
}

function evalHit(hit: RetrievalHit): { title: string; snippet: string; url: string } {
	return { title: hit.title, snippet: hit.snippet, url: hit.url ?? "" };
}

function isGoldHit(hit: RetrievalHit, c: GoldCase): boolean {
	return isHit(evalHit(hit), c);
}

const EVAL_RANKS = RANKS;

interface RetrievalMiss {
	q: string;
	expected: string[];
	returnedTitle?: string;
}

export interface RetrievalMetrics {
	cases: number;
	recall: Record<(typeof EVAL_RANKS)[number], number>;
	mrr: number;
	ndcg: number;
	durationMs: number;
	misses: RetrievalMiss[];
}

/** Result of the cockpit's live evaluation action. */
export interface CockpitEvalResult extends RetrievalMetrics {
	/** Engine that was measured. */
	engine: string;
	/** True only when the bot confirmed the snapshot in `rag_eval_history`. */
	persisted: boolean;
}

/** Recall@k, MRR and binary-gain nDCG@10 over already retrieved hits. */
export function computeRetrievalMetrics(
	runs: Array<{ case: GoldCase; hits: RetrievalHit[] }>,
	durationMs: number
): RetrievalMetrics {
	const n = runs.length || 1;
	let reciprocal = 0;
	let ndcgSum = 0;
	const ranks: number[] = [];
	const misses: RetrievalMiss[] = [];
	for (const run of runs) {
		const hits = run.hits.map(evalHit);
		const rank = firstHitRank(hits, run.case);
		ranks.push(rank);
		if (rank > 0) reciprocal += 1 / rank;
		else misses.push({ q: run.case.q, expected: goldCaseView(run.case).expected, returnedTitle: run.hits[0]?.title });
		ndcgSum += ndcgAtK(hits, run.case, 10);
	}
	const round4 = (value: number) => Number(value.toFixed(4));
	const within = (k: number) => round4(ranks.filter((rank) => rank > 0 && rank <= k).length / n);
	return {
		cases: runs.length,
		recall: { 1: within(1), 3: within(3), 5: within(5), 10: within(10) },
		mrr: round4(reciprocal / n),
		ndcg: round4(ndcgSum / n),
		durationMs,
		misses,
	};
}

// ── Aphrody Web crawl statistics ─────────────────────────────────────────────

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

const LOOPBACK_HOSTS = ["127.0.0.1", "[::1]", "localhost"];

/**
 * Aggregate crawl statistics of Aphrody Web. `AphrodyWebClient` only exposes
 * per-job status, so this mirrors its URL rules (HTTPS or loopback HTTP, no
 * credentials, `/api/v1` on the private loopback API and `/api/v1/web` behind
 * the public route) and its bearer `APHRODY_BXC_API_TOKEN`.
 */
export async function fetchAphrodyWebCrawlStats(options: {
	baseUrl?: string;
	token?: string;
	fetcher?: FetchLike;
	timeoutMs?: number;
}): Promise<WebCrawlData> {
	const token = options.token?.trim();
	if (!token) throw new SourceNotConfiguredError("APHRODY_BXC_API_TOKEN absent de l'environnement du site");
	let base: URL;
	try {
		base = new URL(options.baseUrl?.trim() || "https://aphrody.com");
	} catch {
		throw new SourceNotConfiguredError("APHRODY_WEB_API_URL n'est pas une URL valide");
	}
	const loopback = LOOPBACK_HOSTS.includes(base.hostname);
	if ((base.protocol !== "https:" && !(base.protocol === "http:" && loopback)) || base.username || base.password) {
		throw new SourceNotConfiguredError("APHRODY_WEB_API_URL doit utiliser HTTPS ou HTTP loopback, sans identifiants");
	}
	const prefix = base.protocol === "http:" && loopback && base.port === "3007" ? "/api/v1" : "/api/v1/web";
	const url = new URL(`${prefix}/crawl/stats`, base);
	const response = await (options.fetcher ?? fetch)(url, {
		headers: { accept: "application/json", authorization: `Bearer ${token}` },
		cache: "no-store",
		signal: AbortSignal.timeout(options.timeoutMs ?? 5_000),
	});
	if (!response.ok) {
		const detail = (await response.text().catch(() => "")).trim().slice(0, 200);
		throw new Error(`Aphrody Web HTTP ${response.status} sur ${url.pathname}${detail ? ` : ${detail}` : ""}`);
	}
	return parseCrawlStats(await response.json());
}

// ── Aggregation ──────────────────────────────────────────────────────────────

export interface IaCockpitFetchers {
	aphrodyHealth: SourceSpec<AphrodyHealthData>;
	aphrodyRagStats: SourceSpec<AphrodyRagStatsData>;
	aphrodyRagProbe: SourceSpec<RagProbeData>;
	aphrodyWeb: SourceSpec<WebCrawlData>;
	botRag: SourceSpec<BotRagData>;
	evalHistory: SourceSpec<EvalSnapshot[]>;
	goldSet: SourceSpec<GoldSetData>;
	feedbacks: SourceSpec<FeedbackData>;
	goals: SourceSpec<GoalsData>;
	labMessages: SourceSpec<LabMessage[]>;
	agentKeys: SourceSpec<AgentKeySummary[]>;
}

type SpecData<S> = S extends SourceSpec<infer T> ? T : never;

type IaCockpitSources = {
	[K in keyof IaCockpitFetchers]: SourceReport<SpecData<IaCockpitFetchers[K]>>;
};

export type IaSourceKey = keyof IaCockpitSources;

interface IaCockpitSummary {
	/** `ok` only when every source answered. */
	status: "ok" | "degraded";
	failing: Array<{ key: IaSourceKey; label: string; status: SourceStatus; error: string }>;
	/** Engine answering search traffic according to RAG_BACKEND. */
	serving: {
		engine: string;
		/** Source whose status says whether that engine answers searches. */
		source: IaSourceKey;
		status: SourceStatus;
		error: string | null;
	};
	/** Counters of the serving engine; null when its statistics are unavailable. */
	documents: number | null;
	vectors: number | null;
	/** Retrieval mode reported by the serving engine (lexical, hybrid, …). */
	mode: string | null;
	countsSource: IaSourceKey;
	goldCases: number | null;
	latestEval: EvalSnapshot | null;
	pendingFeedbacks: number | null;
	activeGoals: number | null;
}

export interface IaCockpitReport {
	backend: RagBackendInfo;
	sources: IaCockpitSources;
	summary: IaCockpitSummary;
}

const SOURCE_KEYS: IaSourceKey[] = [
	"aphrodyHealth",
	"aphrodyRagStats",
	"aphrodyRagProbe",
	"aphrodyWeb",
	"botRag",
	"evalHistory",
	"goldSet",
	"feedbacks",
	"goals",
	"labMessages",
	"agentKeys",
];

function summarizeIaCockpit(backend: RagBackendInfo, sources: IaCockpitSources): IaCockpitSummary {
	const failing = SOURCE_KEYS.filter((key) => sources[key].status !== "ok").map((key) => ({
		key,
		label: sources[key].label,
		status: sources[key].status,
		error: sources[key].error ?? "Source indisponible",
	}));

	let serving: IaCockpitSummary["serving"];
	let documents: number | null;
	let vectors: number | null;
	let mode: string | null;
	let countsSource: IaSourceKey;
	if (backend.value === "aphrody") {
		const probe = sources.aphrodyRagProbe;
		const stats = sources.aphrodyRagStats.data;
		serving = { engine: backend.engine, source: "aphrodyRagProbe", status: probe.status, error: probe.error };
		documents = stats?.chunks ?? null;
		vectors = stats?.vectors ?? null;
		mode = probe.data?.mode ?? null;
		countsSource = "aphrodyRagStats";
	} else {
		const bot = sources.botRag;
		serving = { engine: backend.engine, source: "botRag", status: bot.status, error: bot.error };
		documents = bot.data?.chunks ?? null;
		vectors = bot.data?.vectors ?? null;
		mode = bot.data?.mode ?? null;
		countsSource = "botRag";
	}

	return {
		status: failing.length === 0 ? "ok" : "degraded",
		failing,
		serving,
		documents,
		vectors,
		mode,
		countsSource,
		goldCases: sources.goldSet.data?.cases ?? null,
		latestEval: sources.evalHistory.data?.[0] ?? null,
		pendingFeedbacks: sources.feedbacks.data?.pending ?? null,
		activeGoals: sources.goals.data?.active ?? null,
	};
}

/** Queries every source in parallel; one failure never blocks the others. */
export async function collectIaCockpit(
	fetchers: IaCockpitFetchers,
	backend: RagBackendInfo,
	clock?: () => number
): Promise<IaCockpitReport> {
	const reports = await Promise.all(SOURCE_KEYS.map((key) => probeSource(fetchers[key] as SourceSpec<unknown>, clock)));
	const sources = Object.fromEntries(SOURCE_KEYS.map((key, index) => [key, reports[index]])) as IaCockpitSources;
	return { backend, sources, summary: summarizeIaCockpit(backend, sources) };
}
