// SPDX-License-Identifier: Apache-2.0
/** Aphrody OCR v2 remains evidence until Shenron's visual/editorial review. */

import type {
	AphrodyOcrEvidence,
	DatabookCandidateBinding,
	DatabookReviewCandidateInput,
	MangaCandidateBinding,
	MangaReviewCandidateInput,
} from "./koharu";
import { SHENRON_DATABOOK_CANDIDATE_SCHEMA, SHENRON_MANGA_CANDIDATE_SCHEMA } from "./koharu";

const OCR_SCHEMA = "aphrody.ocr.result/v2" as const;
const SHA256 = /^[a-f0-9]{64}$/;
type ImageMime = "image/jpeg" | "image/png" | "image/webp";

function object(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
	return value as Record<string, unknown>;
}

function text(value: unknown, label: string, max = 40_000): string {
	if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`${label} must be a non-empty string below ${max} characters`);
	return value;
}

function nullableText(value: unknown, label: string, max = 40_000): string | null {
	if (value === null || value === undefined) return null;
	return text(value, label, max);
}

function confidence(value: unknown, label: string): number | null {
	if (value === null || value === undefined) return null;
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
		throw new Error(`${label} must be a confidence between 0 and 1`);
	}
	return value;
}

function quality(value: unknown, label: string): AphrodyOcrEvidence["quality"] {
	const input = object(value, label);
	const reasons = input.reasons ?? [];
	if (!Array.isArray(reasons) || reasons.length > 100) throw new Error(`${label}.reasons must have at most 100 entries`);
	return {
		meanConfidence: confidence(input.mean_confidence, `${label}.mean_confidence`),
		reasons: reasons.map((reason, index) => text(reason, `${label}.reasons[${index}]`, 4096)),
	};
}

function polygon(value: unknown, label: string, width: number, height: number): number[][] | null {
	if (value === undefined || value === null) return null;
	if (!Array.isArray(value) || value.length !== 4) throw new Error(`${label} must have four points`);
	return value.map((point, index) => {
		if (!Array.isArray(point) || point.length !== 2 || point.some((coordinate) => typeof coordinate !== "number" || !Number.isFinite(coordinate))) {
			throw new Error(`${label}[${index}] must have two finite coordinates`);
		}
		const [x, y] = point as [number, number];
		if (x < 0 || x > width || y < 0 || y > height) throw new Error(`${label}[${index}] leaves the image`);
		return [x, y];
	});
}

