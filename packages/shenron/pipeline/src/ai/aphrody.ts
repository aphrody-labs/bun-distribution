// SPDX-License-Identifier: Apache-2.0
/**
 * `@shenron/pipeline/ai/aphrody` — typed client of the `/api/v1/shenron/*` routes of
 * `aphrody-ai-http` (docs/STACK.md §3.4).
 *
 * Runtime class: `pure`. Every call returns an {@link AiResult} instead of
 * throwing. `fetch` is resolved at call time (`o.fetch ?? globalThis.fetch`),
 * each call gets its own `AbortSignal.timeout`, redirects are refused, and a
 * failure `detail` holds a status and a pathname only (never the token, the
 * query string or a response body).
 *
 * Documented differences with the historical `AphrodyComputeClient`
 * (`packages/shenron/pipeline/src/aphrody/compute.ts`): `embed` collapses whitespace and splits
 * requests in batches of {@link APHRODY_LIMITS}.embedTexts with 384-dimension
 * checks (B18), and `ocr` defaults to the `ppocr` engine.
 */
import type { z } from "zod";
import { JsonTransportError, parseRetryAfter, requestJson } from "@aphrody/http";
export { parseRetryAfter } from "@aphrody/http";
import { type AiTimeouts, chatTimeoutMs, DEFAULT_AI_TIMEOUTS, SHENRON_E5 } from "./config";
import {
  APHRODY_LIMITS,
  type AphrodyIngestDoc,
  type AphrodyOcrResult,
  type AphrodyRagDocument,
  type AphrodyRagHit,
  type AphrodyRagMode,
  type AphrodyRagStats,
  ChatResponse,
  EmbedResponse,
  HealthResponse,
  IngestResponse,
  OcrResponse,
  RagDocumentResponse,
  RagSearchResponse,
  RagStatsResponse,
  SHENRON_ROUTES,
  SyncFinishResponse,
  VisionResponse,
} from "./wire";

export type {
  AphrodyIngestDoc,
  AphrodyOcrResult,
  AphrodyRagDocument,
  AphrodyRagHit,
  AphrodyRagMode,
  AphrodyRagStats,
} from "./wire";

export type AiFailure =
  | { ok: false; kind: "not_configured"; detail: string }
  | { ok: false; kind: "invalid_request"; path: string; detail: string }
  | { ok: false; kind: "unreachable" | "timeout"; path: string; detail: string }
  | {
      ok: false;
      kind: "http";
      path: string;
      status: number;
      detail: string;
      retryAfterSeconds?: number;
    }
  | { ok: false; kind: "invalid_json" | "invalid_response"; path: string; detail: string };

export type AiResult<T> = { ok: true; value: T } | AiFailure;

/** Error carrying an {@link AiFailure}; thrown by the AI SDK adapters (chat, embeddings). */
export class AiFailureError extends Error {
  readonly failure: AiFailure;
  constructor(failure: AiFailure) {
    super(`Aphrody ${failure.kind}: ${failure.detail}`);
    this.name = "AiFailureError";
    this.failure = failure;
  }
}

export type AphrodyChatRole = "system" | "user" | "assistant";

export interface AphrodyCompute {
  health(): Promise<AiResult<{ rag: boolean; llm: boolean; ocr: boolean }>>;
  chat(i: {
    messages: readonly { role: AphrodyChatRole; content: string }[];
    model?: string;
    signal?: AbortSignal;
  }): Promise<AiResult<{ answer: string; model: string }>>;
  embed(i: {
    texts: readonly string[];
    kind: "query" | "passage";
    signal?: AbortSignal;
  }): Promise<AiResult<{ vectors: number[][] }>>;
  ragSearch(q: {
    q: string;
    limit?: number;
    lang?: string;
    kind?: string;
    sourceId?: string;
    entity?: string;
  }): Promise<AiResult<{ results: AphrodyRagHit[]; mode: AphrodyRagMode }>>;
  ragDocument(sourceId: string): Promise<AiResult<AphrodyRagDocument | null>>;
  ragStats(): Promise<AiResult<AphrodyRagStats>>;
  ragIngest(
    doc: AphrodyIngestDoc,
  ): Promise<AiResult<{ indexed: true; sourceId: string; vectorIndexed: boolean }>>;
  ragSyncFinish(i: {
    originSourceId: string;
    syncGeneration: string;
    expectedCount: number;
  }): Promise<AiResult<{ retired: number }>>;
  ocr(i: {
    imageBase64: string;
    engine?: "ppocr" | "gemini-web" | "vlm";
    language?: string;
    includeGeometry?: boolean;
  }): Promise<AiResult<AphrodyOcrResult>>;
  visionStructured(i: {
    imageBase64: string;
    mime: string;
    prompt: string;
    model?: string;
  }): Promise<AiResult<{ result: unknown; model: string }>>;
}

