import { NextResponse } from "next/server";

import { requireApiPatreonCreator } from "@/lib/api-auth";
import { exportSingleMember } from "@/lib/patreon/export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
	const auth = await requireApiPatreonCreator();
	if (!auth.ok) {
		return auth.response;
	}

	let body: { memberId?: string };
	try {
		body = (await req.json()) as { memberId?: string };
	} catch {
		return NextResponse.json({ error: "invalid_json" }, { status: 400 });
	}
	const memberId = body.memberId?.trim();
	if (!memberId) {
		return NextResponse.json({ error: "memberId_required" }, { status: 400 });
	}

	const result = await exportSingleMember(memberId);
	if (!result.ok) {
		return NextResponse.json({ detail: result.error, error: "resync_failed" }, { status: 500 });
	}
	return NextResponse.json({ ok: true });
}