function evidence(value: unknown, pageIdentity: string, imageSha256: string, mime: ImageMime, width: number, height: number): AphrodyOcrEvidence {
	const result = object(value, "Aphrody OCR result");
	if (result.schema !== OCR_SCHEMA) throw new Error(`unsupported Aphrody OCR schema: ${String(result.schema)}`);
	const pageId = text(result.page_id, "OCR page_id", 4096);
	const image = object(result.image, "OCR image");
	const imagePath = text(image.path, "OCR image.path", 4096);
	// Manga projections carry Shenron's ID; generic OCR batches use their input path.
	// Neither form establishes editorial identity without the unique manifest SHA below.
	if (pageId !== pageIdentity && pageId !== imagePath) {
		throw new Error("OCR page_id matches neither the Shenron page identity nor the scanned image path");
	}
	if (image.sha256 !== imageSha256 || typeof image.sha256 !== "string" || !SHA256.test(image.sha256)) {
		throw new Error("OCR input digest does not match the Shenron manifest image");
	}
	if (image.media_type !== undefined && image.media_type !== null && image.media_type !== mime) {
		throw new Error("OCR image media type does not match the Shenron review image");
	}
	if (result.status !== "text" && result.status !== "needs-review") {
		throw new Error(`OCR status ${String(result.status)} cannot become a transcription candidate`);
	}
	const markdown = nullableText(result.markdown, "OCR markdown");
	const rawBlocks = result.blocks ?? [];
	if (!Array.isArray(rawBlocks) || rawBlocks.length > 1000) throw new Error("OCR blocks must have at most 1000 entries");
	const blocks = rawBlocks.map((value, index) => {
		const block = object(value, `OCR blocks[${index}]`);
		return {
			text: text(block.text, `OCR blocks[${index}].text`),
			polygon: polygon(block.polygon, `OCR blocks[${index}].polygon`, width, height),
			confidence: confidence(block.confidence, `OCR blocks[${index}].confidence`),
			role: nullableText(block.role, `OCR blocks[${index}].role`, 128),
		};
	});
	if (!markdown && blocks.length === 0) throw new Error("OCR candidate has no transcription evidence");
	const rawAttempts = result.attempts ?? [];
	if (!Array.isArray(rawAttempts) || rawAttempts.length > 20) throw new Error("OCR attempts must have at most 20 entries");
	const attempts: AphrodyOcrEvidence["attempts"] = rawAttempts.map((value, index): AphrodyOcrEvidence["attempts"][number] => {
		const attempt = object(value, `OCR attempts[${index}]`);
		const run = object(attempt.run, `OCR attempts[${index}].run`);
		const status = attempt.status;
		if (status !== "completed" && status !== "timed-out" && status !== "failed") {
			throw new Error(`invalid OCR attempt status at ${index}`);
		}
		if (typeof attempt.elapsed_ms !== "number" || !Number.isSafeInteger(attempt.elapsed_ms) || attempt.elapsed_ms < 0) {
			throw new Error(`invalid OCR elapsed_ms at ${index}`);
		}
		return {
			run: {
				modelId: text(run.model_id, `OCR attempts[${index}].run.model_id`, 256),
				backend: text(run.backend, `OCR attempts[${index}].run.backend`, 256),
				provider: nullableText(run.provider, `OCR attempts[${index}].run.provider`, 256),
				modelDigest: nullableText(run.model_digest, `OCR attempts[${index}].run.model_digest`, 256),
				promptDigest: nullableText(run.prompt_digest, `OCR attempts[${index}].run.prompt_digest`, 256),
			},
			status,
			elapsedMs: attempt.elapsed_ms,
			quality: quality(attempt.quality ?? {}, `OCR attempts[${index}].quality`),
			error: nullableText(attempt.error, `OCR attempts[${index}].error`, 4096),
		};
	});
	const raw = result.raw === null || result.raw === undefined ? null : result.raw;
	if (raw !== null && (typeof raw !== "string" || raw.length > 1_000_000)) {
		throw new Error("OCR raw must be a string below 1 MB");
	}
	return {
		schema: OCR_SCHEMA,
		pageId,
		imagePath,
		status: result.status,
		markdown,
		blocks,
		quality: quality(result.quality ?? {}, "OCR quality"),
		attempts,
		rawSha256: raw === null ? null : new Bun.CryptoHasher("sha256").update(raw).digest("hex"),
	};
}

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
		source: { kind: "manga", pageId: binding.id, sourceSha256: binding.sourceSha256, imageSha256: binding.imageSha256, ...image },
		regions: [],
		artifacts: { cleanupOverlaySha256: null },
		pipeline: { name: "aphrody-ocr-v2-candidate", version: "2" },
		ocr: evidence(value, binding.id, binding.imageSha256, image.mime, image.width, image.height),
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
		source: { kind: "databook", entityId: binding.databookId, plateNumber: binding.page,
			sourceSha256: binding.sourceSha256, imageSha256: binding.imageSha256, ...image },
		regions: [],
		artifacts: { cleanupOverlaySha256: null },
		pipeline: { name: "aphrody-ocr-v2-candidate", version: "2" },
		ocr: evidence(value, `databook:${binding.databookId}:${binding.page}`, binding.imageSha256, image.mime, image.width, image.height),
		decision: "unreviewed",
	};
}
