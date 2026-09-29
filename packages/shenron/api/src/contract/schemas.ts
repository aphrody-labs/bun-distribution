// SPDX-License-Identifier: Apache-2.0
/**
 * Response and request schemas of the Shenron HTTP contract (docs/STACK.md §3.6).
 *
 * Runtime class: `pure` — only `zod` and `@shenron/db/constants`. Every
 * response schema carries `.meta({ id })`, which the OpenAPI generator turns
 * into a named component. Shapes mirror the current bot handlers
 * (`apps/shenron/bot/src/api/server.ts`, `apps/shenron/bot/src/api/ia-cockpit.ts`).
 */
import {
	FEEDBACK_STATUSES,
	GOAL_PRIORITIES,
	WIKI_CATEGORIES,
	type WikiCategoryName as WikiCategoryNameValue,
} from "@shenron/db/constants";
import { z } from "zod";

// ── Health & stats ──────────────────────────────────────────────────────────

/** `GET /health`, `GET /api/health` → `{ "status": "ok" }`. */
export const HealthResponse = z.object({ status: z.literal("ok") }).meta({ id: "HealthResponse" });
export type HealthResponse = z.infer<typeof HealthResponse>;

/** `GET /api/public/stats` (server.ts `/api/public/stats`). */
export const PublicStats = z
	.object({
		users: z.number(),
		totalXp: z.number(),
		totalZeni: z.number(),
		achievementsUnlocked: z.number(),
		shopItems: z.number(),
		inventoryItems: z.number(),
	})
	.meta({ id: "PublicStats" });
export type PublicStats = z.infer<typeof PublicStats>;

// ── RAG ─────────────────────────────────────────────────────────────────────

export const RagMode = z.enum(["hybrid+rerank", "hybrid", "lexical"]).meta({ id: "RagMode" });
export type RagMode = z.infer<typeof RagMode>;

/** Query of `/api/public/rag/search` and `/api/public/rag/context`. */
export const RagSearchQuery = z
	.object({
		q: z.string().max(500),
		limit: z.number().int().min(1).max(25).optional(),
		maxChars: z.number().int().min(500).max(16_000).optional(),
		lang: z.string().max(8).optional(),
		entity: z.string().max(200).optional(),
		sourceId: z.string().max(200).optional(),
		kind: z.string().max(100).optional(),
		lexicalOnly: z.boolean().optional(),
	})
	.meta({ id: "RagSearchQuery" });
export type RagSearchQuery = z.infer<typeof RagSearchQuery>;

/** One hit (`RagHit` of `apps/shenron/bot/src/lib/rag.ts`). */
export const RagHit = z
	.object({
		rowid: z.number(),
		kind: z.string(),
		title: z.string(),
		url: z.string(),
		snippet: z.string(),
		score: z.number(),
		sourceId: z.string().optional(),
		lang: z.string().optional(),
		content: z.string().optional(),
	})
	.meta({ id: "RagHit" });
export type RagHit = z.infer<typeof RagHit>;

/** `{ q, results, mode }`, or `{ q, results: [], error: "index_unavailable" }`. */
export const RagSearchResponse = z
	.object({
		q: z.string(),
		results: z.array(RagHit),
		mode: RagMode.optional(),
		error: z.string().optional(),
	})
	.meta({ id: "RagSearchResponse" });
export type RagSearchResponse = z.infer<typeof RagSearchResponse>;

export const RagContextSource = z
	.object({
		n: z.number(),
		rowid: z.number(),
		title: z.string(),
		url: z.string(),
		kind: z.string(),
		sourceId: z.string().optional(),
		lang: z.string().optional(),
		score: z.number(),
	})
	.meta({ id: "RagContextSource" });
export type RagContextSource = z.infer<typeof RagContextSource>;

export const RagContextResponse = z
	.object({
		q: z.string(),
		mode: RagMode,
		context: z.string(),
		sources: z.array(RagContextSource),
		error: z.string().optional(),
	})
	.meta({ id: "RagContextResponse" });
export type RagContextResponse = z.infer<typeof RagContextResponse>;

// ── IA cockpit (admin writes, ia-cockpit.ts limits) ─────────────────────────

