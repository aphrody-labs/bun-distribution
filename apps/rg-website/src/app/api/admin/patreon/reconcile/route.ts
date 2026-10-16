import { NextResponse } from "next/server";

import { requirePatreonCreator } from "@/lib/auth-helpers";
import { reconcileAll } from "@/lib/patreon/reconcile";

export const runtime = "nodejs";

export async function POST() {
	await requirePatreonCreator();
	try {
		const summary = await reconcileAll();
		return NextResponse.json({ ok: true, summary });
	} catch (error) {
		console.error("[admin/patreon/reconcile]", error);
		return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
	}
}
