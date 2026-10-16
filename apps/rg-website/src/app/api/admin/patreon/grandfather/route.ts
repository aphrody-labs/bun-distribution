import { NextResponse } from "next/server";
import { createPostgresClient } from "@rosegriffon/db/service";

import { requireApiPatreonCreator } from "@/lib/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_STATUSES = new Set(["pending", "reactivated", "churned", "grandfathered"]);

export async function POST(req: Request) {
  const auth = await requireApiPatreonCreator();
  if (!auth.ok) {
    return auth.response;
  }

  let body: { id?: string; status?: string };
  try {
    body = (await req.json()) as { id?: string; status?: string };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const id = body.id?.trim();
  const status = body.status?.trim();
  if (!id || !status || !VALID_STATUSES.has(status)) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const supabase = createPostgresClient();

  const { error } = await supabase
    .from("patreon_legacy_members")
    .update({ rg_subscription_status: status })
    .eq("id", id);

  if (error) {
    console.error("[admin/patreon/grandfather]", error);
    return NextResponse.json({ detail: error.message, error: "update_failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
