// SPDX-License-Identifier: Apache-2.0


/**
 * Koharu page results enter Shenron as untrusted review candidates. This
 * adapter binds them to Shenron's exported manga manifest and creates review
 * context; it never creates an OCR verdict or writes editorial data.
 */

export const KOHARU_PAGE_RESULT_SCHEMA = "aphrody.manga.page-result/v1" as const;
export const SHENRON_MANGA_CANDIDATE_SCHEMA = "shenron.manga.review-candidate/v1" as const;

const SHA256 = /^[a-f0-9]{64}$/;
const MANGA_PAGE_ID = /^(DB|DBS):(?:vol|t|ch)[0-9]+:[1-9][0-9]*$/;
const IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

export interface KoharuImageSource {
	kind: "manga" | "databook";
	sourceSha256: string;
	imageSha256: string;
	mime: "image/jpeg" | "image/png" | "image/webp";
	width: number;
	height: number;
	url?: string;
}

export interface KoharuMangaPageSource extends KoharuImageSource {
	kind: "manga";
	pageId: string;
	entityId?: number;
	plateNumber?: number;
}

export interface KoharuDatabookPageSource extends KoharuImageSource {
	kind: "databook";
	entityId: number;
	plateNumber: number;
}

export type KoharuPageSource = KoharuMangaPageSource | KoharuDatabookPageSource;

export interface KoharuPageBounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface KoharuPagePoint {
	x: number;
	y: number;
}

export interface KoharuPageText {
	id: string;
	readingOrder: number | null;
	sourceText: string | null;
	sourceLanguage: string | null;
	ocrConfidence: number | null;
	ocrProvenance: KoharuStageProvenance | null;
	translatedText: string | null;
	targetLanguage: string | null;
	translationProvenance: KoharuStageProvenance | null;
}

export interface KoharuStageProvenance {
	producer: string;
	model: string | null;
	confidence: number | null;
}

export interface KoharuDetectionLabel {
	kind: string;
	confidence: number;
}

export interface KoharuPageArtifacts {
	cleanupOverlaySha256: string | null;
}

export interface KoharuPageRegion {
	id: string;
	kind: string;
	label: string | null;
	readingOrder: number | null;
	detectionLabels: KoharuDetectionLabel[];
	bounds: KoharuPageBounds;
	polygon: KoharuPagePoint[];
	detectionConfidence: number | null;
	sourceText: string | null;
	sourceLanguage?: string | null;
	ocrConfidence?: number | null;
	translatedText: string | null;
	targetLanguage?: string | null;
	texts: KoharuPageText[];
	provenance: {
		detection: KoharuStageProvenance | null;
		ocr: KoharuStageProvenance | null;
		translation: KoharuStageProvenance | null;
	};
}

export interface KoharuPageResultV1 {
	schema: typeof KOHARU_PAGE_RESULT_SCHEMA;
	source: KoharuPageSource;
	regions: KoharuPageRegion[];
	artifacts: KoharuPageArtifacts;
	pipeline: { name: string; version: string };
	cleanupProvenance?: KoharuStageProvenance | null;
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
	if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.entries) || manifest.entries.length === 0) {
		throw new Error("unsupported or empty Shenron manga manifest");
	}
	if (manifest.entries.length > 10_000) throw new Error("manga manifest exceeds the candidate adapter limit");
	const ids = new Set<string>();
	return manifest.entries.map((raw, index) => {
		const entry = record(raw, `manga manifest.entries[${index}]`);
		const id = string(entry.id, `manga manifest.entries[${index}].id`, 128);
		if (!MANGA_PAGE_ID.test(id) || ids.has(id)) throw new Error(`invalid or duplicate manifest page ID: ${id}`);
		ids.add(id);
		const sourceSha256 = string(entry.sourceSha256, `${id}.sourceSha256`, 64);
		const imageSha256 = string(entry.imageSha256, `${id}.imageSha256`, 64);
		if (!SHA256.test(sourceSha256) || !SHA256.test(imageSha256)) throw new Error(`invalid manifest digest: ${id}`);
		return { id, sourceSha256, imageSha256, image: string(entry.image, `${id}.image`, 2048) };
	});
}