export interface AphrodyComputeOptions {
  fetch?: typeof fetch;
  timeouts?: Partial<AiTimeouts>;
}

/** Timeout of the RAG write and search routes (compute.ts default). */
const DEFAULT_REQUEST_MS = 30_000;
// Covers the durable SQL commit, native passage embedding and vector write.
const DEFAULT_WRITE_MS = 70_000;

const SOURCE_ID_RE = /^shenron:(?:\d+|pg:[a-z0-9_]{1,64}:[0-9a-f]{24}:\d+)$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const encoder = new TextEncoder();
function byteLength(text: string): number {
  return encoder.encode(text).length;
}

function invalidResponse(path: string): AiFailure {
  return { ok: false, kind: "invalid_response", path, detail: `invalid response ${path}` };
}

function invalidRequest(path: string, detail: string): AiFailure {
  return { ok: false, kind: "invalid_request", path, detail };
}

/** Collapses whitespace runs and trims, like the historical E5 client. */
export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function checkVectors(vectors: readonly unknown[], expected: number): boolean {
  return (
    vectors.length === expected &&
    vectors.every(
      (vector) =>
        Array.isArray(vector) &&
        vector.length === SHENRON_E5.dimensions &&
        vector.every((value) => typeof value === "number" && Number.isFinite(value)),
    )
  );
}

