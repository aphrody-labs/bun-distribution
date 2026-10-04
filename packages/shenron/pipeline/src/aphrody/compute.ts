// SPDX-License-Identifier: Apache-2.0
/**
 * `@shenron/pipeline/aphrody/compute` — legacy facade over `@shenron/pipeline/ai/aphrody`
 * (docs/STACK.md §6.3, D16).
 *
 * `AphrodyComputeClient` keeps its historical contract: constructor options
 * (`baseUrl`, `token`, `fetcher`), method signatures, thrown errors and
 * their messages, and `ocr` still asking for the `gemini-web` engine. Without
 * options, the address and token come from the single resolver
 * `@shenron/pipeline/ai/config` (`APHRODY_AI_HTTP_URL` / `APHRODY_AI_HTTP_TOKEN`, then
 * their legacy aliases); there is no address default, a missing one throws an
 * error naming the variables. Every request is delegated to
 * {@link createAphrodyCompute}; `fetch` is resolved at call time unless a
 * `fetcher` is given.
 *
 * Registered behaviour change B18: `embed()` collapses whitespace, sends at
 * most 16 texts per request and rejects any vector that is not 384-dimensional.
 */
import {
  type AiFailure,
  type AiResult,
  type AphrodyCompute,
  createAphrodyCompute,
} from "@shenron/pipeline/ai/aphrody";
import { requireAiHttpToken, requireAiHttpUrl } from "@shenron/pipeline/ai/config";

/** Private Shenron workload boundary served by the Aphrody AI process. */
export interface AphrodyComputeOptions {
  baseUrl?: string;
  token?: string;
  fetcher?: typeof fetch;
}

// One wire contract, including the historical facade's differently named document types.
import type { AphrodyChatWireMessage } from "../ai/chat";
import type {
  AphrodyIngestDoc,
  AphrodyRagDocument as StoredDocument,
  AphrodyRagHit,
  AphrodyRagMode,
  AphrodyRagStats,
} from "../ai/wire";
export type AphrodyChatMessage = AphrodyChatWireMessage;
export type AphrodyRagDocument = AphrodyIngestDoc;
export type AphrodyRagStoredDocument = StoredDocument;
export type { AphrodyRagHit, AphrodyRagMode, AphrodyRagStats } from "../ai/wire";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "[::1]", "localhost"]);
const SOURCE_ID_RE = /^shenron:(?:\d+|pg:[a-z0-9_]{1,64}:[0-9a-f]{24}:\d+)$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Turns a failure into the error the historical client threw. `invalid` is
 * the per-method message used for a response that breaks the contract.
 */
function failureError(failure: AiFailure, invalid: string): Error {
  switch (failure.kind) {
    case "http":
      return new Error(`Aphrody compute HTTP ${failure.status} on ${failure.path}`);
    case "invalid_response":
      return new Error(invalid);
    case "timeout": {
      const error = new Error(`Aphrody compute ${failure.detail}`);
      error.name = "TimeoutError";
      return error;
    }
    default:
      return new Error(`Aphrody compute ${failure.detail}`);
  }
}

function unwrap<T>(result: AiResult<T>, invalid: string): T {
  if (!result.ok) throw failureError(result, invalid);
  return result.value;
}

export class AphrodyComputeClient {
  /** Typed client every call is delegated to (`@shenron/pipeline/ai/aphrody`). */
  readonly compute: AphrodyCompute;

  constructor(options: AphrodyComputeOptions = {}) {
    const baseUrl =
      options.baseUrl === undefined ? requireAiHttpUrl(process.env) : new URL(options.baseUrl);
    if (
      baseUrl.protocol !== "http:" ||
      !LOOPBACK_HOSTS.has(baseUrl.hostname) ||
      baseUrl.username ||
      baseUrl.password
    ) {
      throw new Error("Aphrody compute URL must use loopback HTTP");
    }
    const token = options.token ?? requireAiHttpToken(process.env);
    if (!token.trim()) throw new Error("Aphrody compute token is not configured");
    this.compute = createAphrodyCompute(
      { baseUrl, token },
      options.fetcher ? { fetch: options.fetcher } : {},
    );
  }

  async health(): Promise<{ rag: boolean; llm: boolean; ocr: boolean }> {
    return unwrap(await this.compute.health(), "Aphrody compute is unavailable");
  }

