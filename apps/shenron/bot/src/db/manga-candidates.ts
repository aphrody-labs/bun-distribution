// SPDX-License-Identifier: Apache-2.0
/**
 * File de revue Koharu → Shenron (`shenron.manga.review-candidate/v1`).
 *
 * Les candidats Koharu sont des données non fiables : ils sont validés par le
 * parseur de `@shenron/pipeline` (même contrat que la sortie Koharu), stockés
 * dans le SQLite du bot (`data/bot.db`, création idempotente comme les autres
 * tables runtime de `DatabaseService`) et n'ont aucun effet éditorial tant
 * qu'un membre du staff ne les a pas approuvés puis publiés.
 *
 * Unicité : un candidat est identifié par le SHA-256 de son JSON canonique
 * (clés triées), si bien qu'un même résultat déposé deux fois ne crée qu'une
 * ligne.
 */
import type { Database } from "bun:sqlite";
import {
	KOHARU_PAGE_RESULT_SCHEMA,
	SHENRON_MANGA_CANDIDATE_SCHEMA,
	parseKoharuPageResult,
	type MangaReviewCandidateInput,
} from "@shenron/pipeline";

export type MangaCandidateStatus = "unreviewed" | "approved" | "rejected" | "published";
export const MANGA_CANDIDATE_STATUSES: readonly MangaCandidateStatus[] = [
	"unreviewed",
	"approved",
	"rejected",
	"published",
];

export interface MangaCandidateRow {
	id: number;
	pageId: string;
	candidateHash: string;
	payload: MangaReviewCandidateInput;
	status: MangaCandidateStatus;
	reviewer: string | null;
	createdAt: number;
	updatedAt: number;
	reviewedAt: number | null;
	publishedAt: number | null;
}

/** Paire bulle source → traduction, dans l'ordre de lecture. */
export interface MangaTranslationPair {
	regionId: string;
	textId: string | null;
	readingOrder: number | null;
	sourceText: string | null;
	sourceLanguage: string | null;
	translatedText: string;
	targetLanguage: string | null;
}

export interface PublishedMangaTranslation {
	pageId: string;
	candidateId: number;
	targetLanguage: string | null;
	pairs: MangaTranslationPair[];
	publishedBy: string;
	publishedAt: number;
}

const MANGA_PAGE_ID = /^(DB|DBS):(?:vol|t|ch)[0-9]+:[1-9][0-9]*$/;
const MAX_PAYLOAD_BYTES = 2 * 1024 * 1024;

const SCHEMA_SQL = `
	CREATE TABLE IF NOT EXISTS manga_candidates (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		page_id TEXT NOT NULL,
		candidate_hash TEXT NOT NULL UNIQUE,
		payload TEXT NOT NULL,
		status TEXT NOT NULL DEFAULT 'unreviewed'
			CHECK (status IN ('unreviewed', 'approved', 'rejected', 'published')),
		reviewer TEXT,
		created_at INTEGER NOT NULL,
		updated_at INTEGER NOT NULL,
		reviewed_at INTEGER,
		published_at INTEGER
	);
	CREATE INDEX IF NOT EXISTS idx_manga_candidates_status ON manga_candidates(status, id);
	CREATE INDEX IF NOT EXISTS idx_manga_candidates_page ON manga_candidates(page_id);
	CREATE TABLE IF NOT EXISTS manga_planche_translations (
		page_id TEXT PRIMARY KEY,
		candidate_id INTEGER NOT NULL REFERENCES manga_candidates(id),
		target_language TEXT,
		pairs TEXT NOT NULL,
		published_by TEXT NOT NULL,
		published_at INTEGER NOT NULL
	);
`;

const ensured = new WeakSet<Database>();

