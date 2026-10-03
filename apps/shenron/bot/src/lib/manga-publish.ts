// SPDX-License-Identifier: Apache-2.0
/**
 * Écritures manga réutilisables.
 *
 * - `writeMangaTranscriptions` : dépôt verrouillé des transcriptions OCR dans
 *   PostgreSQL (`bot.db_manga_pages`) avec révision réversible par planche
 *   (extrait de `scripts/deposit-manga-transcriptions.ts`, comportement
 *   inchangé : verrou de table, `FOR UPDATE`, remplissage des cases vides sauf
 *   `replace`).
 * - `approveAndPublishMangaCandidate` : approbation staff d'un candidat Koharu
 *   puis publication de ses textes traduits comme traduction de la planche.
 */
import type { Database } from "bun:sqlite";
import type postgres from "postgres";
import type { ParsedMangaPage } from "@shenron/pipeline/manga-ocr";
import {
	extractTranslationPairs,
	getMangaCandidate,
	transitionMangaCandidate,
	upsertMangaPlancheTranslation,
	type MangaCandidateRow,
	type PublishedMangaTranslation,
} from "~/db/manga-candidates";

interface ExistingPage {
	id: string;
	series: string | null;
	tome: string | null;
	planche: string | null;
	lines: string | null;
	text: string | null;
	lang: string | null;
	has_ja: string | null;
	line_count: string | null;
	char_count: string | null;
}

function snapshot(page: ExistingPage | null): Record<string, unknown> | null {
	if (!page) return null;
	return {
		series: page.series,
		tome: page.tome,
		planche: Number(page.planche),
		lines: page.lines,
		text: page.text,
		lang: page.lang,
		hasJa: Number(page.has_ja) !== 0,
		lineCount: Number(page.line_count),
		charCount: Number(page.char_count),
	};
}

function afterSnapshot(page: ParsedMangaPage): Record<string, unknown> {
	return {
		series: page.entry.series,
		tome: page.entry.tome,
		planche: page.entry.planche,
		lines: JSON.stringify(page.lines),
		text: page.text,
		lang: page.lang,
		hasJa: page.hasJa,
		lineCount: page.lines.length,
		charCount: page.text.length,
	};
}

function revisionId(): string {
	return crypto.randomUUID().replaceAll("-", "").slice(0, 24);
}

export interface MangaTranscriptionWriteOptions {
	/** Remplace un texte existant différent (sinon conflit protégé). */
	replace: boolean;
	/** Auteur affiché dans `public.wiki_revisions`. */
	editorName: string;
	editorId?: string;
}

export interface MangaTranscriptionWriteResult {
	inserted: number;
	updated: number;
	unchanged: number;
	conflicts: number;
}

/**
 * Écrit des planches OCR dans `bot.db_manga_pages` à l'intérieur d'UNE
 * transaction déjà ouverte (`sql.begin(tx => …)`).
 */
