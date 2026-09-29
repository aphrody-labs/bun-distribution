// SPDX-License-Identifier: Apache-2.0
import type postgres from "postgres";
import { loadDatabaseUrl } from "@shenron/db/env";

/**
 * URL PostgreSQL : `DATABASE_URL` de l'environnement, puis `apps/site/.env`,
 * `apps/bot/.env`, `.env` (relatifs au répertoire courant, comme avant).
 * Dans un fichier, la DERNIÈRE ligne active gagne (B1) : l'URL Neon retirée
 * précède l'URL vivante.
 */
export function getDbUrl(): string {
	const result = loadDatabaseUrl({
		fallbackFiles: [{ path: "apps/site/.env" }, { path: "apps/bot/.env" }, { path: ".env" }],
	});
	if (!result.ok) throw new Error(`DATABASE_URL non configuré. ${result.reason}`);
	return result.url;
}

export interface DatabookMatch {
	bookId: number;
	bookTitle: string;
	bookTitleJa: string | null;
	pageNumber: number;
	pageImage: string | null;
	snippet: string;
	hasFr: boolean;
	textFrSnippet?: string;
}

export interface WikiSourceRef {
	n: number;
	label: string;
	url: string;
	kind: "databook";
}

/** Identifiant de révision 24 caractères base36 pour public.wiki_revisions */
export function idRevision(): string {
	return Array.from(
		{ length: 24 },
		() => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]
	).join("");
}

/**
 * Recherche des planches pertinentes dans le corpus transcrit de bot.db_databooks.
 */
export async function searchDatabooks(
	sql: postgres.Sql,
	terms: string[],
	options: { limit?: number; bookIds?: number[] } = {}
): Promise<DatabookMatch[]> {
	const limit = options.limit ?? 5;
	const bookFilter = options.bookIds && options.bookIds.length > 0
		? sql`AND b.id IN ${sql(options.bookIds)}`
		: sql``;

	// Recherche dans le tableau JSONB pages
	const matches: DatabookMatch[] = [];

	for (const term of terms) {
		if (!term || term.trim().length < 2) continue;
		const cleanTerm = term.trim();

		const rows = await sql`
			SELECT b.id as book_id, b.title as book_title, b.title_ja as book_title_ja,
			       (p.elem->>'number')::int as page_number,
			       p.elem->>'image' as page_image,
			       p.elem->>'text' as page_text,
			       p.elem->>'text_fr' as page_text_fr
			FROM bot.db_databooks b,
			     LATERAL jsonb_array_elements(b.pages) AS p(elem)
			WHERE b.pages IS NOT NULL
			  ${bookFilter}
			  AND (
			      p.elem->>'text' ILIKE ${"%" + cleanTerm + "%"}
			   OR p.elem->>'text_fr' ILIKE ${"%" + cleanTerm + "%"}
			  )
			LIMIT ${limit};
		`;

		for (const r of rows) {
			const textJa = r.page_text || "";
			const textFr = r.page_text_fr || "";
			const hasFr = textFr.length > 0;

			// Extrait pertinent autour du terme
			let snippet = "";
			const idxFr = textFr.toLowerCase().indexOf(cleanTerm.toLowerCase());
			if (idxFr >= 0) {
				const start = Math.max(0, idxFr - 60);
				const end = Math.min(textFr.length, idxFr + cleanTerm.length + 100);
				snippet = (start > 0 ? "…" : "") + textFr.substring(start, end).replace(/\s+/g, " ") + (end < textFr.length ? "…" : "");
			} else {
				const idxJa = textJa.indexOf(cleanTerm);
				const start = Math.max(0, idxJa - 40);
				const end = Math.min(textJa.length, idxJa + cleanTerm.length + 80);
				snippet = (start > 0 ? "…" : "") + textJa.substring(start, end).replace(/\s+/g, " ") + (end < textJa.length ? "…" : "");
			}

			// Éviter les doublons
			if (!matches.some((m) => m.bookId === Number(r.book_id) && m.pageNumber === Number(r.page_number))) {
				matches.push({
					bookId: Number(r.book_id),
					bookTitle: r.book_title,
					bookTitleJa: r.book_title_ja,
					pageNumber: Number(r.page_number),
					pageImage: r.page_image,
					snippet,
					hasFr,
					textFrSnippet: textFr ? textFr.substring(0, 180) : undefined,
				});
			}
			if (matches.length >= limit) break;
		}
		if (matches.length >= limit) break;
	}

	return matches;
}

/**
 * Construit un tableau WikiSourceRef pour article_sources
 */
export function buildDatabookSources(matches: DatabookMatch[], startIndex = 1): WikiSourceRef[] {
	return matches.map((m, idx) => ({
		n: startIndex + idx,
		label: `${m.bookTitle} — planche ${m.pageNumber}`,
		url: `/wiki/databooks/${m.bookId}#p-${m.pageNumber}`,
		kind: "databook",
	}));
}