/** Crée les tables de revue (idempotent, une fois par connexion). */
export function ensureMangaCandidateTables(sqlite: Database): void {
	if (ensured.has(sqlite)) return;
	sqlite.exec(SCHEMA_SQL);
	ensured.add(sqlite);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Valide un candidat `shenron.manga.review-candidate/v1`. La partie Koharu
 * (source, régions, artefacts, pipeline) passe par `parseKoharuPageResult`.
 */
export function parseMangaReviewCandidate(value: unknown): MangaReviewCandidateInput {
	if (!isRecord(value)) throw new Error("candidate must be an object");
	if (value.schema !== SHENRON_MANGA_CANDIDATE_SCHEMA) {
		throw new Error(`unsupported candidate schema: ${String(value.schema)}`);
	}
	if (value.decision !== "unreviewed") throw new Error("candidate decision must be 'unreviewed'");
	const pageId = value.pageId;
	if (typeof pageId !== "string" || !MANGA_PAGE_ID.test(pageId)) {
		throw new Error("candidate pageId is not a Shenron manga page id");
	}
	if (typeof value.image !== "string" || !value.image.trim() || value.image.length > 1024) {
		throw new Error("candidate image must be a non-empty string");
	}
	const page = parseKoharuPageResult({
		schema: KOHARU_PAGE_RESULT_SCHEMA,
		source: value.source,
		regions: value.regions,
		artifacts: value.artifacts,
		pipeline: value.pipeline,
		...(value.cleanupProvenance !== undefined
			? { cleanupProvenance: value.cleanupProvenance }
			: {}),
	});
	if (page.source.kind !== "manga") throw new Error("candidate source must be a manga page");
	if (page.source.pageId !== pageId) throw new Error("candidate pageId does not match its source");
	return {
		schema: SHENRON_MANGA_CANDIDATE_SCHEMA,
		pageId,
		image: value.image,
		source: page.source,
		regions: page.regions,
		artifacts: page.artifacts,
		pipeline: page.pipeline,
		...(page.cleanupProvenance !== undefined ? { cleanupProvenance: page.cleanupProvenance } : {}),
		...(value.ocr !== undefined ? { ocr: value.ocr as MangaReviewCandidateInput["ocr"] } : {}),
		decision: "unreviewed",
	};
}

/** JSON canonique (clés triées récursivement). */
export function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (isRecord(value)) {
		return `{${Object.keys(value)
			.filter((key) => value[key] !== undefined)
			.toSorted()
			.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
			.join(",")}}`;
	}
	return JSON.stringify(value) ?? "null";
}

export function candidateHash(candidate: MangaReviewCandidateInput): string {
	return new Bun.CryptoHasher("sha256").update(canonicalJson(candidate)).digest("hex");
}

interface RawRow {
	id: number;
	page_id: string;
	candidate_hash: string;
	payload: string;
	status: MangaCandidateStatus;
	reviewer: string | null;
	created_at: number;
	updated_at: number;
	reviewed_at: number | null;
	published_at: number | null;
}

function toRow(raw: RawRow): MangaCandidateRow {
	return {
		id: raw.id,
		pageId: raw.page_id,
		candidateHash: raw.candidate_hash,
		payload: JSON.parse(raw.payload) as MangaReviewCandidateInput,
		status: raw.status,
		reviewer: raw.reviewer,
		createdAt: raw.created_at,
		updatedAt: raw.updated_at,
		reviewedAt: raw.reviewed_at,
		publishedAt: raw.published_at,
	};
}

/** Dépose un candidat validé ; un doublon (même hash) renvoie la ligne existante. */
export function insertMangaCandidate(
	sqlite: Database,
	value: unknown,
	now: number = Date.now()
): { candidate: MangaCandidateRow; created: boolean } {
	ensureMangaCandidateTables(sqlite);
	const candidate = parseMangaReviewCandidate(value);
	const payload = JSON.stringify(candidate);
	if (payload.length > MAX_PAYLOAD_BYTES) throw new Error("candidate payload is too large");
	const hash = candidateHash(candidate);
	const inserted = sqlite
		.query<RawRow, [string, string, string, number, number]>(
			`INSERT INTO manga_candidates (page_id, candidate_hash, payload, status, created_at, updated_at)
			 VALUES (?, ?, ?, 'unreviewed', ?, ?)
			 ON CONFLICT(candidate_hash) DO NOTHING
			 RETURNING *`
		)
		.get(candidate.pageId, hash, payload, now, now);
	if (inserted) return { candidate: toRow(inserted), created: true };
	const existing = sqlite
		.query<RawRow, [string]>("SELECT * FROM manga_candidates WHERE candidate_hash = ?")
		.get(hash);
	if (!existing) throw new Error("candidate insert failed");
	return { candidate: toRow(existing), created: false };
}

export function getMangaCandidate(sqlite: Database, id: number): MangaCandidateRow | null {
	ensureMangaCandidateTables(sqlite);
	const raw = sqlite
		.query<RawRow, [number]>("SELECT * FROM manga_candidates WHERE id = ?")
		.get(id);
	return raw ? toRow(raw) : null;
}

export function listMangaCandidates(
	sqlite: Database,
	options: { status?: MangaCandidateStatus; limit?: number; offset?: number } = {}
): MangaCandidateRow[] {
	ensureMangaCandidateTables(sqlite);
	const limit = Math.min(Math.max(Math.trunc(options.limit ?? 50), 1), 200);
	const offset = Math.max(Math.trunc(options.offset ?? 0), 0);
	const rows = options.status
		? sqlite
				.query<RawRow, [string, number, number]>(
					"SELECT * FROM manga_candidates WHERE status = ? ORDER BY id LIMIT ? OFFSET ?"
				)
				.all(options.status, limit, offset)
		: sqlite
				.query<RawRow, [number, number]>(
					"SELECT * FROM manga_candidates ORDER BY id LIMIT ? OFFSET ?"
				)
				.all(limit, offset);
	return rows.map(toRow);
}

