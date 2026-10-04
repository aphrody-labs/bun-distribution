// SPDX-License-Identifier: Apache-2.0
/**
 * `@shenron/pipeline/aphrody/remote-ocr` — PP-OCR and structured vision client for the
 * loopback Aphrody Shenron API (`/api/v1/shenron/ocr`, `/vision/structured`),
 * shared by the pipeline, bot and ops scripts (formerly
 * `packages/shenron/pipeline/scripts/_aphrody-remote-ocr.ts`).
 */
import { JsonTransportError, requestJson } from "@aphrody/http";
import { appendFile, readdir } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { requireAiHttpToken, requireAiHttpUrl } from "@shenron/pipeline/ai/config";

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

type Fetcher = typeof fetch;

/** Route of `aphrody-ai-http`; the origin comes from `@shenron/pipeline/ai/config` (no default). */
function endpoint(path: "ocr" | "vision/structured"): URL {
  return new URL(`/api/v1/shenron/${path}`, requireAiHttpUrl(process.env));
}

async function postImage(
  path: "ocr" | "vision/structured",
  imageBytes: Uint8Array,
  parameters: Record<string, unknown>,
  timeoutMs: number,
  fetcher: Fetcher,
): Promise<unknown> {
  if (imageBytes.byteLength === 0 || imageBytes.byteLength > 16 * 1024 * 1024) {
    throw new Error(`${path === "ocr" ? "OCR" : "Vision"} image must be between 1 byte and 16 MiB`);
  }
  const token = requireAiHttpToken(process.env);
  try {
    const { response, value } = await requestJson(
      endpoint(path),
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
      { timeoutMs, fetch: fetcher },
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
    typeof result.elapsed_ms !== "number"
  ) {
    throw new Error("Aphrody returned an incomplete PP-OCR result");
  }
  const quality = result.quality as Record<string, unknown> | undefined;
  if (!quality || typeof quality.mean_confidence !== "number")
    throw new Error("Aphrody returned no PP-OCR quality score");
  for (const block of result.blocks) {
    if (
      !block ||
      typeof block.text !== "string" ||
      typeof block.confidence !== "number" ||
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
  model = "ppocr-v5-mobile",
  fetcher: Fetcher = fetch,
): Promise<RemoteOcrResult> {
  return validateResult(
    await postImage(
      "ocr",
      imageBytes,
      { engine: "ppocr", model, include_geometry: true },
      120_000,
      fetcher,
    ),
  );
}

export async function reviewRemoteImage<T>(
  imageBytes: Uint8Array,
  mime: "image/jpeg" | "image/png" | "image/webp",
  prompt: string,
  model: string,
  fetcher: Fetcher = fetch,
): Promise<T> {
  const value = (await postImage(
    "vision/structured",
    imageBytes,
    { image_mime: mime, prompt, model, reasoning_effort: "low" },
    model.startsWith("gemini-web") ? 280_000 : 190_000,
    fetcher,
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

export function legacyAuditProjection(jsonl: string): { jsonl: string; expectedText: number } {
  const rows: string[] = [];
  let expectedText = 0;
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    const record = JSON.parse(line) as {
      schema?: string;
      status?: string;
      image?: { path?: string };
      markdown?: string | null;
      blocks?: Array<{ text?: string }>;
    };
    if (
      record.schema !== "aphrody.ocr.result/v2" ||
      !record.image?.path ||
      !["text", "no-text"].includes(record.status ?? "")
    ) {
      throw new Error("OCR batch contains an invalid or uncertain page");
    }
    const markdown =
      record.markdown ??
      record.blocks
        ?.map((block) => block.text ?? "")
        .filter(Boolean)
        .join("\n");
    if (record.status === "text" && !markdown?.trim())
      throw new Error("OCR text status has no text to audit");
    if (record.status === "text") expectedText++;
    rows.push(
      JSON.stringify({
        image: record.image.path,
        text: record.status === "text" ? { kind: "text", markdown } : { kind: "none" },
      }),
    );
  }
  return { jsonl: rows.length ? `${rows.join("\n")}\n` : "", expectedText };
}

export async function runRemoteBatch(
  directory: string,
  outputPath: string,
  model = "ppocr-v5-mobile",
  onProgress?: (done: number, total: number) => void,
  fetcher: Fetcher = fetch,
): Promise<number> {
  const names = (await readdir(directory))
    .filter((name) => [".jpg", ".jpeg", ".png", ".webp"].includes(extname(name).toLowerCase()))
    .toSorted();
  const completed = new Set<string>();
  const previous = await Bun.file(outputPath)
    .text()
    .catch(() => "");
  for (const line of previous.split("\n")) {
    if (!line.trim()) continue;
    const value = JSON.parse(line) as { schema?: string; image?: { path?: string } };
    if (value.schema !== "aphrody.ocr.result/v2" || !value.image?.path)
      throw new Error("Existing OCR JSONL has an incompatible record");
    completed.add(resolve(value.image.path));
  }
  let added = 0;
  for (const name of names) {
    const path = resolve(join(directory, name));
    if (completed.has(path)) continue;
    // eslint-disable-next-line no-await-in-loop -- Bound image memory to one page and preserve resumable batch order.
    const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
    // eslint-disable-next-line no-await-in-loop -- The OCR worker and append-only journal are processed one page at a time.
    const result = await recogniseRemotePage(bytes, model, fetcher);
    // eslint-disable-next-line no-await-in-loop -- Commit this page before starting the next resumable item.
    await appendFile(outputPath, `${JSON.stringify(toOcrResultV2(path, bytes, result))}\n`, "utf8");
    added++;
    onProgress?.(completed.size + added, names.length);
  }
  return added;
}
