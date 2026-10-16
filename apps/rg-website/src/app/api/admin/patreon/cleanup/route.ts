import { NextResponse } from "next/server";
import { createPostgresClient } from "@rosegriffon/db/service";

import { requirePatreonCreator } from "@/lib/auth-helpers";

export const runtime = "nodejs";

interface Body {
	daysSincePending?: number;
}

export async function POST(req: Request) {
	await requirePatreonCreator();
	const supabase = createPostgresClient();
	let body: Body = {};
	try {
		body = (await req.json()) as Body;
	} catch {
		// Body optional
	}
	const days = Math.max(1, Math.floor(body.daysSincePending ?? 90));
	const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

	const { data, error } = await supabase
		.from("patreon_legacy_members")
		.update({ rg_subscription_status: "churned" })
		.eq("rg_subscription_status", "pending")
		.lte("imported_at", cutoff)
		.select("patreon_member_id");

	if (error) {
		console.error("[admin/patreon/cleanup]", error);
		return NextResponse.json({ error: error.message, ok: false }, { status: 500 });
	}

	const expiredCount = await archiveExpiredTokens(supabase);

	return NextResponse.json({
		archivedTokens: expiredCount,
		count: data?.length ?? 0,
		ok: true,
	});
}

async function archiveExpiredTokens(
	supabase: ReturnType<typeof createPostgresClient>
): Promise<number> {
	const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
	const { data, error } = await supabase
		.from("patreon_oauth_tokens")
		.delete()
		.eq("is_creator", false)
		.lte("expires_at", cutoff)
		.select("id");
	if (error) {
		console.error("[admin/patreon/cleanup] archive tokens", error);
		return 0;
	}
	return data?.length ?? 0;
}
