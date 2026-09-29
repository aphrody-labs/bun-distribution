// SPDX-License-Identifier: Apache-2.0
/**
 * Endpoint catalogue of the Shenron HTTP contract. Paths are complete
 * (`/api/public/wiki/{category}`): no nested `basePath`, which
 * `@hono/zod-openapi` mis-reports in the generated document
 * (honojs/middleware#952). Runtime class: `pure`.
 */
import { z } from "zod";
import {
	BotAdminStats,
	BotEconomyStats,
	BotServices,
	BotTableRows,
	BotTables,
	BotWikiStats,
	CompleteGoalBody,
	CompleteGoalResponse,
	CreateGoalBody,
	CreateGoalResponse,
	EvalRequestBody,
	EvalResponse,
	FeedbackStatusBody,
	FeedbackStatusResponse,
	GoldCaseBody,
	GoldCaseResponse,
	HealthResponse,
	PublicStats,
	RagContextResponse,
	RagSearchQuery,
	RagSearchResponse,
	TablePageQuery,
	WikiCategoriesResponse,
	WikiCategoryName,
	WikiEntity,
	WikiListQuery,
	WikiListResponse,
} from "./schemas";

export type EndpointAuth = "public" | "admin" | "acting-user";
export type EndpointCache = { maxAgeSeconds: number } | "no-store";

export interface EndpointSpec {
	id: string;
	method: "get" | "post";
	path: `/${string}`;
	auth: EndpointAuth;
	params?: z.ZodType;
	query?: z.ZodType;
	body?: z.ZodType;
	response: z.ZodType;
	cache?: EndpointCache;
	/** Response is a page (`rows`/`items` + `total`/`limit`/`offset`), read leniently by the client. */
	paginated?: boolean;
}

/** `{category}` path parameter. */
export const WikiCategoryParams = z.object({ category: WikiCategoryName });
/** `{category}/{idOrSlug}` path parameters. */
export const WikiEntityParams = z.object({
	category: WikiCategoryName,
	idOrSlug: z.string().min(1).max(200),
});
/** Numeric `{id}` path parameter of the cockpit routes. */
export const NumericIdParams = z.object({ id: z.number().int().positive() });
/** `{table}` path parameter of the bot table explorer. */
export const TableParams = z.object({ table: z.string().min(1).max(100) });

const WIKI_CACHE = { maxAgeSeconds: 3600 } as const;

export const endpoints = {
	health: {
		id: "health",
		method: "get",
		path: "/health",
		auth: "public",
		response: HealthResponse,
		cache: { maxAgeSeconds: 5 },
	},
	apiHealth: {
		id: "apiHealth",
		method: "get",
		path: "/api/health",
		auth: "public",
		response: HealthResponse,
		cache: "no-store",
	},
	publicStats: {
		id: "publicStats",
		method: "get",
		path: "/api/public/stats",
		auth: "public",
		response: PublicStats,
		cache: { maxAgeSeconds: 15 },
	},
	ragSearch: {
		id: "ragSearch",
		method: "get",
		path: "/api/public/rag/search",
		auth: "public",
		query: RagSearchQuery,
		response: RagSearchResponse,
		cache: { maxAgeSeconds: 300 },
	},
	ragContext: {
		id: "ragContext",
		method: "get",
		path: "/api/public/rag/context",
		auth: "public",
		query: RagSearchQuery,
		response: RagContextResponse,
		cache: { maxAgeSeconds: 300 },
	},
	wikiCategories: {
		id: "wikiCategories",
		method: "get",
		path: "/api/public/wiki/categories",
		auth: "public",
		response: WikiCategoriesResponse,
		cache: WIKI_CACHE,
	},
	wikiList: {
		id: "wikiList",
		method: "get",
		path: "/api/public/wiki/{category}",
		auth: "public",
		params: WikiCategoryParams,
		query: WikiListQuery,
		response: WikiListResponse,
		cache: WIKI_CACHE,
		paginated: true,
	},
	wikiEntity: {
		id: "wikiEntity",
		method: "get",
		path: "/api/public/wiki/{category}/{idOrSlug}",
		auth: "public",
		params: WikiEntityParams,
		response: WikiEntity,
		cache: WIKI_CACHE,
	},
	createGoal: {
		id: "createGoal",
		method: "post",
		path: "/api/admin/goals",
		auth: "admin",
		body: CreateGoalBody,
		response: CreateGoalResponse,
		cache: "no-store",
	},
	completeGoal: {
		id: "completeGoal",
		method: "post",
		path: "/api/admin/goals/{id}/complete",
		auth: "admin",
		params: NumericIdParams,
		body: CompleteGoalBody,
		response: CompleteGoalResponse,
		cache: "no-store",
	},
	feedbackStatus: {
		id: "feedbackStatus",
		method: "post",
		path: "/api/training/feedback/{id}/status",
		auth: "admin",
		params: NumericIdParams,
		body: FeedbackStatusBody,
		response: FeedbackStatusResponse,
		cache: "no-store",
	},
	goldCase: {
		id: "goldCase",
		method: "post",
		path: "/api/training/gold",
		auth: "admin",
		body: GoldCaseBody,
		response: GoldCaseResponse,
		cache: "no-store",
	},
	runEval: {
		id: "runEval",
		method: "post",
		path: "/api/training/eval",
		auth: "admin",
		body: EvalRequestBody,
		response: EvalResponse,
		cache: "no-store",
	},
	adminStats: {
		id: "adminStats",
		method: "get",
		path: "/api/stats/totals",
		auth: "admin",
		response: BotAdminStats,
		cache: "no-store",
	},
	adminServices: {
		id: "adminServices",
		method: "get",
		path: "/api/services",
		auth: "admin",
		response: BotServices,
		cache: "no-store",
	},
	adminTables: {
		id: "adminTables",
		method: "get",
		path: "/api/database/tables",
		auth: "admin",
		response: BotTables,
		cache: "no-store",
	},
	adminTableRows: {
		id: "adminTableRows",
		method: "get",
		path: "/api/database/{table}",
		auth: "admin",
		params: TableParams,
		query: TablePageQuery,
		response: BotTableRows,
		cache: "no-store",
		paginated: true,
	},
	adminWikiStats: {
		id: "adminWikiStats",
		method: "get",
		path: "/api/wiki/stats",
		auth: "admin",
		response: BotWikiStats,
		cache: "no-store",
	},
	adminEconomyStats: {
		id: "adminEconomyStats",
		method: "get",
		path: "/api/economy/stats",
		auth: "admin",
		response: BotEconomyStats,
		cache: "no-store",
	},
} as const satisfies Record<string, EndpointSpec>;