/** Databook adapter accepts only the hash-bearing export manifest contract. */
export function parseDatabookCandidateManifest(value: unknown): DatabookCandidateBinding[] {
	const manifest = record(value, "databook manifest");
	if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.entrees) || manifest.entrees.length === 0) {
		throw new Error("unsupported or empty hash-bearing Shenron databook manifest");
	}
	if (manifest.entrees.length > 10_000) throw new Error("databook manifest exceeds the candidate adapter limit");
	const keys = new Set<string>();
	return manifest.entrees.map((raw, index) => {
		const entry = record(raw, `databook manifest.entrees[${index}]`);
		const databookId = positiveInteger(entry.databookId, `databook manifest.entrees[${index}].databookId`);
		const page = positiveInteger(entry.page, `databook manifest.entrees[${index}].page`);
		const key = `${databookId}:${page}`;
		if (keys.has(key)) throw new Error(`duplicate databook manifest page: ${key}`);
		keys.add(key);
		const sourceSha256 = string(entry.sourceSha256, `${key}.sourceSha256`, 64);
		const imageSha256 = string(entry.imageSha256, `${key}.imageSha256`, 64);
		if (!SHA256.test(sourceSha256) || !SHA256.test(imageSha256)) throw new Error(`invalid databook manifest digest: ${key}`);
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

/** Original OCR v2 evidence retained in the existing unreviewed candidate artifact. */
export interface AphrodyOcrEvidence {
	schema: "aphrody.ocr.result/v2";
	pageId: string;
	imagePath: string;
	status: "text" | "needs-review";
	markdown: string | null;
	blocks: Array<{
		text: string;
		polygon: number[][] | null;
		confidence: number | null;
		role: string | null;
	}>;
	quality: { meanConfidence: number | null; reasons: string[] };
	attempts: Array<{
		run: { modelId: string; backend: string; provider: string | null; modelDigest: string | null; promptDigest: string | null };
		status: "completed" | "timed-out" | "failed";
		elapsedMs: number;
		quality: { meanConfidence: number | null; reasons: string[] };
		error: string | null;
	}>;
	rawSha256: string | null;
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

function nullableString(value: unknown, path: string, maxLength = 16_384): string | null {
	if (value === null) return null;
	return string(value, path, maxLength);
}

function finite(value: unknown, path: string, minimum?: number, maximum?: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${path} must be finite`);
	if (minimum !== undefined && value < minimum) throw new Error(`${path} is below ${minimum}`);
	if (maximum !== undefined && value > maximum) throw new Error(`${path} is above ${maximum}`);
	return value;
}

function positiveInteger(value: unknown, path: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error(`${path} must be a positive integer`);
	return Number(value);
}

function optionalNullableString(value: unknown, path: string): string | null | undefined {
	return value === undefined ? undefined : value === null ? null : string(value, path);
}

function parsePoint(value: unknown, path: string, width: number, height: number): KoharuPagePoint {
	const point = record(value, path);
	return {
		x: finite(point.x, `${path}.x`, 0, width),
		y: finite(point.y, `${path}.y`, 0, height),
	};
}

function parseStageProvenance(value: unknown, path: string): KoharuStageProvenance | null {
	if (value === null) return null;
	const provenance = record(value, path);
	const confidence = provenance.confidence === null
		? null
		: finite(provenance.confidence, `${path}.confidence`, 0, 1);
	const model = provenance.model === null ? null : string(provenance.model, `${path}.model`, 256);
	return {
		producer: string(provenance.producer, `${path}.producer`, 256),
		model,
		confidence,
	};
}

function parseProvenance(value: unknown, path: string): KoharuPageRegion["provenance"] {
	const provenance = record(value, path);
	return {
		detection: parseStageProvenance(provenance.detection, `${path}.detection`),
		ocr: parseStageProvenance(provenance.ocr, `${path}.ocr`),
		translation: parseStageProvenance(provenance.translation, `${path}.translation`),
	};
}

/** Validate one versioned Koharu output without assigning it an editorial verdict. */
export function parseKoharuPageResult(value: unknown): KoharuPageResultV1 {
	const root = record(value, "page result");
	if (root.schema !== KOHARU_PAGE_RESULT_SCHEMA) {
		throw new Error(`unsupported Koharu page result schema: ${String(root.schema)}`);
	}
	const source = record(root.source, "source");
	if (source.kind !== "manga" && source.kind !== "databook") {
		throw new Error("page result source.kind must be manga or databook");
	}
	for (const field of ["sourceSha256", "imageSha256"] as const) {
		if (typeof source[field] !== "string" || !SHA256.test(source[field] as string)) {
			throw new Error(`source.${field} must be a lowercase SHA-256 digest`);
		}
	}
	if (typeof source.mime !== "string" || !IMAGE_MIME.has(source.mime)) {
		throw new Error("source.mime must be JPEG, PNG, or WebP");
	}
	const width = positiveInteger(source.width, "source.width");
	const height = positiveInteger(source.height, "source.height");
	if (root.width !== undefined && root.width !== width) throw new Error("width does not match source.width");
	if (root.height !== undefined && root.height !== height) throw new Error("height does not match source.height");
	const sharedSource = {
		sourceSha256: source.sourceSha256 as string,
		imageSha256: source.imageSha256 as string,
		mime: source.mime as KoharuPageSource["mime"],
		width,
		height,
	};
	let parsedSource: KoharuPageSource;
	if (source.kind === "manga") {
		const pageId = string(source.pageId, "source.pageId", 128);
		if (!MANGA_PAGE_ID.test(pageId)) throw new Error(`invalid Shenron manga page ID: ${pageId}`);
		parsedSource = { ...sharedSource, kind: "manga", pageId };
		if (source.entityId !== undefined) parsedSource.entityId = positiveInteger(source.entityId, "source.entityId");
		if (source.plateNumber !== undefined) parsedSource.plateNumber = positiveInteger(source.plateNumber, "source.plateNumber");
	} else {
		parsedSource = {
			...sharedSource,
			kind: "databook",
			entityId: positiveInteger(source.entityId, "source.entityId"),
			plateNumber: positiveInteger(source.plateNumber, "source.plateNumber"),
		};
		if (source.pageId !== undefined) throw new Error("databook source must use entityId and plateNumber, not pageId");
	}
	if (source.url !== undefined) parsedSource.url = string(source.url, "source.url", 2048);

	if (!Array.isArray(root.regions) || root.regions.length > 500) {
		throw new Error("regions must be an array of at most 500 entries");
	}
	const ids = new Set<string>();
	const orders = new Set<number>();
	const regions = root.regions.map((raw, index): KoharuPageRegion => {
		const path = `regions[${index}]`;
		const region = record(raw, path);
		const id = string(region.id, `${path}.id`, 128);
		const label = region.label === null ? null : string(region.label, `${path}.label`, 256);
		if (!Array.isArray(region.detectionLabels) || region.detectionLabels.length > 256) {
			throw new Error(`${path}.detectionLabels must be an array of at most 256 entries`);
		}
		const detectionLabels = region.detectionLabels.map((rawLabel, labelIndex) => {
			const labelPath = `${path}.detectionLabels[${labelIndex}]`;
			const entry = record(rawLabel, labelPath);
			return {
				kind: string(entry.kind, `${labelPath}.kind`, 128),
				confidence: finite(entry.confidence, `${labelPath}.confidence`, 0, 1),
			};
		});
		if (ids.has(id)) throw new Error(`duplicate region id: ${id}`);
		ids.add(id);
		const readingOrder = region.readingOrder === null
			? null
			: positiveInteger(region.readingOrder, `${path}.readingOrder`);
		if (readingOrder !== null) {
			if (orders.has(readingOrder)) throw new Error(`duplicate reading order: ${readingOrder}`);
			orders.add(readingOrder);
		}
		const bounds = record(region.bounds, `${path}.bounds`);
		const parsedBounds = {
			x: finite(bounds.x, `${path}.bounds.x`, 0, width),
			y: finite(bounds.y, `${path}.bounds.y`, 0, height),
			width: finite(bounds.width, `${path}.bounds.width`, Number.EPSILON, width),
			height: finite(bounds.height, `${path}.bounds.height`, Number.EPSILON, height),
		};
		if (parsedBounds.x + parsedBounds.width > width || parsedBounds.y + parsedBounds.height > height) {
			throw new Error(`${path}.bounds extends outside the image`);
		}
		if (!Array.isArray(region.polygon) || region.polygon.length < 3 || region.polygon.length > 512) {
			throw new Error(`${path}.polygon must contain 3 to 512 points`);
		}
		const polygon = region.polygon.map((point, pointIndex) =>
			parsePoint(point, `${path}.polygon[${pointIndex}]`, width, height)
		);
		if (!Array.isArray(region.texts) || region.texts.length > 100) {
			throw new Error(`${path}.texts must be an array of at most 100 entries`);
		}
		const texts = region.texts.map((rawText, textIndex): KoharuPageText => {
			const textPath = `${path}.texts[${textIndex}]`;
			const text = record(rawText, textPath);
			const textOrder = text.readingOrder === null
				? null
				: positiveInteger(text.readingOrder, `${textPath}.readingOrder`);
			const parsed: KoharuPageText = {
				id: string(text.id, `${textPath}.id`, 128),
				readingOrder: textOrder,
				sourceText: nullableString(text.sourceText, `${textPath}.sourceText`),
				sourceLanguage: optionalNullableString(text.sourceLanguage, `${textPath}.sourceLanguage`) ?? null,
				targetLanguage: optionalNullableString(text.targetLanguage, `${textPath}.targetLanguage`) ?? null,
				translatedText: nullableString(text.translatedText, `${textPath}.translatedText`),
				ocrConfidence: text.ocrConfidence === null
					? null
					: finite(text.ocrConfidence, `${textPath}.ocrConfidence`, 0, 1),
				ocrProvenance: parseStageProvenance(text.ocrProvenance, `${textPath}.ocrProvenance`),
				translationProvenance: parseStageProvenance(
					text.translationProvenance,
					`${textPath}.translationProvenance`
				),
			};
			return parsed;
		});
		const detectionConfidence = region.detectionConfidence === null
			? null
			: finite(region.detectionConfidence, `${path}.detectionConfidence`, 0, 1);
		const sourceText = nullableString(region.sourceText, `${path}.sourceText`);
		const translatedText = nullableString(region.translatedText, `${path}.translatedText`);
		const sourceLanguage = optionalNullableString(region.sourceLanguage, `${path}.sourceLanguage`);
		const targetLanguage = optionalNullableString(region.targetLanguage, `${path}.targetLanguage`);
		const ocrConfidence = region.ocrConfidence === undefined || region.ocrConfidence === null
			? region.ocrConfidence
			: finite(region.ocrConfidence, `${path}.ocrConfidence`, 0, 1);
		const parsed: KoharuPageRegion = {
			id,
			kind: string(region.kind, `${path}.kind`, 80),
			label,
			readingOrder,
			detectionLabels,
			bounds: parsedBounds,
			polygon,
			detectionConfidence,
			sourceText,
			translatedText,
			texts,
			provenance: parseProvenance(region.provenance, `${path}.provenance`),
		};
		if (sourceLanguage !== undefined) parsed.sourceLanguage = sourceLanguage;
		if (targetLanguage !== undefined) parsed.targetLanguage = targetLanguage;
		if (ocrConfidence !== undefined) parsed.ocrConfidence = ocrConfidence;
		return parsed;
	});
	const pipeline = record(root.pipeline, "pipeline");
	const parsedPipeline = {
		name: string(pipeline.name, "pipeline.name", 128),
		version: string(pipeline.version, "pipeline.version", 128),
	};
	const artifacts = record(root.artifacts, "artifacts");
	const cleanupOverlaySha256 = artifacts.cleanupOverlaySha256 === null
		? null
		: string(artifacts.cleanupOverlaySha256, "artifacts.cleanupOverlaySha256", 64);
	if (cleanupOverlaySha256 !== null && !SHA256.test(cleanupOverlaySha256)) {
		throw new Error("artifacts.cleanupOverlaySha256 must be a lowercase SHA-256 digest or null");
	}
	const result: KoharuPageResultV1 = {
		schema: KOHARU_PAGE_RESULT_SCHEMA,
		source: parsedSource,
		regions,
		artifacts: { cleanupOverlaySha256 },
		pipeline: parsedPipeline,
	};
	if (root.cleanupProvenance !== undefined) {
		result.cleanupProvenance = parseStageProvenance(root.cleanupProvenance, "cleanupProvenance");
	}
	return result;
}

/** Bind a validated candidate to the exact Shenron-exported source and review image. */
export function toMangaReviewCandidateInput(
	value: unknown,
	binding: MangaCandidateBinding
): MangaReviewCandidateInput {
	const candidate = parseKoharuPageResult(value);
	if (candidate.source.kind !== "manga") throw new Error("databook result refused by the manga candidate adapter");
	if (candidate.source.pageId !== binding.id) throw new Error("candidate page does not match Shenron manifest");
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
	binding: DatabookCandidateBinding
): DatabookReviewCandidateInput {
	const candidate = parseKoharuPageResult(value);
	if (candidate.source.kind !== "databook") throw new Error("manga result refused by the databook candidate adapter");
	if (candidate.source.entityId !== binding.databookId || candidate.source.plateNumber !== binding.page) {
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

/**
 * Native Koharu scene results have no Shenron identity. The caller must obtain
 * `sourceSha256` from `page.sourceSha256` for the same page and open project.
 * The manifest alone supplies the original scan digest and editorial page ID.
 */
export interface NativeKoharuPageEvidence {
	result: unknown;
	sourceSha256: string;
}

const ENTITY_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

function nativeGeneration(value: unknown, path: string): KoharuStageProvenance | null {
	return parseStageProvenance(value, path);
}

function nativeImageMime(image: string): KoharuPageSource["mime"] {
	if (/\.jpe?g$/i.test(image)) return "image/jpeg";
	if (/\.png$/i.test(image)) return "image/png";
	if (/\.webp$/i.test(image)) return "image/webp";
	throw new Error("Shenron manifest image needs a supported, explicit image extension");
}

/** Map native scene fields without assigning Shenron identity or editorial status. */
export function mapNativeKoharuPageResult(
	evidence: NativeKoharuPageEvidence,
	source: KoharuPageSource
): KoharuPageResultV1 {
	if (!SHA256.test(evidence.sourceSha256) || evidence.sourceSha256 !== source.imageSha256) {
		throw new Error("native Koharu page source blob hash does not match Shenron review image");
	}
	const native = record(evidence.result, "native page result");
	const page = string(native.page, "native page result.page", 64);
	if (!ENTITY_ID.test(page)) throw new Error("native Koharu page ID must be a UUID");
	const width = positiveInteger(native.width, "native page result.width");
	const height = positiveInteger(native.height, "native page result.height");
	if (width !== source.width || height !== source.height) {
		throw new Error("native Koharu page dimensions do not match bound source dimensions");
	}
	if (!Array.isArray(native.regions) || native.regions.length > 500) {
		throw new Error("native regions must be an array of at most 500 entries");
	}
	const regions = native.regions.map((value, index): KoharuPageRegion => {
		const path = `native regions[${index}]`;
		const region = record(value, path);
		const rawBounds = region.bounds;
		if (!Array.isArray(rawBounds) || rawBounds.length !== 4) throw new Error(`${path}.bounds must have four coordinates`);
		const [left, top, right, bottom] = rawBounds.map((coordinate, n) => finite(coordinate, `${path}.bounds[${n}]`));
		if (!Array.isArray(region.polygon)) throw new Error(`${path}.polygon must be an array`);
		if (!Array.isArray(region.detection_labels)) throw new Error(`${path}.detection_labels must be an array`);
		if (!Array.isArray(region.texts)) throw new Error(`${path}.texts must be an array`);
		const texts = region.texts.map((value, textIndex): KoharuPageText => {
			const textPath = `${path}.texts[${textIndex}]`;
			const text = record(value, textPath);
			const readingOrder = text.reading_order === null
				? null
				: finite(text.reading_order, `${textPath}.reading_order`, 0);
			if (readingOrder !== null && !Number.isSafeInteger(readingOrder)) {
				throw new Error(`${textPath}.reading_order must be an integer`);
			}
			return {
				id: string(text.id, `${textPath}.id`, 128),
				readingOrder: readingOrder === null ? null : readingOrder + 1,
				sourceText: nullableString(text.source, `${textPath}.source`),
				sourceLanguage: nullableString(text.source_language, `${textPath}.source_language`),
				ocrConfidence: text.ocr_confidence === null ? null : finite(text.ocr_confidence, `${textPath}.ocr_confidence`, 0, 1),
				ocrProvenance: nativeGeneration(text.ocr_provenance, `${textPath}.ocr_provenance`),
				translatedText: nullableString(text.translation, `${textPath}.translation`),
				targetLanguage: nullableString(text.target_language, `${textPath}.target_language`),
				translationProvenance: nativeGeneration(text.translation_provenance, `${textPath}.translation_provenance`),
			};
		});
		const ordered = texts.map((text) => text.readingOrder).filter((order): order is number => order !== null);
		return {
			id: string(region.id, `${path}.id`, 128),
			kind: string(region.kind, `${path}.kind`, 80),
			label: nullableString(region.label, `${path}.label`, 256),
			readingOrder: ordered.length ? Math.min(...ordered) : null,
			detectionLabels: region.detection_labels.map((value, labelIndex) => {
				const label = record(value, `${path}.detection_labels[${labelIndex}]`);
				return {
					kind: string(label.kind, `${path}.detection_labels[${labelIndex}].kind`, 128),
					confidence: finite(label.confidence, `${path}.detection_labels[${labelIndex}].confidence`, 0, 1),
				};
			}),
			bounds: { x: left, y: top, width: right - left, height: bottom - top },
			polygon: region.polygon.map((point, pointIndex) => parsePoint(point, `${path}.polygon[${pointIndex}]`, width, height)),
			detectionConfidence: region.confidence === null ? null : finite(region.confidence, `${path}.confidence`, 0, 1),
			sourceText: null,
			translatedText: null,
			texts,
			provenance: {
				detection: nativeGeneration(region.detection_provenance, `${path}.detection_provenance`),
				ocr: null,
				translation: null,
			},
		};
	});
	let cleanupOverlaySha256: string | null = null;
	if (native.cleanup_layer_png !== null) {
		if (!Array.isArray(native.cleanup_layer_png) || native.cleanup_layer_png.length > 100_000_000 ||
			native.cleanup_layer_png.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) {
			throw new Error("native cleanup layer must be PNG bytes below 100 MB");
		}
		cleanupOverlaySha256 = new Bun.CryptoHasher("sha256").update(Uint8Array.from(native.cleanup_layer_png)).digest("hex");
	}
	const mapped = {
		schema: KOHARU_PAGE_RESULT_SCHEMA,
		source,
		regions,
		artifacts: { cleanupOverlaySha256 },
		pipeline: { name: "koharu-native-page-result", version: "1" },
		cleanupProvenance: nativeGeneration(native.cleanup_provenance, "native cleanup_provenance"),
	};
	return parseKoharuPageResult(mapped);
}

export function toNativeMangaReviewCandidateInput(
	evidence: NativeKoharuPageEvidence,
	binding: MangaCandidateBinding,
	mime = nativeImageMime(binding.image),
	width?: number,
	height?: number
): MangaReviewCandidateInput {
	const native = record(evidence.result, "native page result");
	const source: KoharuMangaPageSource = {
		kind: "manga", pageId: binding.id, sourceSha256: binding.sourceSha256,
		imageSha256: binding.imageSha256, mime,
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
	height?: number
): DatabookReviewCandidateInput {
	const native = record(evidence.result, "native page result");
	const source: KoharuDatabookPageSource = {
		kind: "databook", entityId: binding.databookId, plateNumber: binding.page,
		sourceSha256: binding.sourceSha256, imageSha256: binding.imageSha256, mime,
		width: width ?? positiveInteger(native.width, "native page result.width"),
		height: height ?? positiveInteger(native.height, "native page result.height"),
	};
	return toDatabookReviewCandidateInput(mapNativeKoharuPageResult(evidence, source), binding);
}
