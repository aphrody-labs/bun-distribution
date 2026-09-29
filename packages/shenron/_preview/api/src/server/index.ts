// SPDX-License-Identifier: Apache-2.0
/**
 * `@shenron/api/server` — OpenAPIHono application with injected ports,
 * mounted inside the existing processes (bot `Bun.serve` fallback, site
 * catch-all `app/api/public/[...route]`), never as a separate unit
 * (docs/STACK.md D7). Runtime class: `hono`.
 *
 * Phase 1 serves only NEW routes (B14): wiki categories and entities read from
 * PostgreSQL, and the generated OpenAPI document. Historical routes keep
 * priority in their hosts.
 *
 * Middleware order: client IP → CORS → rate limit (direct loopback exempt) →
 * public cache (1 h) → zod validation → handler.
 */
import { createRoute, OpenAPIHono, type RouteConfig } from "@hono/zod-openapi";
import { isWikiCategoryName, type WikiCategoryName } from "@shenron/db/constants";
import { z } from "zod";
import { ErrorEnvelope } from "../contract/error";
import {
	WikiCategoriesResponse,
	WikiEntity,
	WikiListQuery,
	WikiListResponse,
} from "../contract/schemas";
import {
	corsHeaders,
	PUBLIC_RATE_LIMIT,
	publicCacheHeaders,
	publicCacheKey,
	type InvalidationPort,
	type PublicCachePort,
	type RateLimitPort,
} from "../http";

/** Read port of the public wiki, implemented by `createWikiReadRepository` (`@shenron/db/repos/wiki`). */
export interface WikiReadPort {
	categories(): Promise<{ name: string; label: string; total: number }[]>;
	list(i: {
		category: WikiCategoryName;
		limit: number;
		offset: number;
		q?: string;
	}): Promise<{ items: Record<string, unknown>[]; total: number }>;
	get(i: { category: WikiCategoryName; idOrSlug: string }): Promise<Record<string, unknown> | null>;
}

export interface ShenronApiLogEvent {
	event: string;
	path: string;
	status?: number;
	ms?: number;
}

export interface ShenronApiPorts {
	/** Absent → wiki group disabled → `handles()` false → historical 404. */
	wiki?: WikiReadPort | null;
	rateLimit: RateLimitPort;
	publicCache: PublicCachePort;
	invalidation: InvalidationPort;
	cors: { allowedOrigins: readonly string[] };
	clientIp(request: Request): string;
	isDirectLoopback(request: Request): boolean;
	/** Never receives headers or bodies. */
	log?(event: ShenronApiLogEvent): void;
}

export type ShenronApiService = "shenron-bot" | "shenron-site";

type AppEnv = { Variables: { clientIp: string } };

export interface ShenronApi {
	readonly app: OpenAPIHono<AppEnv>;
	fetch(request: Request): Promise<Response>;
	handles(pathname: string): boolean;
	openApiDocument(): Record<string, unknown>;
}

export const OPENAPI_PATH = "/api/public/openapi.json";
export const WIKI_CACHE_SECONDS = 3600;
const ALLOWED_METHODS = ["GET", "HEAD", "OPTIONS"] as const;
const NOT_FOUND = { error: "Not found" } as const;

/** Raised by a data port wrapper: the store is unreachable. */
class DataUnavailable extends Error {}

async function fromPort<T>(run: () => Promise<T>): Promise<T> {
	try {
		return await run();
	} catch (error) {
		throw new DataUnavailable(error instanceof Error ? error.message : String(error));
	}
}

const errorContent = { "application/json": { schema: ErrorEnvelope } };
const errorResponses = {
	400: { description: "Invalid request", content: errorContent },
	404: { description: "Not found", content: errorContent },
	429: { description: "Rate limited", content: errorContent },
	500: { description: "Internal error", content: errorContent },
	503: { description: "PostgreSQL unavailable", content: errorContent },
} as const;

const OpenApiDocument = z.looseObject({ openapi: z.string() }).meta({ id: "OpenApiDocument" });

const CategoryParam = z.object({
	category: z
		.string()
		.min(1)
		.max(64)
		.meta({ param: { name: "category", in: "path" }, description: "Wiki category name" }),
});
const EntityParams = z.object({
	category: z
		.string()
		.min(1)
		.max(64)
		.meta({ param: { name: "category", in: "path" }, description: "Wiki category name" }),
	idOrSlug: z
		.string()
		.min(1)
		.max(200)
		.meta({ param: { name: "idOrSlug", in: "path" }, description: "Numeric id or slug" }),
});
/** Same fields as the contract's `WikiListQuery`, without its component id (query parameters are inlined). */
const ListQuery = z.object(WikiListQuery.shape);

