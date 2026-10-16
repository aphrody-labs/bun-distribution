import { NextResponse } from "next/server";
import { getPgPool } from "@/lib/db/pg";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
	const checks: Record<string, "ok" | "error"> = {};
	let dbError: string | undefined;

	try {
		await getPgPool().query("SELECT 1");
		checks.db = "ok";
	} catch (error) {
		checks.db = "error";
		dbError = error instanceof Error ? error.message : String(error);
	}

	const allOk = Object.values(checks).every((v) => v === "ok");

	return NextResponse.json(
		{
			status: allOk ? "ok" : "degraded",
			checks,
			...(dbError ? { dbNote: dbError } : {}),
			uptime: process.uptime(),
		},
		{ status: allOk ? 200 : 503 }
	);
}