export type Endpoints = typeof endpoints;

export const ENDPOINTS: readonly EndpointSpec[] = Object.values(endpoints);

/**
 * Public routes served by the historical bot code (`apps/shenron/bot/src/api/server.ts`).
 * They keep priority over the Hono application (docs/STACK.md D7).
 */
export const LEGACY_PUBLIC_PATHS: readonly string[] = [
	"/health",
	"/health/check",
	"/health/latency",
	"/api/health",
	"/api/openapi.json",
	"/api/public/assets",
	"/api/public/commands",
	"/api/public/data/coverage",
	"/api/public/economy/inflation",
	"/api/public/eval/cache-stats",
	"/api/public/eval/lore-stats",
	"/api/public/eval/reports",
	"/api/public/leaderboard",
	"/api/public/manga/couleur/{salonId}/{pieceJointeId}/{fichier}",
	"/api/public/manga/page/{series}/{tome}/{planche}",
	"/api/public/manga/search",
	"/api/public/manga/tomes",
	"/api/public/manga/tomes/{series}/{tome}",
	"/api/public/news",
	"/api/public/personas",
	"/api/public/presence",
	"/api/public/profile/{discordId}/card.png",
	"/api/public/profile/{discordId}/scan.png",
	"/api/public/rag/chat",
	"/api/public/rag/context",
	"/api/public/rag/search",
	"/api/public/shop",
	"/api/public/sources",
	"/api/public/stats",
	"/api/public/user/{discordId}",
	"/api/public/wiki/arcs/{slug}",
	"/api/public/wiki/characters",
	"/api/public/wiki/characters/{id}",
	"/api/public/wiki/episodes",
	"/api/public/wiki/episodes/{id}",
	"/api/public/wiki/games",
	"/api/public/wiki/games/{slug}",
	"/api/public/wiki/manga/volumes",
	"/api/public/wiki/manga/volumes/{id}",
	"/api/public/wiki/movies",
	"/api/public/wiki/movies/{slug}",
	"/api/public/wiki/news",
	"/api/public/wiki/planets",
	"/api/public/wiki/planets/{id}",
	"/api/public/wiki/races",
	"/api/public/wiki/races/{slug}",
	"/api/public/wiki/sagas",
	"/api/public/wiki/sagas/{slug}",
	"/api/public/wiki/search",
	"/api/public/wiki/techniques",
	"/api/public/wiki/techniques/{slug}",
	"/api/public/wiki/tools",
	"/api/public/wiki/tools/{slug}",
	"/api/public/wiki/transformations",
];

type ParamsOf<E> = E extends { params: infer P extends z.ZodType }
	? { params: z.input<P> }
	: { params?: undefined };
type QueryOf<E> = E extends { query: infer Q extends z.ZodType }
	? { query?: z.input<Q> }
	: { query?: undefined };
type BodyOf<E> = E extends { body: infer B extends z.ZodType }
	? { body: z.input<B> }
	: { body?: undefined };

/** Input of a call: path parameters, query, JSON body and the acting user (when signed). */
export type EndpointInput<E extends EndpointSpec> = ParamsOf<E> &
	QueryOf<E> &
	BodyOf<E> & { actingUserId?: string };

export type EndpointOutput<E extends EndpointSpec> = z.output<E["response"]>;

/** Replaces `{name}` segments with URI-encoded values. */
export function fillPath(path: string, params: Record<string, unknown> | undefined): string {
	return path.replace(/\{(\w+)\}/g, (_, name: string) => {
		const value = params?.[name];
		if (value === undefined || value === null || value === "") {
			throw new Error(`missing path parameter "${name}" for ${path}`);
		}
		return encodeURIComponent(String(value));
	});
}