export async function writeMangaTranscriptions(
	tx: postgres.TransactionSql,
	pages: readonly ParsedMangaPage[],
	options: MangaTranscriptionWriteOptions
): Promise<MangaTranscriptionWriteResult> {
	const result: MangaTranscriptionWriteResult = { inserted: 0, updated: 0, unchanged: 0, conflicts: 0 };
	await tx`LOCK TABLE bot.db_manga_pages IN SHARE ROW EXCLUSIVE MODE`;
	const [{ maxId }] = await tx<
		{ maxId: string }[]
	>`SELECT coalesce(max(id), 0)::text AS "maxId" FROM bot.db_manga_pages`;
	let nextId = Number(maxId);
	for (const page of pages) {
		const [before] = await tx<ExistingPage[]>`
			SELECT id::text, series, tome, planche::text, lines, text, lang,
				has_ja::text, line_count::text, char_count::text
			FROM bot.db_manga_pages
			WHERE series = ${page.entry.series} AND tome = ${page.entry.tome} AND planche = ${page.entry.planche}
			FOR UPDATE`;
		if (before?.text?.trim() === page.text) {
			result.unchanged++;
			continue;
		}
		if (before?.text?.trim() && !options.replace) {
			result.conflicts++;
			continue;
		}
		const rowId = before?.id ?? String(++nextId);
		if (before) {
			await tx`
				UPDATE bot.db_manga_pages SET
					lines = ${JSON.stringify(page.lines)}, text = ${page.text}, lang = ${page.lang},
					has_ja = ${page.hasJa ? 1 : 0}, line_count = ${page.lines.length}, char_count = ${page.text.length}
				WHERE id = ${Number(rowId)}`;
			result.updated++;
		} else {
			await tx`
				INSERT INTO bot.db_manga_pages
					(id, series, tome, planche, lines, text, lang, has_ja, line_count, char_count)
				VALUES (${Number(rowId)}, ${page.entry.series}, ${page.entry.tome}, ${page.entry.planche},
					${JSON.stringify(page.lines)}, ${page.text}, ${page.lang}, ${page.hasJa ? 1 : 0},
					${page.lines.length}, ${page.text.length})`;
			result.inserted++;
		}
		const beforeValue = snapshot(before ?? null);
		const afterValue = afterSnapshot(page);
		await tx`INSERT INTO public.wiki_revisions ${tx({
			id: revisionId(),
			tableName: "db_manga_pages",
			rowId,
			action: before ? "update" : "create",
			label: `${page.entry.series} ${page.entry.tome} — planche ${page.entry.planche}`,
			before: beforeValue === null ? null : tx.json(beforeValue as Parameters<typeof tx.json>[0]),
			after: tx.json(afterValue as Parameters<typeof tx.json>[0]),
			editorId: options.editorId ?? "agent",
			editorName: options.editorName,
		})}`;
	}
	return result;
}

export type PublishOutcome =
	| { ok: true; candidate: MangaCandidateRow; translation: PublishedMangaTranslation }
	| { ok: false; code: "not_found" | "invalid_state" | "no_translation"; candidate?: MangaCandidateRow };

/**
 * Approuve un candidat `unreviewed` (ou reprend un `approved`) et publie ses
 * textes traduits comme traduction de la planche, en une transaction SQLite.
 */
export function approveAndPublishMangaCandidate(
	sqlite: Database,
	id: number,
	reviewer: string,
	now: number = Date.now()
): PublishOutcome {
	return sqlite.transaction((): PublishOutcome => {
		const current = getMangaCandidate(sqlite, id);
		if (!current) return { ok: false, code: "not_found" };
		if (current.status !== "unreviewed" && current.status !== "approved") {
			return { ok: false, code: "invalid_state", candidate: current };
		}
		const pairs = extractTranslationPairs(current.payload);
		if (pairs.length === 0) return { ok: false, code: "no_translation", candidate: current };
		const approved =
			current.status === "approved"
				? current
				: transitionMangaCandidate(sqlite, id, ["unreviewed"], "approved", reviewer, now);
		if (!approved) return { ok: false, code: "invalid_state", candidate: current };
		const languages = new Set(pairs.map((p) => p.targetLanguage).filter(Boolean));
		const translation: PublishedMangaTranslation = {
			pageId: approved.pageId,
			candidateId: approved.id,
			targetLanguage: languages.size === 1 ? ([...languages][0] as string) : null,
			pairs,
			publishedBy: reviewer,
			publishedAt: now,
		};
		upsertMangaPlancheTranslation(sqlite, translation);
		const published = transitionMangaCandidate(sqlite, id, ["approved"], "published", reviewer, now);
		if (!published) throw new Error("candidate publication raced");
		return { ok: true, candidate: published, translation };
	})();
}

/** Rejette un candidat encore `unreviewed`. */
export function rejectMangaCandidate(
	sqlite: Database,
	id: number,
	reviewer: string,
	now: number = Date.now()
): { ok: true; candidate: MangaCandidateRow } | { ok: false; code: "not_found" | "invalid_state" } {
	const updated = transitionMangaCandidate(sqlite, id, ["unreviewed"], "rejected", reviewer, now);
	if (updated) return { ok: true, candidate: updated };
	return { ok: false, code: getMangaCandidate(sqlite, id) ? "invalid_state" : "not_found" };
}
