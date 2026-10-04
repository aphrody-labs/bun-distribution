// SPDX-License-Identifier: Apache-2.0
/** Shenron binds shared media evidence to its manifest and independent editorial review. */
import {
  parseKoharuPageResult as parseMediaPageResult,
  mapNativeKoharuPageResult,
  type KoharuPageResultV1,
  type KoharuMangaPageSource,
  type KoharuDatabookPageSource,
  type KoharuPageSource,
  type KoharuPageRegion,
  type KoharuPageArtifacts,
  type KoharuStageProvenance,
  type NativeKoharuPageEvidence,
} from "@aphrody/media/manga";
import type { AphrodyOcrEvidence } from "@aphrody/media/ocr";
export * from "@aphrody/media/manga";
export type { AphrodyOcrEvidence } from "@aphrody/media/ocr";
const SHA256 = /^[a-f0-9]{64}$/;
const MANGA_PAGE_ID = /^(DB|DBS):(?:vol|t|ch)[0-9]+:[1-9][0-9]*$/;
export const SHENRON_MANGA_CANDIDATE_SCHEMA = "shenron.manga.review-candidate/v1" as const;
export function parseKoharuPageResult(value: unknown): KoharuPageResultV1 {
  const result = parseMediaPageResult(value);
  if (result.source.kind === "manga" && !MANGA_PAGE_ID.test(result.source.pageId))
    throw new Error("invalid Shenron manga page ID: " + result.source.pageId);
  return result;
}
function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, path: string, maxLength = 4096): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) {
    throw new Error(`${path} must be a non-empty string of at most ${maxLength} characters`);
  }
  return value;
}

function positiveInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1)
    throw new Error(`${path} must be a positive integer`);
  return Number(value);
}

/** The exact identity and two image digests from Shenron's export manifest. */
export interface MangaCandidateBinding {
  id: string;
  sourceSha256: string;
  imageSha256: string;
  image: string;
}

export interface DatabookCandidateBinding {
  databookId: number;
  page: number;
  sourceSha256: string;
  imageSha256: string;
  image: string;
}

export const SHENRON_DATABOOK_CANDIDATE_SCHEMA = "shenron.databook.review-candidate/v1" as const;

/** Read only the manifest fields this adapter binds; the OCR/deposit tools retain full validation. */
export function parseMangaCandidateManifest(value: unknown): MangaCandidateBinding[] {
  const manifest = record(value, "manga manifest");
  if (
    manifest.schemaVersion !== 1 ||
    !Array.isArray(manifest.entries) ||
    manifest.entries.length === 0
  ) {
    throw new Error("unsupported or empty Shenron manga manifest");
  }
  if (manifest.entries.length > 10_000)
    throw new Error("manga manifest exceeds the candidate adapter limit");
  const ids = new Set<string>();
  return manifest.entries.map((raw, index) => {
    const entry = record(raw, `manga manifest.entries[${index}]`);
    const id = string(entry.id, `manga manifest.entries[${index}].id`, 128);
    if (!MANGA_PAGE_ID.test(id) || ids.has(id))
      throw new Error(`invalid or duplicate manifest page ID: ${id}`);
    ids.add(id);
    const sourceSha256 = string(entry.sourceSha256, `${id}.sourceSha256`, 64);
    const imageSha256 = string(entry.imageSha256, `${id}.imageSha256`, 64);
    if (!SHA256.test(sourceSha256) || !SHA256.test(imageSha256))
      throw new Error(`invalid manifest digest: ${id}`);
    return { id, sourceSha256, imageSha256, image: string(entry.image, `${id}.image`, 2048) };
  });
}

/** Databook adapter accepts only the hash-bearing export manifest contract. */
export function parseDatabookCandidateManifest(value: unknown): DatabookCandidateBinding[] {
  const manifest = record(value, "databook manifest");
  if (
    manifest.schemaVersion !== 1 ||
    !Array.isArray(manifest.entrees) ||
    manifest.entrees.length === 0
  ) {
    throw new Error("unsupported or empty hash-bearing Shenron databook manifest");
  }
  if (manifest.entrees.length > 10_000)
    throw new Error("databook manifest exceeds the candidate adapter limit");
  const keys = new Set<string>();
  return manifest.entrees.map((raw, index) => {
    const entry = record(raw, `databook manifest.entrees[${index}]`);
    const databookId = positiveInteger(
      entry.databookId,
      `databook manifest.entrees[${index}].databookId`,
    );
    const page = positiveInteger(entry.page, `databook manifest.entrees[${index}].page`);
    const key = `${databookId}:${page}`;
    if (keys.has(key)) throw new Error(`duplicate databook manifest page: ${key}`);
    keys.add(key);
    const sourceSha256 = string(entry.sourceSha256, `${key}.sourceSha256`, 64);
    const imageSha256 = string(entry.imageSha256, `${key}.imageSha256`, 64);
    if (!SHA256.test(sourceSha256) || !SHA256.test(imageSha256))
      throw new Error(`invalid databook manifest digest: ${key}`);
    return {
      databookId,
      page,
      sourceSha256,
      imageSha256,
      image: string(entry.image, `${key}.image`, 2048),
    };
  });
}

