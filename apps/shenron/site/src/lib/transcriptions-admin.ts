import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { assertDatabooksWritable } from "./databooks-freeze";
import {
	progressionTranscription,
	etatPipelinesLocaux,
	mangaUploadStatus,
	type MangaUploadSerie,
	type EtatPipelinesLocaux,
} from "./databooks-transcription";

export interface TranscriptionsOverview {
	databooks: {
		totalBooks: number;
		totalPages: number;
		transcribedPages: number;
		translatedPages: number;
		defectivePages: number;
		missingScans: number;
		japaneseChars: number;
		frenchChars: number;
		transcriptionRate: number;
		translationRate: number;
	};
	manga: {
		totalChapters: number;
		totalPages: number;
		ocrPages: number;
		ocrWithText: number;
		seriesBreakdown: MangaUploadSerie[];
	};
	localPipelines: EtatPipelinesLocaux;
}

export interface DefectivePlateItem {
	databookId: number;
	databookTitle: string;
	pageNumber: number;
	image: string | null;
	textJa: string | null;
	textFr: string | null;
	verified: boolean;
	defectKind: "empty" | "loop" | "short" | "foreign" | "han-sans-kana" | "unknown";
	charCount: number;
}

/**
 * Returns comprehensive statistics combining Databooks (JA & FR) and Manga OCR.
 */
export async function getTranscriptionsOverview(): Promise<TranscriptionsOverview> {
	const [databooksProgression, localPipelines, mangaStatus] = await Promise.all([
		progressionTranscription(),
		etatPipelinesLocaux(),
		mangaUploadStatus(),
	]);

	// Aggregate French translations and missing scans across all databooks
	const translatedAndScanStats = await db.execute<{
		translated_pages: number;
		missing_scans: number;
		french_chars: number;
	}>(sql`
		SELECT
			coalesce(sum(CASE WHEN elem ->> 'text_fr' IS NOT NULL AND length(trim(elem ->> 'text_fr')) > 0 THEN 1 ELSE 0 END), 0)::int AS translated_pages,
			coalesce(sum(CASE WHEN elem ->> 'image' IS NULL OR trim(elem ->> 'image') = '' THEN 1 ELSE 0 END), 0)::int AS missing_scans,
			coalesce(sum(CASE WHEN elem ->> 'text_fr' IS NOT NULL THEN length(elem ->> 'text_fr') ELSE 0 END), 0)::int AS french_chars
		FROM bot.db_databooks d
		CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(d.pages) = 'array' THEN d.pages ELSE '[]'::jsonb END) elem
	`);

	const extraStats = translatedAndScanStats[0] ?? {
		translated_pages: 0,
		missing_scans: 0,
		french_chars: 0,
	};

	const totalPages = databooksProgression.total.planches;
	const transcribedPages = databooksProgression.total.transcrites;
	const translatedPages = extraStats.translated_pages;

	return {
		databooks: {
			totalBooks: databooksProgression.total.fiches,
			totalPages,
			transcribedPages,
			translatedPages,
			defectivePages: databooksProgression.total.fautives,
			missingScans: extraStats.missing_scans,
			japaneseChars: databooksProgression.total.signes,
			frenchChars: extraStats.french_chars,
			transcriptionRate: totalPages > 0 ? Math.round((transcribedPages / totalPages) * 100) : 0,
			translationRate:
				transcribedPages > 0 ? Math.round((translatedPages / transcribedPages) * 100) : 0,
		},
		manga: {
			totalChapters: mangaStatus.chapitres,
			totalPages: mangaStatus.planches,
			ocrPages: mangaStatus.ocrPlanches,
			ocrWithText: mangaStatus.ocrPlanchesAvecTexte,
			seriesBreakdown: mangaStatus.series,
		},
		localPipelines,
	};
}

/**
 * Lists plates that require human attention (defective OCR, loops, empty, or unverified).
 */