const trimmed = (max: number) => z.string().trim().min(1).max(max);

export const GoalPriority = z.enum(GOAL_PRIORITIES).meta({ id: "GoalPriority" });
export type GoalPriority = z.infer<typeof GoalPriority>;
export const FeedbackStatus = z.enum(FEEDBACK_STATUSES).meta({ id: "FeedbackStatus" });
export type FeedbackStatus = z.infer<typeof FeedbackStatus>;

/** `POST /api/admin/goals` — title ≤ 200, description ≤ 4000 (bot limits). */
export const CreateGoalBody = z
	.object({
		title: trimmed(200),
		description: trimmed(4000).optional(),
		userId: trimmed(64),
		userTag: z.string().trim().max(100).optional(),
		priority: GoalPriority.optional(),
		targetSession: z.string().trim().max(64).optional(),
	})
	.meta({ id: "CreateGoalBody" });
export type CreateGoalBody = z.infer<typeof CreateGoalBody>;

/** `POST /api/admin/goals/{id}/complete`. */
export const CompleteGoalBody = z
	.object({ notes: z.string().max(4000).nullable().optional() })
	.meta({ id: "CompleteGoalBody" });
export type CompleteGoalBody = z.infer<typeof CompleteGoalBody>;

/** `POST /api/training/feedback/{id}/status`. */
export const FeedbackStatusBody = z
	.object({ status: FeedbackStatus })
	.meta({ id: "FeedbackStatusBody" });
export type FeedbackStatusBody = z.infer<typeof FeedbackStatusBody>;

/** `POST /api/training/gold`. */
export const GoldCaseBody = z
	.object({
		q: trimmed(500),
		expect: z.array(trimmed(300)).min(1),
		userId: z.string().trim().max(64).optional(),
		userTag: z.string().trim().max(100).optional(),
	})
	.meta({ id: "GoldCaseBody" });
export type GoldCaseBody = z.infer<typeof GoldCaseBody>;

/** `POST /api/training/eval` — `samples` 0 (full set) … 1000. */
export const EvalRequestBody = z
	.object({ samples: z.number().int().min(0).max(1000).optional() })
	.meta({ id: "EvalRequestBody" });
export type EvalRequestBody = z.infer<typeof EvalRequestBody>;

export const CreateGoalResponse = z
	.object({ ok: z.literal(true), goal: z.record(z.string(), z.unknown()) })
	.meta({ id: "CreateGoalResponse" });
export const CompleteGoalResponse = z
	.object({ ok: z.literal(true), id: z.number() })
	.meta({ id: "CompleteGoalResponse" });
export const FeedbackStatusResponse = z
	.object({ ok: z.literal(true), id: z.number(), status: FeedbackStatus })
	.meta({ id: "FeedbackStatusResponse" });
export const GoldCaseResponse = z
	.object({ ok: z.literal(true), q: z.string(), expect: z.array(z.string()) })
	.meta({ id: "GoldCaseResponse" });
export const EvalResponse = z
	.object({
		ok: z.literal(true),
		metrics: z.looseObject({ cases: z.number() }),
		persisted: z.boolean(),
		persistError: z.string().nullable(),
	})
	.meta({ id: "EvalResponse" });

// ── Pagination ──────────────────────────────────────────────────────────────

/** `{ rows, total, limit, offset }` page of the bot's table endpoints. */
export function TablePage<T extends z.ZodType>(row: T) {
	return z.object({
		rows: z.array(row),
		total: z.number(),
		limit: z.number(),
		offset: z.number(),
	});
}

/** Page query of `GET /api/database/{table}` (the bot caps `limit` at 500). */
export const TablePageQuery = z
	.object({
		limit: z.number().int().min(1).max(500).optional(),
		offset: z.number().int().min(0).optional(),
	})
	.meta({ id: "TablePageQuery" });
export type TablePageQuery = z.infer<typeof TablePageQuery>;

// ── Wiki (PostgreSQL, B14) ──────────────────────────────────────────────────

const categoryNames = WIKI_CATEGORIES.map((c) => c.name) as [
	WikiCategoryNameValue,
	...WikiCategoryNameValue[],
];