  async chat(
    messages: AphrodyChatMessage[],
    model?: string,
  ): Promise<{ answer: string; model: string }> {
    return unwrap(
      await this.compute.chat({ messages, ...(model ? { model } : {}) }),
      "Aphrody returned an empty LLM answer",
    );
  }

  async ocr(
    imageBase64: string,
    language?: string,
  ): Promise<{ text: string; language: string; textless: boolean; suspect: boolean }> {
    const result = unwrap(
      await this.compute.ocr({
        imageBase64,
        engine: "gemini-web",
        ...(language ? { language } : {}),
      }),
      "Aphrody returned an invalid OCR result",
    );
    return {
      text: result.text,
      language: result.language,
      textless: result.textless,
      suspect: result.suspect,
    };
  }

  async ragSearchWithMode(
    query: string,
    limit = 5,
    filters: { lang?: string; kind?: string; sourceId?: string; entity?: string } = {},
  ): Promise<{ results: AphrodyRagHit[]; mode: AphrodyRagMode }> {
    return unwrap(
      await this.compute.ragSearch({ q: query, limit, ...filters }),
      "Aphrody returned an invalid RAG hit",
    );
  }

  async ragSearch(
    query: string,
    limit = 5,
    filters: { lang?: string; kind?: string; sourceId?: string; entity?: string } = {},
  ): Promise<AphrodyRagHit[]> {
    return (await this.ragSearchWithMode(query, limit, filters)).results;
  }

  async embed(texts: string[], kind: "query" | "passage" = "query"): Promise<number[][]> {
    if (!texts.length || texts.some((text) => !text.trim())) {
      throw new Error("Aphrody embedding input is empty");
    }
    return unwrap(
      await this.compute.embed({ texts, kind }),
      "Aphrody returned invalid embedding vectors",
    ).vectors;
  }

  async ragStats(): Promise<AphrodyRagStats> {
    return unwrap(await this.compute.ragStats(), "Aphrody returned invalid RAG stats");
  }

  async ragDocument(sourceId: string): Promise<AphrodyRagStoredDocument | null> {
    if (!SOURCE_ID_RE.test(sourceId) || sourceId.length > 255) {
      throw new Error("Invalid Shenron RAG source ID");
    }
    return unwrap(
      await this.compute.ragDocument(sourceId),
      "Aphrody returned invalid RAG document",
    );
  }

  async ragIngest(
    ragDocument: AphrodyRagDocument,
  ): Promise<{ indexed: boolean; sourceId: string; vectorIndexed: boolean }> {
    return unwrap(
      await this.compute.ragIngest(ragDocument),
      "Aphrody did not confirm RAG ingestion",
    );
  }

  async ragSyncFinish(
    originSourceId: string,
    syncGeneration: string,
    expectedCount: number,
  ): Promise<{ retired: number }> {
    if (
      !originSourceId.trim() ||
      !UUID_RE.test(syncGeneration) ||
      !Number.isSafeInteger(expectedCount) ||
      expectedCount < 1
    ) {
      throw new Error("Invalid Aphrody RAG sync completion request");
    }
    return unwrap(
      await this.compute.ragSyncFinish({ originSourceId, syncGeneration, expectedCount }),
      "Aphrody returned invalid RAG sync result",
    );
  }
}

type ChatFn = (
  messages: AphrodyChatMessage[],
  model?: string,
) => Promise<{ answer: string; model: string }>;

/**
 * {@link AphrodyCompute} whose `chat` is served by a legacy-shaped chat
 * function (an {@link AphrodyComputeClient} or a test double); every other
 * capability answers `not_configured`. Lets AI SDK adapters
 * (`createAphrodyChatModel`) run over an injected legacy client. Errors thrown
 * by `chat` propagate unchanged.
 */
const unavailable = async (): Promise<AiFailure> => ({
  ok: false,
  kind: "not_configured",
  detail: "only chat is available on this client",
});

export function aphrodyComputeFromChat(chat: ChatFn): AphrodyCompute {
  return {
    async chat(i) {
      const messages = i.messages.map((m) => ({ role: m.role, content: m.content }));
      const value = await chat(messages, i.model);
      return { ok: true, value };
    },
    health: unavailable,
    embed: unavailable,
    ragSearch: unavailable,
    ragDocument: unavailable,
    ragStats: unavailable,
    ragIngest: unavailable,
    ragSyncFinish: unavailable,
    ocr: unavailable,
    visionStructured: unavailable,
  };
}