export function countMangaCandidates(sqlite: Database, status: MangaCandidateStatus): number {
	ensureMangaCandidateTables(sqlite);
	return (
		sqlite
			.query<{ n: number }, [string]>("SELECT count(*) AS n FROM manga_candidates WHERE status = ?")
			.get(status)?.n ?? 0
	);
}

/**
 * Transition conditionnelle (compare-and-set) : ne modifie la ligne que si son
 * statut courant est dans `from`. Renvoie la ligne mise à jour, ou `null`.
 */
export function transitionMangaCandidate(
	sqlite: Database,
	id: number,
	from: readonly MangaCandidateStatus[],
	to: MangaCandidateStatus,
	reviewer: string,
	now: number = Date.now()
): MangaCandidateRow | null {
	ensureMangaCandidateTables(sqlite);
	const placeholders = from.map(() => "?").join(", ");
	const raw = sqlite
		.query<RawRow, (string | number)[]>(
			`UPDATE manga_candidates SET
				status = ?, reviewer = ?, updated_at = ?,
				reviewed_at = CASE WHEN ? IN ('approved', 'rejected') THEN ? ELSE reviewed_at END,
				published_at = CASE WHEN ? = 'published' THEN ? ELSE published_at END
			 WHERE id = ? AND status IN (${placeholders})
			 RETURNING *`
		)
		.get(to, reviewer, now, to, now, to, now, id, ...from);
	return raw ? toRow(raw) : null;
}

/** Paires source → traduction non vides, dans l'ordre de lecture. */
export function extractTranslationPairs(candidate: MangaReviewCandidateInput): MangaTranslationPair[] {
	const pairs: (MangaTranslationPair & { regionIndex: number })[] = [];
	candidate.regions.forEach((region, regionIndex) => {
		const texts = region.texts.filter((t) => t.translatedText?.trim());
		if (texts.length > 0) {
			for (const t of texts) {
				pairs.push({
					regionIndex,
					regionId: region.id,
					textId: t.id,
					readingOrder: t.readingOrder ?? region.readingOrder,
					sourceText: t.sourceText,
					sourceLanguage: t.sourceLanguage,
					translatedText: (t.translatedText ?? "").trim(),
					targetLanguage: t.targetLanguage,
				});
			}
		} else if (region.translatedText?.trim()) {
			pairs.push({
				regionIndex,
				regionId: region.id,
				textId: null,
				readingOrder: region.readingOrder,
				sourceText: region.sourceText,
				sourceLanguage: region.sourceLanguage ?? null,
				translatedText: region.translatedText.trim(),
				targetLanguage: region.targetLanguage ?? null,
			});
		}
	});
	pairs.sort(
		(a, b) =>
			(a.readingOrder ?? Number.MAX_SAFE_INTEGER) - (b.readingOrder ?? Number.MAX_SAFE_INTEGER) ||
			a.regionIndex - b.regionIndex
	);
	return pairs.map(({ regionIndex: _, ...pair }) => pair);
}

export function getPublishedMangaTranslation(
	sqlite: Database,
	pageId: string
): PublishedMangaTranslation | null {
	ensureMangaCandidateTables(sqlite);
	const raw = sqlite
		.query<
			{
				page_id: string;
				candidate_id: number;
				target_language: string | null;
				pairs: string;
				published_by: string;
				published_at: number;
			},
			[string]
		>("SELECT * FROM manga_planche_translations WHERE page_id = ?")
		.get(pageId);
	if (!raw) return null;
	return {
		pageId: raw.page_id,
		candidateId: raw.candidate_id,
		targetLanguage: raw.target_language,
		pairs: JSON.parse(raw.pairs) as MangaTranslationPair[],
		publishedBy: raw.published_by,
		publishedAt: raw.published_at,
	};
}

/** Enregistre (remplace) la traduction publiée d'une planche. */
export function upsertMangaPlancheTranslation(
	sqlite: Database,
	translation: PublishedMangaTranslation
): void {
	ensureMangaCandidateTables(sqlite);
	sqlite
		.query(
			`INSERT INTO manga_planche_translations
				(page_id, candidate_id, target_language, pairs, published_by, published_at)
			 VALUES (?, ?, ?, ?, ?, ?)
			 ON CONFLICT(page_id) DO UPDATE SET
				candidate_id = excluded.candidate_id, target_language = excluded.target_language,
				pairs = excluded.pairs, published_by = excluded.published_by,
				published_at = excluded.published_at`
		)
		.run(
			translation.pageId,
			translation.candidateId,
			translation.targetLanguage,
			JSON.stringify(translation.pairs),
			translation.publishedBy,
			translation.publishedAt
		);
}

export function isMangaPageId(value: string): boolean {
	return MANGA_PAGE_ID.test(value);
}