export async function getDefectivePlates(options?: {
	limit?: number;
	offset?: number;
	databookId?: number;
	filterKind?: string;
}): Promise<{ items: DefectivePlateItem[]; total: number }> {
	const limit = options?.limit ?? 50;
	const offset = options?.offset ?? 0;
	const databookId = options?.databookId;

	const idFilterClause = databookId ? sql`AND d.id = ${databookId}` : sql``;

	const rows = await db.execute<{
		databook_id: number;
		databook_title: string;
		page_number: number;
		image: string | null;
		text_ja: string | null;
		text_fr: string | null;
		verified: boolean;
		char_count: number;
		total_count: number;
	}>(sql`
		WITH expanded_pages AS (
			SELECT
				d.id AS databook_id,
				d.title AS databook_title,
				(elem ->> 'number')::int AS page_number,
				elem ->> 'image' AS image,
				elem ->> 'text' AS text_ja,
				elem ->> 'text_fr' AS text_fr,
				coalesce((elem ->> 'verifiee')::boolean, false) AS verified,
				length(coalesce(elem ->> 'text', '')) AS char_count
			FROM bot.db_databooks d,
			jsonb_array_elements(CASE WHEN jsonb_typeof(d.pages) = 'array' THEN d.pages ELSE '[]'::jsonb END) elem
			WHERE 1=1 ${idFilterClause}
		)
		SELECT
			*,
			count(*) OVER()::int AS total_count
		FROM expanded_pages
		WHERE verified = false
		  AND (
			-- Defective regex matches (surrogates, non-kana ideograms, replacement chars)
			text_ja ~ '[\uFFFD\u0400-\u04FF\u0600-\u06FF\u0E00-\u0E7F\uAC00-\uD7AF]'
			OR (length(text_ja) > 20 AND text_ja !~ '[\u3040-\u309F\u30A0-\u30FF]')
			OR length(text_ja) < 10
			OR text_ja IS NULL
			OR trim(text_ja) = ''
		  )
		ORDER BY databook_id ASC, page_number ASC
		LIMIT ${limit} OFFSET ${offset}
	`);

	const items: DefectivePlateItem[] = rows.map((r) => {
		let defectKind: DefectivePlateItem["defectKind"] = "unknown";
		const text = r.text_ja ?? "";
		if (!text.trim()) {
			defectKind = "empty";
		} else if (text.length < 10) {
			defectKind = "short";
		} else if (!/[\u3040-\u309F\u30A0-\u30FF]/.test(text) && text.length > 20) {
			defectKind = "han-sans-kana";
		} else if (/[\u0400-\u04FF\u0600-\u06FF\u0E00-\u0E7F\uAC00-\uD7AF]/.test(text)) {
			defectKind = "foreign";
		}

		return {
			databookId: r.databook_id,
			databookTitle: r.databook_title,
			pageNumber: r.page_number,
			image: r.image,
			textJa: r.text_ja,
			textFr: r.text_fr,
			verified: r.verified,
			defectKind,
			charCount: r.char_count,
		};
	});

	const total = rows[0]?.total_count ?? 0;
	return { items, total };
}

/**
 * Batch marks specified plates as verified or updates their status.
 */
export async function batchVerifyPlates(
	plates: Array<{ databookId: number; pageNumber: number }>
): Promise<{ updated: number }> {
	assertDatabooksWritable();
	let updated = 0;
	const byBook = new Map<number, number[]>();
	for (const p of plates) {
		const existing = byBook.get(p.databookId) ?? [];
		existing.push(p.pageNumber);
		byBook.set(p.databookId, existing);
	}

	for (const [databookId, pageNumbers] of byBook.entries()) {
		const pagesJson = JSON.stringify(pageNumbers);
		await db.execute(sql`
			UPDATE bot.db_databooks
			SET pages = (
				SELECT jsonb_agg(
					CASE
						WHEN (elem ->> 'number')::int = ANY(ARRAY(SELECT jsonb_array_elements_text(${pagesJson}::jsonb)::int))
						THEN jsonb_set(elem, '{verifiee}', 'true'::jsonb, true)
						ELSE elem
					END
				)
				FROM jsonb_array_elements(CASE WHEN jsonb_typeof(pages) = 'array' THEN pages ELSE '[]'::jsonb END) elem
			)
			WHERE id = ${databookId}
		`);
		updated += pageNumbers.length;
	}

	return { updated };
}

export interface GpuBatchItem {
	lotId: string;
	type: "manga" | "databooks";
	count: number;
	path: string;
	status: "ready" | "in_progress" | "completed";
	details?: string;
}

export interface LexiconOverviewItem {
	ja: string;
	fr: string;
	kind: string;
	length: number;
}

/**
 * Returns available GPU OCR batches and VPS translation batches from disk.
 */
