import { NextResponse } from "next/server";

import { requirePatreonCreator } from "@/lib/auth-helpers";
import { reconcileLegacyMember } from "@/lib/patreon/reconcile";

export const runtime = "nodejs";

interface Body {
  memberId: string;
  userId: string;
}

export async function POST(req: Request) {
  await requirePatreonCreator();
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body.memberId || !body.userId) {
    return NextResponse.json({ error: "memberId and userId required" }, { status: 400 });
  }
  try {
    const result = await reconcileLegacyMember(body.memberId, body.userId, "manual");
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    console.error("[admin/patreon/resolve]", error);
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
