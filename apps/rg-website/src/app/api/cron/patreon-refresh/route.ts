import { NextResponse } from "next/server";

import { refreshAllMemberships } from "@/lib/patreon/sync";

/**
 * Cron hebdo (à brancher dans systemd timer ou GitHub Actions) qui refresh
 * les memberships dont le `fetched_at` est plus vieux que 6 jours.
 *
 * Authentification par `CRON_SECRET` dans le header Authorization, identique
 * au pattern `cron/patreon-reminders`.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return new NextResponse("unauthorized", { status: 401 });
  }

  const result = await refreshAllMemberships({
    limit: 200,
    olderThanMs: 6 * 24 * 3600 * 1000,
  });
  return NextResponse.json(result);
}
