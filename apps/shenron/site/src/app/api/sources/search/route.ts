import { NextResponse, type NextRequest } from "next/server";
import { EXTERNAL_SOURCE_KINDS, searchExternalSources } from "@/lib/external-source-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/sources/search?q=goku&kind=archive&limit=24&offset=0
 *
 * API publique de l'index BXC. Elle ne masque aucune classification : le
 * consommateur peut filtrer par provenance mais aucun type de source n'est
 * exclu de l'index. Le canon concerne l'éditorial, pas la trouvabilité.
 */
export async function GET(request: NextRequest) {
	const params = request.nextUrl.searchParams;
	const q = (params.get("q") ?? "").trim().slice(0, 120);
	const kind = params.get("kind") ?? "";
	const limit = Number(params.get("limit") ?? 24);
	const offset = Number(params.get("offset") ?? 0);
	const payload = await searchExternalSources({ q, kind, limit, offset });
	return NextResponse.json(
		{
			...payload,
			q,
			kind: EXTERNAL_SOURCE_KINDS.includes(kind as (typeof EXTERNAL_SOURCE_KINDS)[number])
				? kind
				: "",
			classifications: EXTERNAL_SOURCE_KINDS,
		},
		{ headers: { "cache-control": "public, max-age=60, stale-while-revalidate=300" } }
	);
}
