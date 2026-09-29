/**
 * /api/wiki/timelines — API publique des continuités temporelles de Dragon Ball.
 *
 * Expose les 4 timelines narratives (manga-canon, anime-toei, movies-dbz, xenoverse)
 * et leur décompte d'événements rattachés conformément au Sprint 3 de la refonte.
 */
import { NextRequest, NextResponse } from "next/server";
import { dbUniverse } from "@/lib/db-universe";

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

export async function GET(req: NextRequest) {
	try {
		const timelines = (await dbUniverse.narrativeTimelines()) ?? [];

		return NextResponse.json(
			{
				data: timelines,
				total: timelines.length,
			},
			{
				headers: {
					...CORS,
					"Content-Type": "application/json; charset=utf-8",
					"Cache-Control": "public, max-age=60, stale-while-revalidate=300",
				},
			},
		);
	} catch (error) {
		console.error("[API_WIKI_TIMELINES_ERROR]", error);
		return NextResponse.json(
			{ error: "Erreur interne lors de la récupération des timelines narratives." },
			{ status: 500, headers: CORS },
		);
	}
}
