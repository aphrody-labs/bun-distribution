// SPDX-License-Identifier: Apache-2.0
import { JsonTransportError, requestJson } from "@aphrody/http";
export interface RemoteOcrBlock {
  text: string;
  confidence: number;
  polygon: number[][];
  role?: string;
}

export interface RemoteOcrResult {
  text: string;
  textless: boolean;
  suspect: boolean;
  blocks: RemoteOcrBlock[];
  quality: { mean_confidence: number };
  model: string;
  elapsed_ms: number;
}

export interface MediaHttpOptions {
  baseUrl: string | URL;
  token: string;
  fetch?: typeof fetch;
}
function endpoint(path: "ocr" | "vision/structured", options: MediaHttpOptions): URL {
  const url = new URL(options.baseUrl);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
    throw new Error("Media HTTP requires an HTTP(S) origin without credentials");
  return new URL("/api/v1/shenron/" + path, url);
}
async function postImage(
  path: "ocr" | "vision/structured",
  imageBytes: Uint8Array,
  parameters: Record<string, unknown>,
  timeoutMs: number,
  options: MediaHttpOptions,
): Promise<unknown> {
  if (imageBytes.byteLength === 0 || imageBytes.byteLength > 16 * 1024 * 1024) {
    throw new Error(`${path === "ocr" ? "OCR" : "Vision"} image must be between 1 byte and 16 MiB`);
  }
  const token = options.token.trim();
  if (!token) throw new Error("Media HTTP token is required");
  try {
    const { response, value } = await requestJson(
      endpoint(path, options),
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          image_base64: Buffer.from(imageBytes).toString("base64"),
          ...parameters,
        }),
      },
      { timeoutMs, fetch: options.fetch },
    );
    if (!response.ok)
      throw new Error(`Aphrody ${path === "ocr" ? "PP-OCR" : "vision"} HTTP ${response.status}`);
    return value;
  } catch (error) {
    // Preserve the historical thrown network/JSON errors at this compatibility boundary.
    if (error instanceof JsonTransportError) throw error.cause;
    throw error;
  }
}

function validateResult(value: unknown): RemoteOcrResult {
  if (!value || typeof value !== "object")
    throw new Error("Aphrody returned an invalid OCR result");
  const result = value as Record<string, unknown>;
  if (
    typeof result.text !== "string" ||
    typeof result.textless !== "boolean" ||
    typeof result.suspect !== "boolean" ||
    !Array.isArray(result.blocks) ||
    typeof result.model !== "string" ||
    typeof result.elapsed_ms !== "number" ||
    !Number.isFinite(result.elapsed_ms) ||
    result.elapsed_ms < 0
  ) {
    throw new Error("Aphrody returned an incomplete PP-OCR result");
  }
  const quality = result.quality as Record<string, unknown> | undefined;
  if (
    !quality ||
    typeof quality.mean_confidence !== "number" ||
    !Number.isFinite(quality.mean_confidence) ||
    quality.mean_confidence < 0 ||
    quality.mean_confidence > 1
  )
    throw new Error("Aphrody returned no PP-OCR quality score");
  for (const block of result.blocks) {
    if (
      !block ||
      typeof block.text !== "string" ||
      typeof block.confidence !== "number" ||
      !Number.isFinite(block.confidence) ||
      block.confidence < 0 ||
      block.confidence > 1 ||
      !Array.isArray(block.polygon) ||
      block.polygon.length !== 4 ||
      block.polygon.some(
        (point: unknown) =>
          !Array.isArray(point) ||
          point.length !== 2 ||
          point.some((n: unknown) => typeof n !== "number" || !Number.isFinite(n)),
      )
    ) {
      throw new Error("Aphrody returned invalid PP-OCR geometry");
    }
  }
  if (
    result.textless !== (result.blocks.length === 0) ||
    result.textless !== (result.text.trim().length === 0)
  ) {
    throw new Error("Aphrody returned contradictory PP-OCR status");
  }
  return result as unknown as RemoteOcrResult;
}

export async function recogniseRemotePage(
  imageBytes: Uint8Array,
  options: MediaHttpOptions,
  model = "ppocr-v5-mobile",
): Promise<RemoteOcrResult> {
  return validateResult(
    await postImage(
      "ocr",
      imageBytes,
      { engine: "ppocr", model, include_geometry: true },
      120_000,
      options,
    ),
  );
}

export async function reviewRemoteImage<T>(
  imageBytes: Uint8Array,
  mime: "image/jpeg" | "image/png" | "image/webp",
  prompt: string,
  model: string,
  options: MediaHttpOptions,
): Promise<T> {
  const value = (await postImage(
    "vision/structured",
    imageBytes,
    { image_mime: mime, prompt, model, reasoning_effort: "low" },
    model.startsWith("gemini-web") ? 280_000 : 190_000,
    options,
  )) as { result?: unknown; model?: unknown };
  if (
    value.model !== model ||
    !value.result ||
    typeof value.result !== "object" ||
    Array.isArray(value.result)
  ) {
    throw new Error("Aphrody returned an invalid structured vision result or model");
  }
  return value.result as T;
}

export function toOcrResultV2(imagePath: string, imageBytes: Uint8Array, result: RemoteOcrResult) {
  const quality = {
    mean_confidence: result.quality.mean_confidence,
    reasons: result.suspect ? ["aphrody OCR audit flagged this page"] : [],
  };
  return {
    schema: "aphrody.ocr.result/v2",
    page_id: imagePath,
    image: {
      path: imagePath,
      sha256: new Bun.CryptoHasher("sha256").update(imageBytes).digest("hex"),
    },
    attempts: [
      {
        run: {
          model_id: result.model,
          backend: "aphrody-ppocr-http",
          provider: null,
          model_digest: null,
          prompt_digest: null,
        },
        status: "completed",
        elapsed_ms: result.elapsed_ms,
        quality,
        error: null,
      },
    ],
    status: result.suspect ? "needs-review" : result.textless ? "no-text" : "text",
    markdown: result.textless ? null : result.text,
    blocks: result.blocks,
    quality,
    raw: null,
  };
}