export const routes = {
	openapi: createRoute({
		method: "get",
		path: OPENAPI_PATH,
		operationId: "openApiDocument",
		tags: ["Meta"],
		summary: "OpenAPI 3.1 document of the Shenron public API",
		responses: {
			200: {
				description: "OpenAPI document",
				content: { "application/json": { schema: OpenApiDocument } },
			},
			...errorResponses,
		},
	}),
	wikiCategories: createRoute({
		method: "get",
		path: "/api/public/wiki/categories",
		operationId: "wikiCategories",
		tags: ["Wiki"],
		summary: "Public wiki categories with their visible totals",
		responses: {
			200: {
				description: "Categories",
				content: { "application/json": { schema: WikiCategoriesResponse } },
			},
			...errorResponses,
		},
	}),
	wikiList: createRoute({
		method: "get",
		path: "/api/public/wiki/{category}",
		operationId: "wikiList",
		tags: ["Wiki"],
		summary: "Visible entries of a wiki category",
		request: { params: CategoryParam, query: ListQuery },
		responses: {
			200: {
				description: "Page of entries",
				content: { "application/json": { schema: WikiListResponse } },
			},
			...errorResponses,
		},
	}),
	wikiEntity: createRoute({
		method: "get",
		path: "/api/public/wiki/{category}/{idOrSlug}",
		operationId: "wikiEntity",
		tags: ["Wiki"],
		summary: "One visible wiki entry by numeric id or slug",
		request: { params: EntityParams },
		responses: {
			200: { description: "Entry", content: { "application/json": { schema: WikiEntity } } },
			...errorResponses,
		},
	}),
} satisfies Record<string, RouteConfig>;

const DOCUMENT_CONFIG = {
	openapi: "3.1.0",
	info: {
		title: "Shenron public API",
		version: "1.0.0",
		description:
			"Routes served by @shenron/api inside shenron-bot and shenron-site (docs/STACK.md §3.6).",
	},
} as const;

/** OpenAPI 3.1 document of every route, independent of the enabled groups. */
export function buildOpenApiDocument(): Record<string, unknown> {
	const doc = new OpenAPIHono();
	for (const route of Object.values(routes)) doc.openAPIRegistry.registerPath(route);
	return doc.getOpenAPI31Document(DOCUMENT_CONFIG) as unknown as Record<string, unknown>;
}

const WIKI_PATTERNS: readonly RegExp[] = [
	/^\/api\/public\/openapi\.json$/,
	/^\/api\/public\/wiki\/categories$/,
	/^\/api\/public\/wiki\/[^/]+$/,
	/^\/api\/public\/wiki\/[^/]+\/[^/]+$/,
];

/** Legacy 404 body. Error statuses are documented through `errorResponses`; the cast keeps the typed handler signature. */
function notFound(c: { json(body: unknown, status: 404): Response }): never {
	return c.json(NOT_FOUND, 404) as never;
}

function jsonResponse(body: unknown, status: number, headers: Record<string, string>): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
	});
}

