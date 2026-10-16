import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { assertBotAuth } from "../_lib";
import { getDashboardStats } from "@rosegriffon/db/stats";

// Cache 30s côté Next.js
export const revalidate = 30;
export const dynamic = "force-dynamic";

/**
 * GET /api/bot/v1/stats — aggregated dashboard counts.
 */
export async function GET(request: NextRequest) {
	const denied = assertBotAuth(request);
	if (denied) {
		return denied;
	}

	try {
		const stats = await getDashboardStats();
		return NextResponse.json(stats, {
			headers: {
				"cache-control": "private, max-age=30, s-maxage=30",
			},
			status: 200,
		});
	} catch (error) {
		return NextResponse.json(
			{ error: error instanceof Error ? error.message : "Failed to fetch stats" },
			{ status: 500 }
		);
	}
}
