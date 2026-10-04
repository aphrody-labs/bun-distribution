// SPDX-License-Identifier: Apache-2.0
/**
 * `@shenron/api/client` — typed client of the Shenron HTTP contract that never
 * throws: every call resolves to an {@link ApiResult}. Runtime class: `pure`
 * (no hono, no node:, no bun:; the acting-user signer is injected).
 *
 * `fetch` is resolved at each call (`options.fetch ?? globalThis.fetch`), so a
 * test or an instrumentation layer that replaces `globalThis.fetch` after the
 * client was created is honoured.
 */
import type { z } from "zod";
import { JsonTransportError, requestJson } from "@aphrody/http";
import {
  endpoints,
  fillPath,
  type EndpointInput,
  type EndpointOutput,
  type EndpointSpec,
} from "../contract/endpoints";
import { ErrorEnvelope } from "../contract/error";
import type {
  CompleteGoalBody,
  CreateGoalBody,
  EvalRequestBody,
  FeedbackStatusBody,
  GoldCaseBody,
  RagSearchQuery,
  TablePageQuery,
  WikiCategoryName,
  WikiListQueryInput,
} from "../contract/schemas";

export type ApiFailure =
  | { ok: false; kind: "unreachable" | "timeout"; path: string; detail: string }
  | {
      ok: false;
      kind: "http";
      path: string;
      status: number;
      detail: string;
      error?: z.infer<typeof ErrorEnvelope>;
    }
  | {
      ok: false;
      kind: "invalid_json" | "invalid_response";
      path: string;
      detail: string;
      issues?: readonly string[];
    };

export type ApiResult<T> = { ok: true; value: T; status: number; etag?: string } | ApiFailure;

export interface ShenronApiClientOptions {
  baseUrl: string | URL;
  fetch?: typeof fetch;
  /** Per-call timeout (default 10 s). */
  timeoutMs?: number;
  /** Server-side callers only; the token is sent to `admin` endpoints when it returns a value. */
  adminToken?: () => string | null;
  /** Injected signer (for instance `@shenron/auth` `signActingUser`): keeps this module pure. */
  signActingUser?: (discordId: string) => Record<string, string>;
  userAgent?: string;
}

export const DEFAULT_TIMEOUT_MS = 10_000;

function joinUrl(baseUrl: string | URL, path: string): URL {
  const base = new URL(String(baseUrl));
  const prefix = base.pathname.replace(/\/+$/, "");
  return new URL(`${prefix}${path}`, base.origin);
}

function appendQuery(url: URL, query: unknown): void {
  if (!query || typeof query !== "object") return;
  for (const [key, value] of Object.entries(query as Record<string, unknown>)) {
    if (value === undefined || value === null) continue;
    url.searchParams.set(key, String(value));
  }
}

