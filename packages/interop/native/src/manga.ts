// SPDX-License-Identifier: Apache-2.0

import { CString, type Pointer } from "bun:ffi";
import { cstr, loadLib, type CapturedResult } from "./engine";

export type MangaId = bigint | number;

function ownedResult(ptr: Pointer | bigint | null, operation: string): CapturedResult {
  if (!ptr) throw new Error(`${operation} returned NULL`);
  try {
    const value: unknown = JSON.parse(new CString(ptr).toString());
    if (
      typeof value !== "object" ||
      value === null ||
      !Number.isInteger((value as any).code) ||
      typeof (value as any).stdout !== "string" ||
      typeof (value as any).stderr !== "string"
    )
      throw new Error(`${operation} returned an invalid result payload`);
    return value as CapturedResult;
  } finally {
    loadLib().symbols.manga_string_free(ptr);
  }
}

function u64(value: MangaId, label: string): bigint {
  if (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0)) {
    throw new RangeError(`${label} must be a non-negative safe integer or bigint`);
  }
  const parsed = BigInt(value);
  if (parsed < 0n || parsed > 0xffff_ffff_ffff_ffffn)
    throw new RangeError(`${label} is outside the u64 range`);
  return parsed;
}

function language(value?: string): Uint8Array | null {
  if (value === undefined) return null;
  if (value.includes("\0")) throw new TypeError("target language must not contain NUL");
  return cstr(value);
}

/** ABI revision for the Manga processing symbols. */
export function mangaAbiVersion(): number {
  return loadLib().symbols.manga_abi_version();
}

/** Detect speech bubbles and reading order from an image buffer. */
export function mangaDetectBubbles(image: Uint8Array): CapturedResult {
  return ownedResult(
    loadLib().symbols.manga_detect_bubbles(image, image.byteLength),
    "manga_detect_bubbles",
  );
}

/** Fit text to a speech bubble without network or model access. */
export function mangaTypesetFit(
  text: string,
  box: { x: number; y: number; width: number; height: number },
  vertical = false,
): CapturedResult {
  if (text.includes("\0")) throw new TypeError("typesetting text must not contain NUL");
  for (const [key, value] of Object.entries(box)) {
    if (!Number.isFinite(value)) throw new RangeError(`box ${key} must be finite`);
  }
  if (box.width <= 0 || box.height <= 0)
    throw new RangeError("box width and height must be positive");
  return ownedResult(
    loadLib().symbols.manga_typeset_fit(
      cstr(text),
      box.x,
      box.y,
      box.width,
      box.height,
      vertical ? 1 : 0,
    ),
    "manga_typeset_fit",
  );
}

/** Run the full image-to-PSD pipeline. The returned JSON may include base64 image data. */
export function mangaPipelineRun(image: Uint8Array, targetLanguage?: string): CapturedResult {
  return ownedResult(
    loadLib().symbols.manga_pipeline_run(image, image.byteLength, language(targetLanguage)),
    "manga_pipeline_run",
  );
}

/** Fetch a manga plate by URL/path and run scanlation; this performs network I/O. */
export function mangaScanlateCdn(urlOrPath: string, targetLanguage?: string): CapturedResult {
  if (urlOrPath.includes("\0")) throw new TypeError("URL or path must not contain NUL");
  return ownedResult(
    loadLib().symbols.manga_scanlate_cdn(cstr(urlOrPath), language(targetLanguage)),
    "manga_scanlate_cdn",
  );
}

/** Fetch a databook plate and run scanlation; this performs network I/O. */
export function mangaScanlateDatabook(
  databookId: MangaId,
  plateNumber: number,
  targetLanguage?: string,
): CapturedResult {
  if (!Number.isInteger(plateNumber) || plateNumber < 0 || plateNumber > 0xffff_ffff) {
    throw new RangeError("plateNumber must fit in u32");
  }
  return ownedResult(
    loadLib().symbols.manga_scanlate_databook(
      u64(databookId, "databookId"),
      plateNumber,
      language(targetLanguage),
    ),
    "manga_scanlate_databook",
  );
}

/** Fetch a manga chapter plate and run scanlation; this performs network I/O. */
export function mangaScanlateChapter(
  chapterId: MangaId,
  plateNumber: number,
  targetLanguage?: string,
): CapturedResult {
  if (!Number.isInteger(plateNumber) || plateNumber < 0 || plateNumber > 0xffff_ffff) {
    throw new RangeError("plateNumber must fit in u32");
  }
  return ownedResult(
    loadLib().symbols.manga_scanlate_chapter(
      u64(chapterId, "chapterId"),
      plateNumber,
      language(targetLanguage),
    ),
    "manga_scanlate_chapter",
  );
}

// Shared parsing of the versioned Rust/Koharu result; no second wire model.
export * from "@aphrody/media/manga";