export async function getBatchesOverview(): Promise<{
	gpuBatches: GpuBatchItem[];
	translationBatches: Array<{
		lotId: string;
		count: number;
		path: string;
		status: "ready" | "in_progress" | "completed";
	}>;
}> {
	const { existsSync, readdirSync, readFileSync } = await import("node:fs");
	const { isAbsolute, join, resolve } = await import("node:path");

	const gpuBatches: GpuBatchItem[] = [];
	const translationBatches: Array<{
		lotId: string;
		count: number;
		path: string;
		status: "ready" | "in_progress" | "completed";
	}> = [];

	// 1. Databooks OCR batches (data/databooks-ocr/lots)
	const dbOcrDir = join(process.cwd(), "..", "..", "data", "databooks-ocr", "lots");
	const altDbOcrDir = join(process.cwd(), "data", "databooks-ocr", "lots");
	const targetOcrDir = existsSync(dbOcrDir) ? dbOcrDir : existsSync(altDbOcrDir) ? altDbOcrDir : null;

	if (targetOcrDir) {
		try {
			const indexPath = join(targetOcrDir, "index-manifest.json");
			if (existsSync(indexPath)) {
				const manifest = JSON.parse(readFileSync(indexPath, "utf-8"));
				if (Array.isArray(manifest)) {
					for (const item of manifest) {
						const fileName = typeof item.file === "string" ? item.file.split(/[\\/]/).at(-1) : null;
						const batchPath = fileName
							? resolve(targetOcrDir, fileName)
							: isAbsolute(item.file)
								? item.file
								: resolve(/* turbopackIgnore: true */ process.cwd(), item.file);
						gpuBatches.push({
							lotId: item.lotId,
							type: "databooks",
							count: item.count,
							path: batchPath,
							status: "ready",
							details: `${item.firstBook} ➔ ${item.lastBook}`,
						});
					}
				}
			}
		} catch (e) {
			console.warn("Erreur lecture lots databooks OCR:", e);
		}
	}

	// 2. Translation batches (data/databooks-translation/lots)
	const tradDir = join(process.cwd(), "..", "..", "data", "databooks-translation", "lots");
	const altTradDir = join(process.cwd(), "data", "databooks-translation", "lots");
	const targetTradDir = existsSync(tradDir) ? tradDir : existsSync(altTradDir) ? altTradDir : null;

	if (targetTradDir) {
		try {
			const files = readdirSync(targetTradDir).filter((f) => f.endsWith(".jsonl"));
			for (const f of files) {
				const filePath = join(targetTradDir, f);
				const content = readFileSync(filePath, "utf-8");
				const lines = content.split("\n").filter((l) => l.trim().length > 0);
				translationBatches.push({
					lotId: f.replace(".jsonl", ""),
					count: lines.length,
					path: filePath,
					status: "ready",
				});
			}
		} catch (e) {
			console.warn("Erreur lecture lots traduction:", e);
		}
	}

	return { gpuBatches, translationBatches };
}

/**
 * Returns canonical lexicon items with optional search query and category filter.
 */
export async function getCanonLexiconOverview(options?: {
	query?: string;
	kind?: string;
	limit?: number;
}): Promise<{
	items: LexiconOverviewItem[];
	total: number;
	stats: Record<string, number>;
}> {
	const { existsSync, readFileSync } = await import("node:fs");
	const { join } = await import("node:path");

	const paths = [
		join(process.cwd(), "..", "..", "data", "lexique-db-canonique.json"),
		join(process.cwd(), "data", "lexique-db-canonique.json"),
	];

	let allEntries: LexiconOverviewItem[] = [];
	for (const p of paths) {
		if (existsSync(/* turbopackIgnore: true */ p)) {
			try {
				allEntries = JSON.parse(readFileSync(/* turbopackIgnore: true */ p, "utf-8"));
				break;
			} catch  {
				// skip
			}
		}
	}

	const stats: Record<string, number> = {};
	for (const entry of allEntries) {
		stats[entry.kind] = (stats[entry.kind] ?? 0) + 1;
	}

	let filtered = allEntries;
	if (options?.kind && options.kind !== "all") {
		filtered = filtered.filter((e) => e.kind === options.kind);
	}
	if (options?.query) {
		const q = options.query.toLowerCase();
		filtered = filtered.filter(
			(e) => e.ja.toLowerCase().includes(q) || e.fr.toLowerCase().includes(q)
		);
	}

	const limit = options?.limit ?? 50;
	return {
		items: filtered.slice(0, limit),
		total: filtered.length,
		stats,
	};
}
