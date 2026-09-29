import { NextRequest, NextResponse } from "next/server";
import { isCurrentUserAdmin } from "@/lib/session";
import { getCampagneStats, reindexRedis } from "@/lib/databooks-campagne";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
	if (!(await isCurrentUserAdmin())) {
		return NextResponse.json({ error: "Accès réservé aux administrateurs." }, { status: 403 });
	}

	try {
		const stats = await getCampagneStats();
		return NextResponse.json(stats, {
			headers: { "Cache-Control": "private, no-store, max-age=0" },
		});
	} catch (error) {
		console.error("Campagne API GET error:", error);
		return NextResponse.json(
			{ error: error instanceof Error ? error.message : "Erreur interne" },
			{ status: 500 }
		);
	}
}

export async function POST(req: NextRequest) {
	if (!(await isCurrentUserAdmin())) {
		return NextResponse.json({ error: "Accès réservé aux administrateurs." }, { status: 403 });
	}

	try {
		const body = await req.json();
		const action = body.action;

		if (action === "reindex-redis") {
			const result = await reindexRedis();
			return NextResponse.json(result);
		}

		return NextResponse.json({ error: "Action non supportée." }, { status: 400 });
	} catch (error) {
		console.error("Campagne API POST error:", error);
		return NextResponse.json(
			{ error: error instanceof Error ? error.message : "Erreur interne" },
			{ status: 500 }
		);
	}
}
