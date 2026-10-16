import { NextResponse } from "next/server";

import { requirePatreonCreator } from "@/lib/auth-helpers";
import { exportPatreonMembers } from "@/lib/patreon/export";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST() {
	await requirePatreonCreator();
	try {
		const summary = await exportPatreonMembers();
		return NextResponse.json({ ok: true, summary });
	} catch (error) {
		console.error("[admin/patreon/export]", error);
		return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
	}
}
