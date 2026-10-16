/**
 * Injectable LLM client abstraction.
 *
 * The rest of the codebase depends only on the {@link LlmClient} interface, so
 * tests can supply a deterministic in-memory client and never touch the
 * network. The default implementation wraps the Gemini provider of the Vercel
 * AI SDK, with model / base URL / timeout configurable through the environment.
 */
import { createVertex } from "@ai-sdk/google-vertex";
import { generateText } from "ai";
import {
  extractStatus,
  isTransientNetworkError,
  isRetryableStatus,
} from "./retry.js";
import { LlmError, toMessage } from "./errors.js";

/** A single-turn text completion. */
export interface LlmRequest {
  readonly prompt: string;
  /** Abort signal so callers can enforce timeouts. */
  readonly signal?: AbortSignal;
}

/**
 * Minimal contract every LLM client must satisfy. Implementations should throw
 * {@link LlmError} on failure (the default one does); a thrown non-LlmError is
 * still handled by the retry layer's heuristics.
 */
export interface LlmClient {
  complete(request: LlmRequest): Promise<string>;
}

export interface LlmEnvConfig {
  /** Resolved Google Cloud project used by Vertex AI. */
  readonly project: string;
  /** Vertex AI region. */
  readonly location: string;
  /** Model id, e.g. "gemini-2.5-flash". */
  readonly model: string;
  /** Per-request network timeout in milliseconds. */
  readonly requestTimeoutMs: number;
}

export const DEFAULT_MODEL = "gemini-2.5-flash";
export const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

/** Source of environment variables (injectable for tests). */
export type EnvSource = Record<string, string | undefined>;

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Resolve LLM configuration from environment variables.
 *
 * - `APHRODY_VERTEX_PROJECT` / `GOOGLE_CLOUD_PROJECT` — project selection.
 * - `APHRODY_VERTEX_LOCATION` / `GOOGLE_CLOUD_LOCATION` — Vertex region.
 * - `DOC_AI_MODEL` — override the model id.
 * - `DOC_AI_REQUEST_TIMEOUT_MS` — per-request network timeout.
 */
export function resolveLlmConfig(env: EnvSource = process.env): LlmEnvConfig {
  return {
    project:
      env["APHRODY_VERTEX_PROJECT"]?.trim() ||
      env["GOOGLE_CLOUD_PROJECT"]?.trim() ||
      "aphrody",
    location:
      env["APHRODY_VERTEX_LOCATION"]?.trim() ||
      env["GOOGLE_CLOUD_LOCATION"]?.trim() ||
      "us-central1",
    model: env["DOC_AI_MODEL"]?.trim() || DEFAULT_MODEL,
    requestTimeoutMs: parsePositiveInt(
      env["DOC_AI_REQUEST_TIMEOUT_MS"],
      DEFAULT_REQUEST_TIMEOUT_MS,
    ),
  };
}

/** True when credentials are present and the live client should be used. */
export function hasCredentials(env: EnvSource = process.env): boolean {
  return Boolean(
    env["GOOGLE_APPLICATION_CREDENTIALS"] ||
    env["GOOGLE_CLOUD_PROJECT"] ||
    env["APHRODY_VERTEX_PROJECT"],
  );
}

/**
 * Combine a caller-provided signal with an internal timeout signal so a request
 * aborts on whichever fires first.
 */
function withTimeout(
  timeoutMs: number,
  external?: AbortSignal,
): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException("Request timed out", "TimeoutError"));
  }, timeoutMs);
  const onAbort = (): void => controller.abort(external?.reason);
  if (external) {
    if (external.aborted) controller.abort(external.reason);
    else external.addEventListener("abort", onAbort, { once: true });
  }
  const cancel = (): void => {
    clearTimeout(timer);
    external?.removeEventListener("abort", onAbort);
  };
  return { signal: controller.signal, cancel };
}

/**
 * Build the default ADC-backed Gemini Vertex client.
 */
export function createGeminiClient(config: LlmEnvConfig): LlmClient {
  const vertex = createVertex({
    project: config.project,
    location: config.location,
  });

  return {
    async complete({ prompt, signal }: LlmRequest): Promise<string> {
      const { signal: reqSignal, cancel } = withTimeout(
        config.requestTimeoutMs,
        signal,
      );
      try {
        const { text } = await generateText({
          // The workspace currently resolves AI SDK 6 while Vertex 5 exposes
          // the compatible runtime model as V4. The protocol is compatible;
          // keep the cast local until the provider publishes its SDK-6 type.
          model: vertex(config.model) as unknown as Parameters<
            typeof generateText
          >[0]["model"],
          prompt,
          abortSignal: reqSignal,
        });
        return text;
      } catch (err) {
        const status = extractStatus(err);
        const retryable =
          isRetryableStatus(status) || isTransientNetworkError(err);
        throw new LlmError(`Gemini request failed: ${toMessage(err)}`, {
          cause: err,
          status,
          retryable,
        });
      } finally {
        cancel();
      }
    },
  };
}

/**
 * Resolve the LLM client to use, or `null` when no credentials are present
 * (signalling that callers should take the deterministic offline path).
 */
export function resolveClient(env: EnvSource = process.env): LlmClient | null {
  if (!hasCredentials(env)) return null;
  return createGeminiClient(resolveLlmConfig(env));
}
