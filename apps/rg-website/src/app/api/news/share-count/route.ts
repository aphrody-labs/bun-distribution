import { NextResponse } from "next/server";
import { getPgPool } from "@/lib/db/pg";

export async function GET(request: Request) {
	const { searchParams } = new URL(request.url);
	const id = searchParams.get("id");
	const slug = searchParams.get("slug");

	if (!id && !slug) {
		return NextResponse.json({ count: 0 });
	}

	try {
		const pool = getPgPool();
		let rows: Array<{ share_count: number | null }> = [];

		if (id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
			const res = await pool.query<{ share_count: number | null }>(
				`SELECT share_count FROM articles WHERE id = $1 LIMIT 1`,
				[id]
			);
			rows = res.rows;
		} else {
			const identifier = slug || id;
			if (identifier) {
				const res = await pool.query<{ share_count: number | null }>(
					`SELECT share_count FROM articles WHERE slug = $1 LIMIT 1`,
					[identifier]
				);
				rows = res.rows;
			}
		}

		return NextResponse.json({ count: rows[0]?.share_count || 0 });
	} catch (error) {
		console.error("Error fetching share_count:", error);
		return NextResponse.json({ count: 0 });
	}
}
