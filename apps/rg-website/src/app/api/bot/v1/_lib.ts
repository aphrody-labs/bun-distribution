import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { createPostgresClient } from "@rosegriffon/db/service";

const TOKEN = process.env.BOT_API_TOKEN;

/**
 * Asserts a valid Bearer token (`BOT_API_TOKEN`) is present.
 * Returns null on success, an error NextResponse otherwise.
 */
export function assertBotAuth(request: NextRequest): NextResponse | null {
  if (!TOKEN) {
    return NextResponse.json({ error: "BOT_API_TOKEN not configured on server" }, { status: 503 });
  }
  const auth = request.headers.get("authorization") ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  if (!provided || provided !== TOKEN) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

/**
 * Resolve a Discord user → RG profile via Better Auth `account` table.
 * Returns null if no link exists.
 */
export async function resolveDiscordToProfile(discordId: string) {
  const supabase = createPostgresClient();

  const { data: account } = await supabase
    .from("account")
    .select("user_id")
    .eq("provider_id", "discord")
    .eq("account_id", discordId)
    .maybeSingle();

  if (!account) {
    return null;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, username, full_name, email, role, avatar_url, discord_id")
    .eq("id", (account as { user_id: string }).user_id)
    .maybeSingle();

  return profile;
}

export interface BotDiscordIdentity {
  id: string;
  username: string | null;
  full_name: string | null;
  role: string | null;
  avatar_url: string | null;
  discord_id: string | null;
  /** True only after the user completed the real Discord OAuth flow. */
  linked: boolean;
}

/**
 * Resolve the identity a bot may display for a Discord member.
 *
 * This deliberately accepts the private, unclaimed profiles created from the
 * Achillea/RG member imports, but never treats them as OAuth credentials. Keep
 * `resolveDiscordToProfile` for RBAC and all write endpoints.
 */
export async function resolveBotDiscordIdentity(discordId: string): Promise<BotDiscordIdentity | null> {
  const oauthProfile = await resolveDiscordToProfile(discordId);
  if (oauthProfile) {
    const profile = oauthProfile as Omit<BotDiscordIdentity, "linked">;
    return { ...profile, linked: true };
  }

  const supabase = createPostgresClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, username, full_name, role, avatar_url, discord_id")
    .eq("discord_id", discordId)
    .is("claimed_at", null)
    .maybeSingle();

  if (!profile) {
    return null;
  }

  return { ...(profile as Omit<BotDiscordIdentity, "linked">), linked: false };
}

export interface BotPrincipal {
  profile_id: string;
  discord_id: string;
  role: string;
  username: string | null;
}

/**
 * Combine bot auth + Discord identity. Provides per-actor RBAC for write endpoints.
 * Caller passes the Discord user ID via `x-discord-id` header.
 * Returns either a NextResponse (denied) or the principal.
 */
export async function authBotAndActor(
  request: NextRequest,
  opts: { adminOnly?: boolean } = {},
): Promise<NextResponse | BotPrincipal> {
  const denied = assertBotAuth(request);
  if (denied) {
    return denied;
  }

  const discordId = request.headers.get("x-discord-id");
  if (!discordId) {
    return NextResponse.json({ error: "Missing x-discord-id header (actor identity required)" }, { status: 400 });
  }
  const profile = (await resolveDiscordToProfile(discordId)) as (BotPrincipal & { id?: string }) | null;
  if (!profile) {
    return NextResponse.json({ error: `Discord user ${discordId} not linked to any RG profile` }, { status: 404 });
  }
  const role = (profile as unknown as { role?: string }).role ?? "user";
  if (role !== "admin" && role !== "staff") {
    return NextResponse.json({ error: `Insufficient role: ${role}` }, { status: 403 });
  }
  if (opts.adminOnly && role !== "admin") {
    return NextResponse.json({ error: "Strict admin required" }, { status: 403 });
  }
  return {
    discord_id: discordId,
    profile_id: (profile as unknown as { id: string }).id,
    role,
    username: (profile as unknown as { username?: string | null }).username ?? null,
  };
}

/**
 * Insert a row into `admin_audit_log` with `details.via='bot-api'`.
 */
export async function logBotAction(opts: {
  principal: BotPrincipal;
  action: string;
  entity_type?: string;
  entity_id?: string | null;
  details?: Record<string, unknown>;
}): Promise<void> {
  try {
    const supabase = createPostgresClient();
    await supabase.from("admin_audit_log").insert({
      action: opts.action,
      details: { discord_id: opts.principal.discord_id, via: "bot-api", ...opts.details },
      entity_id: opts.entity_id ?? null,
      entity_type: opts.entity_type ?? "bot-api",
      user_id: opts.principal.profile_id,
    });
  } catch (error) {
    console.error("[bot-api] audit log failed:", error);
  }
}
