import { NextResponse } from "next/server";

import { requirePatreonCreator } from "@/lib/auth-helpers";
import { runReminderBatch } from "@/lib/patreon/notify";
import type { ReminderStage } from "@/lib/patreon/notify";

export const runtime = "nodejs";
export const maxDuration = 300;

const VALID = new Set<ReminderStage>(["announce", "reminder1", "reminder2", "lastcall"]);

export async function POST(req: Request) {
	await requirePatreonCreator();
	const url = new URL(req.url);
	const stageRaw = url.searchParams.get("stage") ?? "announce";
	const stage = (VALID.has(stageRaw as ReminderStage) ? stageRaw : "announce") as ReminderStage;

	try {
		const summary = await runReminderBatch(stage);
		return NextResponse.json({ ok: true, summary });
	} catch (error) {
		console.error("[admin/patreon/notify]", error);
		return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
	}
}
