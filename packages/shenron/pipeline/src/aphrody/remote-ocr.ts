// SPDX-License-Identifier: Apache-2.0
/** Shenron config and resumable batch adapter over the shared media HTTP owner. */
import { appendFile, readdir } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { requireAiHttpToken, requireAiHttpUrl } from "@shenron/pipeline/ai/config";
import {
  recogniseRemotePage as recognise,
  reviewRemoteImage as review,
  toOcrResultV2,
} from "@aphrody/media/remote-ocr";
export { toOcrResultV2 } from "@aphrody/media/remote-ocr";
export type { RemoteOcrBlock, RemoteOcrResult } from "@aphrody/media/remote-ocr";
type Fetcher = typeof fetch;
function options(fetcher: Fetcher) {
  return {
    baseUrl: requireAiHttpUrl(process.env),
    token: requireAiHttpToken(process.env),
    fetch: fetcher,
  };
}
export function recogniseRemotePage(
  image: Uint8Array,
  model = "ppocr-v5-mobile",
  fetcher: Fetcher = fetch,
) {
  return recognise(image, options(fetcher), model);
}
export function reviewRemoteImage<T>(
  image: Uint8Array,
  mime: "image/jpeg" | "image/png" | "image/webp",
  prompt: string,
  model: string,
  fetcher: Fetcher = fetch,
): Promise<T> {
  return review<T>(image, mime, prompt, model, options(fetcher));
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