export function createShenronApi(
	ports: ShenronApiPorts,
	o: { service: ShenronApiService }
): ShenronApi {
	const wiki = ports.wiki ?? null;
	const enabled = wiki !== null;
	let cachedDocument: Record<string, unknown> | null = null;
	const openApiDocument = () => {
		cachedDocument ??= buildOpenApiDocument();
		return cachedDocument;
	};

	const handles = (pathname: string): boolean =>
		enabled && WIKI_PATTERNS.some((pattern) => pattern.test(pathname));

	const app = new OpenAPIHono<AppEnv>({
		defaultHook: (result, c) => {
			if (!result.success) {
				const message = result.error.issues
					.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
					.join("; ");
				return c.json({ error: "Invalid request", code: "invalid_request" as const, message }, 400);
			}
			return undefined;
		},
	});

	const log = (event: ShenronApiLogEvent) => {
		try {
			ports.log?.(event);
		} catch {
			// a failing logger never breaks a response
		}
	};

	// 1-3: client IP → CORS → method/path gate → rate limit.
	app.use("*", async (c, next) => {
		const started = performance.now();
		const path = new URL(c.req.url).pathname;
		c.set("clientIp", ports.clientIp(c.req.raw));
		const cors = corsHeaders(c.req.header("origin") ?? null, ports.cors.allowedOrigins, [
			...ALLOWED_METHODS,
		]);
		const method = c.req.method.toUpperCase();
		let early: Response | null = null;
		if (!handles(path) || !(ALLOWED_METHODS as readonly string[]).includes(method)) {
			early = jsonResponse(NOT_FOUND, 404, cors);
		} else if (method === "OPTIONS") {
			early = new Response(null, { status: 204, headers: cors });
		} else if (!ports.isDirectLoopback(c.req.raw)) {
			const verdict = await ports.rateLimit.hit(`public:${c.get("clientIp")}`, PUBLIC_RATE_LIMIT);
			if (!verdict.allowed) {
				early = jsonResponse({ error: "Rate limit (60/min)", code: "rate_limited" }, 429, {
					...cors,
					"Retry-After": String(verdict.retryAfterSeconds),
				});
			}
		}
		if (early) {
			log({
				event: `${o.service}.api`,
				path,
				status: early.status,
				ms: performance.now() - started,
			});
			return early;
		}
		await next();
		const res = c.res;
		const headers = new Headers(res.headers);
		for (const [k, v] of Object.entries(cors)) headers.set(k, v);
		c.res = undefined;
		c.res = new Response(res.body, { status: res.status, headers });
		log({ event: `${o.service}.api`, path, status: res.status, ms: performance.now() - started });
	});

	// 4: public cache (memory LRU + ETag + Cache-Control), 200 responses only.
	app.use("*", async (c, next) => {
		const url = new URL(c.req.url);
		const key = publicCacheKey(url);
		const ifNoneMatch = c.req.header("if-none-match") ?? null;
		const serve = (body: string, etag: string): Response => {
			const headers = {
				"Content-Type": "application/json; charset=utf-8",
				...publicCacheHeaders(WIKI_CACHE_SECONDS),
				ETag: etag,
			};
			if (ifNoneMatch && ifNoneMatch === etag) return new Response(null, { status: 304, headers });
			return new Response(body, { status: 200, headers });
		};
		const hit = ports.publicCache.get(key);
		if (hit) return serve(hit.body, hit.etag);
		await next();
		if (c.res.status !== 200) return;
		const body = await c.res.text();
		const { etag } = ports.publicCache.set(key, body, WIKI_CACHE_SECONDS * 1000);
		c.res = undefined;
		c.res = serve(body, etag);
	});

	app.onError((error, c) => {
		if (error instanceof DataUnavailable) {
			return c.json({ error: "Data store unavailable", code: "pg_unavailable" as const }, 503);
		}
		return c.json({ error: "internal", code: "internal" as const }, 500);
	});
	app.notFound((c) => c.json(NOT_FOUND, 404));

	// 5: routes (zod validation through the route definitions).
	app.openapi(routes.openapi, (c) => c.json(openApiDocument() as { openapi: string }, 200));

	if (wiki) {
		// `/categories` is registered before `/{category}` so it is never read as a category.
		app.openapi(routes.wikiCategories, async (c) => {
			const rows = await fromPort(() => wiki.categories());
			const categories = rows.filter((row): row is typeof row & { name: WikiCategoryName } =>
				isWikiCategoryName(row.name)
			);
			return c.json({ categories }, 200);
		});

		app.openapi(routes.wikiList, async (c) => {
			const { category } = c.req.valid("param");
			const query = c.req.valid("query");
			if (!isWikiCategoryName(category)) return notFound(c);
			const q = query.q?.trim() || undefined;
			const page = await fromPort(() =>
				wiki.list({ category, limit: query.limit, offset: query.offset, ...(q ? { q } : {}) })
			);
			return c.json(
				{
					category,
					items: page.items,
					total: page.total,
					limit: query.limit,
					offset: query.offset,
				},
				200
			);
		});

		app.openapi(routes.wikiEntity, async (c) => {
			const { category, idOrSlug } = c.req.valid("param");
			if (!isWikiCategoryName(category)) return notFound(c);
			const row = await fromPort(() => wiki.get({ category, idOrSlug }));
			if (!row) return notFound(c);
			return c.json(row, 200);
		});
	}

	return {
		app,
		fetch: async (request) => app.fetch(request),
		handles,
		openApiDocument,
	};
}
