/**
 * /api/canon/references — le corpus de preuves de canonicité, en lecture.
 *
 *   GET /api/canon/references?q=&provenance=&limit=&offset=
 *
 * `q` filtre sur le sujet, les mots-clés et le texte (ILIKE) ; `provenance` ∈
 * aphrody | databooks | manuel. Lecture seule, CORS ouvert. La table est
 * alimentée 24h/24 par `scripts/canon-ingest.ts`.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type",
	"Access-Control-Max-Age": "86400",
};

export function OPTIONS() {
	return new NextResponse(null, { status: 204, headers: CORS });
}

const PROVENANCES = new Set(["aphrody", "databooks", "manuel", "manga"]);

export async function GET(req: NextRequest) {
	const p = req.nextUrl.searchParams;
	const q = (p.get("q") ?? "").trim().slice(0, 200);
	const provenance = p.get("provenance") ?? "";
	const limit = Math.min(100, Math.max(1, Number(p.get("limit") ?? 20) || 20));
	const offset = Math.max(0, Number(p.get("offset") ?? 0) || 0);

	const filtres = [sql`visible`];
	if (PROVENANCES.has(provenance)) filtres.push(sql`provenance = ${provenance}`);
	if (q) {
		const motif = `%${q}%`;
		filtres.push(
			sql`(subject ilike ${motif} or text ilike ${motif} or coalesce(text_fr, '') ilike ${motif} or keywords::text ilike ${motif})`
		);
	}
	const where = sql.join(filtres, sql` and `);

	const rows = await db.execute<{
		id: string;
		subject: string;
		keywords: string[];
		text: string;
		text_fr: string | null;
		source: string;
		year: number | null;
		document: string;
		lang: string;
		provenance: string;
		href: string | null;
		updated_at: Date;
		total: number;
	}>(sql`
		select id, subject, keywords, text, text_fr, source, year, document, lang, provenance, href, updated_at,
		       count(*) over() as total
		from public.canon_references
		where ${where}
		order by (text_fr is not null) desc, year desc nulls last, id
		limit ${limit} offset ${offset}
	`);

	return NextResponse.json(
		{
			q,
			provenance: PROVENANCES.has(provenance) ? provenance : null,
			total: Number(rows[0]?.total ?? 0),
			limit,
			offset,
			items: rows.map((r) => ({
				id: r.id,
				subject: r.subject,
				keywords: r.keywords,
				text: r.text,
				textFr: r.text_fr,
				source: r.source,
				year: r.year,
				document: r.document,
				lang: r.lang,
				provenance: r.provenance,
				href: r.href,
				updatedAt: r.updated_at,
			})),
		},
		{ headers: { ...CORS, "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600" } }
	);
}
