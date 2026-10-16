import { createPostgresClient } from "@rosegriffon/db/service";

import type { ResolutionMethod, RgSubscriptionStatus } from "./types";

const STATUS_REACTIVATED: RgSubscriptionStatus = "reactivated";

export interface ReconcileResult {
  method: ResolutionMethod;
  memberId: string;
  userId: string;
}

export interface ReconcileSummary {
  byEmail: number;
  byDiscord: number;
  totalLegacy: number;
  stillPending: number;
}

export async function reconcileLegacyMember(
  patreonMemberId: string,
  userId: string,
  method: ResolutionMethod,
): Promise<ReconcileResult> {
  const supabase = createPostgresClient();
  const { error } = await supabase
    .from("patreon_legacy_members")
    .update({
      resolution_method: method,
      resolved_at: new Date().toISOString(),
      resolved_user_id: userId,
    })
    .eq("patreon_member_id", patreonMemberId);
  if (error) {
    throw error;
  }
  return { memberId: patreonMemberId, method, userId };
}

export async function reconcileAll(): Promise<ReconcileSummary> {
  const supabase = createPostgresClient();

  let byEmail = 0;
  let byDiscord = 0;

  const { data: pending, error: pendingErr } = await supabase
    .from("patreon_legacy_members")
    .select("patreon_member_id,email,discord_user_id")
    .is("resolved_user_id", null);
  if (pendingErr) {
    throw pendingErr;
  }

  for (const row of pending ?? []) {
    const { patreon_member_id, email, discord_user_id } = row as {
      patreon_member_id: string;
      email: string | null;
      discord_user_id: string | null;
    };

    // 1. email match
    if (email) {
      const { data: profile } = await supabase.from("profiles").select("id").eq("email", email).maybeSingle();
      if (profile) {
        await reconcileLegacyMember(patreon_member_id, (profile as { id: string }).id, "email");
        byEmail += 1;
        continue;
      }
    }

    // 2. discord match
    if (discord_user_id) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("id")
        .eq("discord_id", discord_user_id)
        .maybeSingle();
      if (profile) {
        await reconcileLegacyMember(patreon_member_id, (profile as { id: string }).id, "discord_id");
        byDiscord += 1;
        continue;
      }
    }
  }

  const { count: totalLegacy } = await supabase
    .from("patreon_legacy_members")
    .select("*", { count: "exact", head: true });
  const { count: stillPending } = await supabase
    .from("patreon_legacy_members")
    .select("*", { count: "exact", head: true })
    .is("resolved_user_id", null);

  return {
    byDiscord,
    byEmail,
    stillPending: stillPending ?? 0,
    totalLegacy: totalLegacy ?? 0,
  };
}

export async function markReactivated(userId: string, subscriptionRef?: string): Promise<number> {
  const supabase = createPostgresClient();
  const { data, error } = await supabase
    .from("patreon_legacy_members")
    .update({
      reactivated_at: new Date().toISOString(),
      rg_subscription_ref: subscriptionRef ?? null,
      rg_subscription_status: STATUS_REACTIVATED,
    })
    .eq("resolved_user_id", userId)
    .neq("rg_subscription_status", STATUS_REACTIVATED)
    .select("id");
  if (error) {
    console.error("[patreon/reconcile] markReactivated failed", error);
    return 0;
  }
  return data?.length ?? 0;
}
