// SPDX-License-Identifier: Apache-2.0
/** Aphrody OCR v2 remains evidence until Shenron's visual/editorial review. */

import { parseOcrEvidence } from "@aphrody/media/ocr";
type ImageMime = "image/jpeg" | "image/png" | "image/webp";
import type {
  DatabookCandidateBinding,
  DatabookReviewCandidateInput,
  MangaCandidateBinding,
  MangaReviewCandidateInput,
} from "./koharu";
import { SHENRON_DATABOOK_CANDIDATE_SCHEMA, SHENRON_MANGA_CANDIDATE_SCHEMA } from "./koharu";

export interface OcrReviewImage {
  mime: ImageMime;
  width: number;
  height: number;
}

export function toAphrodyMangaReviewCandidateInput(
  value: unknown,
  binding: MangaCandidateBinding,
  image: OcrReviewImage,
): MangaReviewCandidateInput {
  return {
    schema: SHENRON_MANGA_CANDIDATE_SCHEMA,
    pageId: binding.id,
    image: binding.image,
    source: {
      kind: "manga",
      pageId: binding.id,
      sourceSha256: binding.sourceSha256,
      imageSha256: binding.imageSha256,
      ...image,
    },
    regions: [],
    artifacts: { cleanupOverlaySha256: null },
    pipeline: { name: "aphrody-ocr-v2-candidate", version: "2" },
    ocr: parseOcrEvidence(
      value,
      binding.id,
      binding.imageSha256,
      image.mime,
      image.width,
      image.height,
    ),
    decision: "unreviewed",
  };
}

export function toAphrodyDatabookReviewCandidateInput(
  value: unknown,
  binding: DatabookCandidateBinding,
  image: OcrReviewImage,
): DatabookReviewCandidateInput {
  return {
    schema: SHENRON_DATABOOK_CANDIDATE_SCHEMA,
    databookId: binding.databookId,
    page: binding.page,
    image: binding.image,
    source: {
      kind: "databook",
      entityId: binding.databookId,
      plateNumber: binding.page,
      sourceSha256: binding.sourceSha256,
      imageSha256: binding.imageSha256,
      ...image,
    },
    regions: [],
    artifacts: { cleanupOverlaySha256: null },
    pipeline: { name: "aphrody-ocr-v2-candidate", version: "2" },
    ocr: parseOcrEvidence(
      value,
      `databook:${binding.databookId}:${binding.page}`,
      binding.imageSha256,
      image.mime,
      image.width,
      image.height,
    ),
    decision: "unreviewed",
  };
}