export interface MangaReviewCandidateInput {
  schema: typeof SHENRON_MANGA_CANDIDATE_SCHEMA;
  pageId: string;
  image: string;
  source: KoharuMangaPageSource;
  regions: KoharuPageRegion[];
  artifacts: KoharuPageArtifacts;
  pipeline: KoharuPageResultV1["pipeline"];
  cleanupProvenance?: KoharuStageProvenance | null;
  ocr?: AphrodyOcrEvidence;
  decision: "unreviewed";
}

export interface DatabookReviewCandidateInput {
  schema: typeof SHENRON_DATABOOK_CANDIDATE_SCHEMA;
  databookId: number;
  page: number;
  image: string;
  source: KoharuDatabookPageSource;
  regions: KoharuPageRegion[];
  artifacts: KoharuPageArtifacts;
  pipeline: KoharuPageResultV1["pipeline"];
  cleanupProvenance?: KoharuStageProvenance | null;
  ocr?: AphrodyOcrEvidence;
  decision: "unreviewed";
}

/** Bind a validated candidate to the exact Shenron-exported source and review image. */
export function toMangaReviewCandidateInput(
  value: unknown,
  binding: MangaCandidateBinding,
): MangaReviewCandidateInput {
  const candidate = parseKoharuPageResult(value);
  if (candidate.source.kind !== "manga")
    throw new Error("databook result refused by the manga candidate adapter");
  if (candidate.source.pageId !== binding.id)
    throw new Error("candidate page does not match Shenron manifest");
  if (candidate.source.sourceSha256 !== binding.sourceSha256) {
    throw new Error("candidate original source hash does not match Shenron manifest");
  }
  if (candidate.source.imageSha256 !== binding.imageSha256) {
    throw new Error("candidate input image hash does not match Shenron review image");
  }
  return {
    schema: SHENRON_MANGA_CANDIDATE_SCHEMA,
    pageId: candidate.source.pageId,
    image: binding.image,
    source: candidate.source,
    regions: candidate.regions,
    artifacts: candidate.artifacts,
    pipeline: candidate.pipeline,
    ...(candidate.cleanupProvenance !== undefined
      ? { cleanupProvenance: candidate.cleanupProvenance }
      : {}),
    decision: "unreviewed",
  };
}

/** Bind a databook candidate to the hash-bearing Shenron OCR export manifest. */
export function toDatabookReviewCandidateInput(
  value: unknown,
  binding: DatabookCandidateBinding,
): DatabookReviewCandidateInput {
  const candidate = parseKoharuPageResult(value);
  if (candidate.source.kind !== "databook")
    throw new Error("manga result refused by the databook candidate adapter");
  if (
    candidate.source.entityId !== binding.databookId ||
    candidate.source.plateNumber !== binding.page
  ) {
    throw new Error("candidate databook identity does not match Shenron manifest");
  }
  if (candidate.source.sourceSha256 !== binding.sourceSha256) {
    throw new Error("candidate original scan hash does not match Shenron databook manifest");
  }
  if (candidate.source.imageSha256 !== binding.imageSha256) {
    throw new Error("candidate input image hash does not match Shenron databook export");
  }
  return {
    schema: SHENRON_DATABOOK_CANDIDATE_SCHEMA,
    databookId: binding.databookId,
    page: binding.page,
    image: binding.image,
    source: candidate.source,
    regions: candidate.regions,
    artifacts: candidate.artifacts,
    pipeline: candidate.pipeline,
    ...(candidate.cleanupProvenance !== undefined
      ? { cleanupProvenance: candidate.cleanupProvenance }
      : {}),
    decision: "unreviewed",
  };
}

function nativeImageMime(image: string): KoharuPageSource["mime"] {
  if (/\.jpe?g$/i.test(image)) return "image/jpeg";
  if (/\.png$/i.test(image)) return "image/png";
  if (/\.webp$/i.test(image)) return "image/webp";
  throw new Error("Shenron manifest image needs a supported, explicit image extension");
}

export function toNativeMangaReviewCandidateInput(
  evidence: NativeKoharuPageEvidence,
  binding: MangaCandidateBinding,
  mime = nativeImageMime(binding.image),
  width?: number,
  height?: number,
): MangaReviewCandidateInput {
  const native = record(evidence.result, "native page result");
  const source: KoharuMangaPageSource = {
    kind: "manga",
    pageId: binding.id,
    sourceSha256: binding.sourceSha256,
    imageSha256: binding.imageSha256,
    mime,
    width: width ?? positiveInteger(native.width, "native page result.width"),
    height: height ?? positiveInteger(native.height, "native page result.height"),
  };
  return toMangaReviewCandidateInput(mapNativeKoharuPageResult(evidence, source), binding);
}

export function toNativeDatabookReviewCandidateInput(
  evidence: NativeKoharuPageEvidence,
  binding: DatabookCandidateBinding,
  mime = nativeImageMime(binding.image),
  width?: number,
  height?: number,
): DatabookReviewCandidateInput {
  const native = record(evidence.result, "native page result");
  const source: KoharuDatabookPageSource = {
    kind: "databook",
    entityId: binding.databookId,
    plateNumber: binding.page,
    sourceSha256: binding.sourceSha256,
    imageSha256: binding.imageSha256,
    mime,
    width: width ?? positiveInteger(native.width, "native page result.width"),
    height: height ?? positiveInteger(native.height, "native page result.height"),
  };
  return toDatabookReviewCandidateInput(mapNativeKoharuPageResult(evidence, source), binding);
}