function definedString(value: string | null | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Client of `/api/v1/shenron/*`. `cfg` is `AiConfig["compute"]` once resolved. */
export function createAphrodyCompute(
  cfg: { baseUrl: URL; token: string },
  o: AphrodyComputeOptions = {},
): AphrodyCompute {
  const timeouts: AiTimeouts = { ...DEFAULT_AI_TIMEOUTS, ...o.timeouts };
  const baseUrl = new URL(cfg.baseUrl.href);
  const token = cfg.token;

  async function call<S extends z.ZodType>(
    route: { method: "GET" | "POST"; path: string },
    schema: S,
    options: {
      query?: URLSearchParams;
      body?: unknown;
      timeoutMs: number;
      signal?: AbortSignal;
      /** Status codes turned into `{ ok: true, value: null }` (404 for a document). */
      nullOn?: number;
    },
  ): Promise<AiResult<z.infer<S>> | { ok: true; value: null; nulled: true }> {
    const path = route.path;
    const url = new URL(path, baseUrl);
    if (options.query) url.search = options.query.toString();
    const hasBody = options.body !== undefined;
    let response: Response;
    let json: unknown;
    try {
      const result = await requestJson(
        url,
        {
          method: route.method,
          headers: {
            accept: "application/json",
            authorization: `Bearer ${token}`,
            ...(hasBody ? { "content-type": "application/json" } : {}),
          },
          ...(hasBody ? { body: JSON.stringify(options.body) } : {}),
          signal: options.signal,
        },
        { fetch: o.fetch, timeoutMs: options.timeoutMs, emptyStatus: options.nullOn },
      );
      response = result.response;
      json = result.value;
    } catch (error) {
      const kind =
        error instanceof JsonTransportError && error.timedOut
          ? "timeout"
          : error instanceof JsonTransportError && error.stage !== "request"
            ? "invalid_json"
            : "unreachable";
      return {
        ok: false,
        kind,
        path,
        detail: `${kind === "invalid_json" ? "invalid JSON" : kind} ${path}`,
      };
    }
    if (options.nullOn !== undefined && response.status === options.nullOn) {
      return { ok: true, value: null, nulled: true };
    }
    if (!response.ok) {
      const retryAfterSeconds = parseRetryAfter(response.headers.get("retry-after"));
      return {
        ok: false,
        kind: "http",
        path,
        status: response.status,
        detail: `HTTP ${response.status} ${path}`,
        ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
      };
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      return { ok: false, kind: "invalid_response", path, detail: `invalid response ${path}` };
    }
    return { ok: true, value: parsed.data as z.infer<S> };
  }

  return {
    async health() {
      const route = SHENRON_ROUTES.health;
      const r = await call(route, HealthResponse, { timeoutMs: timeouts.health });
      if (!r.ok) return r;
      if (r.value === null) return invalidResponse(route.path);
      return { ok: true, value: { ...r.value.capabilities } };
    },

    async chat(i) {
      const route = SHENRON_ROUTES.chat;
      if (i.messages.length === 0 || i.messages.length > APHRODY_LIMITS.chatMessages) {
        return invalidRequest(route.path, `messages must hold 1..=${APHRODY_LIMITS.chatMessages}`);
      }
      for (const message of i.messages) {
        if (!message.content || byteLength(message.content) > APHRODY_LIMITS.chatMessageBytes) {
          return invalidRequest(route.path, "message content must hold 1..=32768 bytes");
        }
      }
      if (
        i.model !== undefined &&
        (!i.model.trim() || i.model.length > APHRODY_LIMITS.modelIdBytes)
      ) {
        return invalidRequest(route.path, "invalid model id");
      }
      const r = await call(route, ChatResponse, {
        body: {
          messages: i.messages.map((m) => ({ role: m.role, content: m.content })),
          ...(i.model ? { model: i.model } : {}),
        },
        timeoutMs: chatTimeoutMs(i.model, timeouts),
        signal: i.signal,
      });
      if (!r.ok) return r;
      if (r.value === null) return invalidResponse(route.path);
      const answer = r.value.answer.trim();
      if (!answer) return invalidResponse(route.path);
      return { ok: true, value: { answer, model: r.value.model ?? "aphrody" } };
    },

    async embed(i) {
      const route = SHENRON_ROUTES.embed;
      const texts = i.texts.map(collapseWhitespace);
      if (texts.length === 0 || texts.some((text) => !text)) {
        return invalidRequest(route.path, "embedding input is empty");
      }
      if (texts.some((text) => byteLength(text) > APHRODY_LIMITS.embedTextBytes)) {
        return invalidRequest(
          route.path,
          `embedding input exceeds ${APHRODY_LIMITS.embedTextBytes} bytes`,
        );
      }
      const vectors: number[][] = [];
      for (let start = 0; start < texts.length; start += APHRODY_LIMITS.embedTexts) {
        const batch = texts.slice(start, start + APHRODY_LIMITS.embedTexts);
        // No client prefix: the server adds `query: ` / `passage: ` (http_rest.rs, D10).
        // eslint-disable-next-line no-await-in-loop -- The embedding endpoint requires sequential batches of at most 16.
        const r = await call(route, EmbedResponse, {
          body: { texts: batch, kind: i.kind },
          timeoutMs: timeouts.embed,
          signal: i.signal,
        });
        if (!r.ok) return r;
        if (r.value === null || !checkVectors(r.value.vectors, batch.length)) {
          return invalidResponse(route.path);
        }
        vectors.push(...r.value.vectors);
      }
      return { ok: true, value: { vectors } };
    },

    async ragSearch(q) {
      const route = SHENRON_ROUTES.ragSearch;
      const params = new URLSearchParams({ q: q.q, limit: String(q.limit ?? 5) });
      for (const name of ["lang", "kind", "sourceId", "entity"] as const) {
        const value = q[name];
        if (value) params.set(name, value);
      }
      const r = await call(route, RagSearchResponse, {
        query: params,
        timeoutMs: DEFAULT_REQUEST_MS,
      });
      if (!r.ok) return r;
      if (r.value === null) return invalidResponse(route.path);
      const results: AphrodyRagHit[] = r.value.results.map((hit) => {
        const out: AphrodyRagHit = {
          title: hit.title,
          url: hit.url,
          snippet: hit.snippet,
          score: hit.score,
          kind: hit.kind,
        };
        const sourceId = definedString(hit.sourceId);
        const originSourceId = definedString(hit.originSourceId);
        const entity = definedString(hit.entity);
        const lang = definedString(hit.lang);
        const content = definedString(hit.content);
        if (sourceId !== undefined) out.sourceId = sourceId;
        if (originSourceId !== undefined) out.originSourceId = originSourceId;
        if (entity !== undefined) out.entity = entity;
        if (lang !== undefined) out.lang = lang;
        if (content !== undefined) out.content = content;
        return out;
      });
      return { ok: true, value: { results, mode: r.value.mode ?? "lexical" } };
    },

    async ragDocument(sourceId) {
      const route = SHENRON_ROUTES.ragDocument;
      if (sourceId.length > APHRODY_LIMITS.sourceIdBytes || !SOURCE_ID_RE.test(sourceId)) {
        return invalidRequest(route.path, "invalid Shenron RAG source ID");
      }
      const r = await call(route, RagDocumentResponse, {
        query: new URLSearchParams({ sourceId }),
        timeoutMs: timeouts.health,
        nullOn: 404,
      });
      if (!r.ok) return r;
      if (r.value === null) return { ok: true, value: null };
      const doc = r.value.document;
      if (doc.sourceId !== sourceId) return invalidResponse(route.path);
      const out: AphrodyRagDocument = {
        sourceId,
        title: doc.title,
        url: doc.url,
        kind: doc.kind,
        snippet: doc.snippet,
      };
      const entity = definedString(doc.entity);
      const originSourceId = definedString(doc.originSourceId);
      if (entity !== undefined) out.entity = entity;
      if (originSourceId !== undefined) out.originSourceId = originSourceId;
      return { ok: true, value: out };
    },

    async ragStats() {
      const route = SHENRON_ROUTES.ragStats;
      const r = await call(route, RagStatsResponse, { timeoutMs: timeouts.health });
      if (!r.ok) return r;
      if (r.value === null) return invalidResponse(route.path);
      const v = r.value;
      return {
        ok: true,
        value: {
          chunks: v.chunks,
          vectors: v.vectors,
          ...(v.vectorsStored === undefined ? {} : { vectorsStored: v.vectorsStored }),
          sources: v.sources ?? [],
        },
      };
    },

    async ragIngest(doc) {
      const route = SHENRON_ROUTES.ragIngest;
      const r = await call(route, IngestResponse, { body: doc, timeoutMs: DEFAULT_WRITE_MS });
      if (!r.ok) return r;
      if (r.value === null || r.value.sourceId !== doc.sourceId) return invalidResponse(route.path);
      return {
        ok: true,
        value: {
          indexed: true,
          sourceId: doc.sourceId,
          vectorIndexed: r.value.vectorIndexed === true,
        },
      };
    },

    async ragSyncFinish(i) {
      const route = SHENRON_ROUTES.ragSyncFinish;
      if (
        !i.originSourceId.trim() ||
        !UUID_RE.test(i.syncGeneration) ||
        !Number.isSafeInteger(i.expectedCount) ||
        i.expectedCount < 1
      ) {
        return invalidRequest(route.path, "invalid RAG sync completion request");
      }
      const r = await call(route, SyncFinishResponse, {
        body: {
          originSourceId: i.originSourceId,
          syncGeneration: i.syncGeneration,
          expectedCount: i.expectedCount,
        },
        timeoutMs: DEFAULT_WRITE_MS,
      });
      if (!r.ok) return r;
      if (r.value === null) return invalidResponse(route.path);
      return { ok: true, value: { retired: r.value.retired } };
    },

    async ocr(i) {
      // Never gated on health().ocr: the capability flag reflects the build
      // feature, not the gemini-web engine, so the call itself is the probe.
      const route = SHENRON_ROUTES.ocr;
      if (!i.imageBase64 || i.imageBase64.length > APHRODY_LIMITS.imageBase64Bytes) {
        return invalidRequest(route.path, "invalid image_base64");
      }
      const engine = i.engine ?? "ppocr";
      if (i.includeGeometry && engine !== "ppocr") {
        return invalidRequest(route.path, "geometry requires the ppocr engine");
      }
      const r = await call(route, OcrResponse, {
        body: {
          image_base64: i.imageBase64,
          engine,
          ...(i.language ? { language: i.language } : {}),
          ...(i.includeGeometry === undefined ? {} : { include_geometry: i.includeGeometry }),
        },
        timeoutMs: timeouts.ocr,
      });
      if (!r.ok) return r;
      if (r.value === null) return invalidResponse(route.path);
      const v = r.value;
      const out: AphrodyOcrResult = {
        text: v.text,
        language: v.language,
        textless: v.textless === true,
        suspect: v.suspect === true,
      };
      if (typeof v.model === "string") out.model = v.model;
      if (Array.isArray(v.findings)) out.findings = v.findings;
      if (typeof v.elapsed_ms === "number") out.elapsedMs = v.elapsed_ms;
      if (Array.isArray(v.blocks)) out.blocks = v.blocks;
      if (v.quality) out.meanConfidence = v.quality.mean_confidence;
      return { ok: true, value: out };
    },

    async visionStructured(i) {
      const route = SHENRON_ROUTES.visionStructured;
      if (
        !i.imageBase64 ||
        i.imageBase64.length > APHRODY_LIMITS.imageBase64Bytes ||
        !["image/jpeg", "image/png", "image/webp"].includes(i.mime) ||
        !i.prompt ||
        byteLength(i.prompt) > APHRODY_LIMITS.visionPromptBytes
      ) {
        return invalidRequest(route.path, "invalid vision request");
      }
      const r = await call(route, VisionResponse, {
        body: {
          image_base64: i.imageBase64,
          image_mime: i.mime,
          prompt: i.prompt,
          ...(i.model ? { model: i.model } : {}),
        },
        timeoutMs: timeouts.ocr,
      });
      if (!r.ok) return r;
      if (r.value === null) return invalidResponse(route.path);
      return { ok: true, value: { result: r.value.result, model: r.value.model } };
    },
  };
}