function errorText(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

function isTimeout(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    ((error as { name: unknown }).name === "TimeoutError" ||
      (error as { name: unknown }).name === "AbortError")
  );
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

/**
 * Lenient page metadata: numeric strings are coerced, a missing `total` falls
 * back to the number of rows, a missing `limit`/`offset` to the request query.
 */
function normalisePage(value: unknown, query: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const page = { ...(value as Record<string, unknown>) };
  const list = Array.isArray(page.items) ? page.items : Array.isArray(page.rows) ? page.rows : null;
  if (!list) return value;
  const q = (query && typeof query === "object" ? query : {}) as Record<string, unknown>;
  page.total = toNumber(page.total) ?? list.length;
  page.limit = toNumber(page.limit) ?? toNumber(q.limit) ?? list.length;
  page.offset = toNumber(page.offset) ?? toNumber(q.offset) ?? 0;
  return page;
}

function issuesOf(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
}

export function createShenronApiClient(o: ShenronApiClientOptions) {
  const timeoutMs = o.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function call<E extends EndpointSpec>(
    endpoint: E,
    input: EndpointInput<E>,
  ): Promise<ApiResult<EndpointOutput<E>>> {
    const loose = input as {
      params?: Record<string, unknown>;
      query?: unknown;
      body?: unknown;
      actingUserId?: string;
    };
    let path: string;
    try {
      path = fillPath(endpoint.path, loose.params);
    } catch (error) {
      return { ok: false, kind: "unreachable", path: endpoint.path, detail: errorText(error) };
    }
    const url = joinUrl(o.baseUrl, path);
    appendQuery(url, loose.query);
    const headers = new Headers({ Accept: "application/json" });
    if (o.userAgent) headers.set("User-Agent", o.userAgent);
    if (endpoint.auth === "admin" && o.adminToken) {
      const token = o.adminToken();
      if (token) headers.set("Authorization", `Bearer ${token}`);
    }
    if (loose.actingUserId && o.signActingUser) {
      for (const [k, v] of Object.entries(o.signActingUser(loose.actingUserId))) headers.set(k, v);
    }
    let body: string | undefined;
    if (endpoint.method === "post") {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(loose.body ?? {});
    }

    let response: Response;
    let json: unknown;
    try {
      const result = await requestJson(
        url,
        {
          method: endpoint.method.toUpperCase(),
          headers,
          body,
        },
        { fetch: o.fetch, timeoutMs, readErrorBody: true },
      );
      response = result.response;
      json = result.value;
    } catch (failure) {
      const error = failure instanceof JsonTransportError ? failure.cause : failure;
      return {
        ok: false,
        kind:
          failure instanceof JsonTransportError && failure.stage === "json"
            ? "invalid_json"
            : isTimeout(error) || (failure instanceof JsonTransportError && failure.timedOut)
              ? "timeout"
              : "unreachable",
        path,
        detail: errorText(error),
      };
    }
    if (!response.ok) {
      const parsed = ErrorEnvelope.safeParse(json);
      const error = parsed.success ? parsed.data : undefined;
      return {
        ok: false,
        kind: "http",
        path,
        status: response.status,
        detail: error?.error ?? `HTTP ${response.status}`,
        ...(error ? { error } : {}),
      };
    }
    const candidate = endpoint.paginated ? normalisePage(json, loose.query) : json;
    const parsed = endpoint.response.safeParse(candidate);
    if (!parsed.success) {
      const issues = issuesOf(parsed.error);
      return {
        ok: false,
        kind: "invalid_response",
        path,
        detail: issues[0] ?? "invalid response",
        issues,
      };
    }
    const etag = response.headers.get("etag");
    return {
      ok: true,
      value: parsed.data as EndpointOutput<E>,
      status: response.status,
      ...(etag ? { etag } : {}),
    };
  }

  return {
    call,
    wiki: {
      categories: () => call(endpoints.wikiCategories, {}),
      list: (category: WikiCategoryName, query?: WikiListQueryInput) =>
        call(endpoints.wikiList, { params: { category }, query }),
      get: (category: WikiCategoryName, idOrSlug: string | number) =>
        call(endpoints.wikiEntity, { params: { category, idOrSlug: String(idOrSlug) } }),
    },
    rag: {
      search: (q: RagSearchQuery) => call(endpoints.ragSearch, { query: q }),
      context: (q: RagSearchQuery) => call(endpoints.ragContext, { query: q }),
    },
    cockpit: {
      createGoal: (b: CreateGoalBody) => call(endpoints.createGoal, { body: b }),
      completeGoal: (id: number, b: CompleteGoalBody = {}) =>
        call(endpoints.completeGoal, { params: { id }, body: b }),
      setFeedbackStatus: (id: number, b: FeedbackStatusBody) =>
        call(endpoints.feedbackStatus, { params: { id }, body: b }),
      addGold: (b: GoldCaseBody) => call(endpoints.goldCase, { body: b }),
      runEval: (b: EvalRequestBody = {}) => call(endpoints.runEval, { body: b }),
    },
    admin: {
      stats: () => call(endpoints.adminStats, {}),
      services: () => call(endpoints.adminServices, {}),
      tables: () => call(endpoints.adminTables, {}),
      table: (name: string, page?: TablePageQuery) =>
        call(endpoints.adminTableRows, { params: { table: name }, query: page }),
      wikiStats: () => call(endpoints.adminWikiStats, {}),
      economyStats: () => call(endpoints.adminEconomyStats, {}),
    },
  };
}

export type ShenronApiClient = ReturnType<typeof createShenronApiClient>;
