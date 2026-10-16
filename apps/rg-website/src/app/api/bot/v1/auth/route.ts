import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { assertBotAuth, resolveDiscordToProfile } from "../_lib";

export const dynamic = "force-dynamic";

/**
 * GET /api/bot/v1/auth?discord_id=...
 * Resolves a Discord user to its RG profile (if any).
 * Used by the bot to bootstrap RBAC without exposing DB creds.
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

  const profile = await resolveDiscordToProfile(discordId);
  if (!profile) {
    return NextResponse.json(
      { linked: false, profile: null },
      { headers: { "cache-control": "private, max-age=10" }, status: 200 },
    );
  }

  return NextResponse.json(
    { linked: true, profile },
    { headers: { "cache-control": "private, max-age=10" }, status: 200 },
  );
}
