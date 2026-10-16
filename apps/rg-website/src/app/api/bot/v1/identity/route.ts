import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { assertBotAuth, resolveBotDiscordIdentity } from "../_lib";

export const dynamic = "force-dynamic";

/**
 * GET /api/bot/v1/identity?discord_id=...
 *
 * Read-only identity bridge shared by RG and Achillea. `linked` means that the
 * member has completed Discord OAuth; an imported profile is display-only and
 * must not be used to authorize mutations.
 */
export async function GET(request: NextRequest) {
  const denied = assertBotAuth(request);
  if (denied) {
    return denied;
  }

  const discordId = request.nextUrl.searchParams.get("discord_id");
  if (!discordId) {
    return NextResponse.json({ error: "Missing discord_id" }, { status: 400 });
  }

  const identity = await resolveBotDiscordIdentity(discordId);
  return NextResponse.json(
    { found: Boolean(identity), identity },
    { headers: { "cache-control": "private, max-age=10" } },
  );
}
