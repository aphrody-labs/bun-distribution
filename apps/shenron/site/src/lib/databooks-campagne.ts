import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { listDatabooks } from "@/lib/databooks";
import { indexDatabook } from "@/lib/databooks-redis";

interface OuvrageCampagneStatus {
	id: number;
	titre: string;
	category: string | null;
	totalPlanches: number;
	transcrites: number;
	traduites: number;
	fautives: number;
	resteATraduire: number;
	signesJaRestants: number;
	qualiteSource: "saine" | "moyenne" | "a-retranscrire";
}

export interface CampagneStats {
	totalOuvrages: number;
	ouvragesEnAttente: number;
	totalPlanches: number;
	planchesTranscrites: number;
	planchesTraduites: number;
	resteATraduire: number;
	signesJaRestants: number;
	topOuvrages: OuvrageCampagneStatus[];
}

/**
 * Aggregates translation queue status across all databooks.
 */
export async function getCampagneStats(): Promise<CampagneStats> {
	const rows = await db.execute<{
		id: number;
		titre: string;
		category: string | null;
		total_planches: number;
		transcrites: number;
		traduites: number;
		fautives: number;
		signes_ja: number;
		signes_ja_non_traduits: number;
	}>(sql`
		WITH book_stats AS (
			SELECT
				d.id,
				d.title AS titre,
				d.category,
				coalesce(jsonb_array_length(CASE WHEN jsonb_typeof(d.pages) = 'array' THEN d.pages ELSE '[]'::jsonb END), 0)::int AS total_planches,
				(
					SELECT count(*)::int
					FROM jsonb_array_elements(CASE WHEN jsonb_typeof(d.pages) = 'array' THEN d.pages ELSE '[]'::jsonb END) elem
					WHERE elem ->> 'text' IS NOT NULL AND length(trim(elem ->> 'text')) > 0
				) AS transcrites,
				(
					SELECT count(*)::int
					FROM jsonb_array_elements(CASE WHEN jsonb_typeof(d.pages) = 'array' THEN d.pages ELSE '[]'::jsonb END) elem
					WHERE elem ->> 'text_fr' IS NOT NULL AND length(trim(elem ->> 'text_fr')) > 0
				) AS traduites,
				(
					SELECT count(*)::int
					FROM jsonb_array_elements(CASE WHEN jsonb_typeof(d.pages) = 'array' THEN d.pages ELSE '[]'::jsonb END) elem
					WHERE coalesce((elem ->> 'verifiee')::boolean, false) = false
					  AND (elem ->> 'text' ~ '[\uFFFD\u0400-\u04FF\u0600-\u06FF\u0E00-\u0E7F\uAC00-\uD7AF]'
					       OR (length(elem ->> 'text') > 20 AND elem ->> 'text' !~ '[\u3040-\u309F\u30A0-\u30FF]'))
				) AS fautives,
				(
					SELECT coalesce(sum(length(elem ->> 'text')), 0)::int
					FROM jsonb_array_elements(CASE WHEN jsonb_typeof(d.pages) = 'array' THEN d.pages ELSE '[]'::jsonb END) elem
					WHERE elem ->> 'text' IS NOT NULL
				) AS signes_ja,
				(
					SELECT coalesce(sum(length(elem ->> 'text')), 0)::int
					FROM jsonb_array_elements(CASE WHEN jsonb_typeof(d.pages) = 'array' THEN d.pages ELSE '[]'::jsonb END) elem
					WHERE elem ->> 'text' IS NOT NULL
					  AND (elem ->> 'text_fr' IS NULL OR length(trim(elem ->> 'text_fr')) = 0)
				) AS signes_ja_non_traduits
			FROM bot.db_databooks d
		)
		SELECT *
		FROM book_stats
		ORDER BY (transcrites - traduites) DESC, id ASC
	`);

	let totalPlanches = 0;
	let planchesTranscrites = 0;
	let planchesTraduites = 0;
	let resteATraduireTotal = 0;
	let signesJaRestantsTotal = 0;
	let ouvragesEnAttente = 0;

	const allOuvrages: OuvrageCampagneStatus[] = rows.map((r) => {
		const reste = Math.max(0, r.transcrites - r.traduites);
		totalPlanches += r.total_planches;
		planchesTranscrites += r.transcrites;
		planchesTraduites += r.traduites;
		resteATraduireTotal += reste;
		signesJaRestantsTotal += r.signes_ja_non_traduits;
		if (reste > 0) ouvragesEnAttente++;

		// Rate source quality based on defective plates ratio
		let qualiteSource: OuvrageCampagneStatus["qualiteSource"] = "saine";
		if (r.transcrites > 0 && r.fautives / r.transcrites > 0.3) {
			qualiteSource = "a-retranscrire";
		} else if (r.fautives > 0) {
			qualiteSource = "moyenne";
		}

		return {
			id: r.id,
			titre: r.titre,
			category: r.category,
			totalPlanches: r.total_planches,
			transcrites: r.transcrites,
			traduites: r.traduites,
			fautives: r.fautives,
			resteATraduire: reste,
			signesJaRestants: r.signes_ja_non_traduits,
			qualiteSource,
		};
	});

	return {
		totalOuvrages: rows.length,
		ouvragesEnAttente,
		totalPlanches,
		planchesTranscrites,
		planchesTraduites,
		resteATraduire: resteATraduireTotal,
		signesJaRestants: signesJaRestantsTotal,
		topOuvrages: allOuvrages.slice(0, 50),
	};
}

/**
 * Triggers Redis index sync across all databooks.
 */
export async function reindexRedis(): Promise<{ indexed: number; failed: number }> {
	const { items: allBooks } = await listDatabooks({ limit: 1000, includeHidden: true });
	let indexed = 0;
	let failed = 0;

	for (const book of allBooks) {
		try {
			await indexDatabook(book as any);
			indexed++;
		} catch {
			failed++;
		}
	}

	return { indexed, failed };
}