export const WikiCategoryName = z.enum(categoryNames).meta({ id: "WikiCategoryName" });
export type WikiCategoryName = z.infer<typeof WikiCategoryName>;

export const WikiCategorySummary = z
	.object({ name: WikiCategoryName, label: z.string(), total: z.number().int().min(0) })
	.meta({ id: "WikiCategorySummary" });
export type WikiCategorySummary = z.infer<typeof WikiCategorySummary>;

export const WikiCategoriesResponse = z
	.object({ categories: z.array(WikiCategorySummary) })
	.meta({ id: "WikiCategoriesResponse" });
export type WikiCategoriesResponse = z.infer<typeof WikiCategoriesResponse>;

export const WIKI_LIST_DEFAULT_LIMIT = 50;
export const WIKI_LIST_MAX_LIMIT = 200;

/** Query of `/api/public/wiki/{category}` (query-string values are coerced). */
export const WikiListQuery = z
	.object({
		limit: z.coerce.number().int().min(1).max(WIKI_LIST_MAX_LIMIT).default(WIKI_LIST_DEFAULT_LIMIT),
		offset: z.coerce.number().int().min(0).default(0),
		q: z.string().max(200).optional(),
	})
	.meta({ id: "WikiListQuery" });
export type WikiListQuery = z.infer<typeof WikiListQuery>;
export type WikiListQueryInput = { limit?: number; offset?: number; q?: string };

/** Public row of a wiki table (omitted columns are never selected). */
export const WikiEntity = z.record(z.string(), z.unknown()).meta({ id: "WikiEntity" });
export type WikiEntity = z.infer<typeof WikiEntity>;

export const WikiListResponse = z
	.object({
		category: WikiCategoryName,
		items: z.array(WikiEntity),
		total: z.number().int().min(0),
		limit: z.number().int(),
		offset: z.number().int(),
	})
	.meta({ id: "WikiListResponse" });
export type WikiListResponse = z.infer<typeof WikiListResponse>;

// ── Bot admin reads ─────────────────────────────────────────────────────────

/** `GET /api/stats/totals`. */
export const BotAdminStats = z
	.object({
		stats: z.looseObject({
			totalUsers: z.number(),
			totalGuilds: z.number(),
			totalActiveUsers: z.number(),
			totalCommands: z.number(),
		}),
	})
	.meta({ id: "BotAdminStats" });
export type BotAdminStats = z.infer<typeof BotAdminStats>;

/** `GET /api/services`. */
export const BotServices = z
	.object({
		actions: z.array(
			z.object({ service: z.string(), action: z.string(), description: z.string() })
		),
	})
	.meta({ id: "BotServices" });
export type BotServices = z.infer<typeof BotServices>;

/** `GET /api/database/tables`. */
export const BotTables = z
	.object({
		tables: z.array(
			z.object({
				name: z.string(),
				pk: z.string(),
				readonly: z.boolean(),
				mutableColumns: z.array(z.string()),
				description: z.string().nullable(),
			})
		),
	})
	.meta({ id: "BotTables" });
export type BotTables = z.infer<typeof BotTables>;

/** `GET /api/database/{table}`. */
export const BotTableRows = TablePage(z.record(z.string(), z.unknown())).meta({
	id: "BotTableRows",
});
export type BotTableRows = z.infer<typeof BotTableRows>;

/** `GET /api/wiki/stats`. */
export const BotWikiStats = z
	.object({ counts: z.record(z.string(), z.number()), isSeeded: z.boolean() })
	.meta({ id: "BotWikiStats" });
export type BotWikiStats = z.infer<typeof BotWikiStats>;

/** `GET /api/economy/stats`. */
export const BotEconomyStats = z
	.object({
		zeni: z.object({
			total: z.number(),
			avg: z.number(),
			max: z.number(),
			users: z.number(),
			rich: z.number(),
			zero: z.number(),
		}),
		fusions: z.number(),
		inventoryItems: z.number(),
		shopItemsActive: z.number(),
	})
	.meta({ id: "BotEconomyStats" });
export type BotEconomyStats = z.infer<typeof BotEconomyStats>;
