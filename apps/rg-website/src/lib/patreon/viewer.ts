"use server";

import { cache } from "react";

import { getServerUser } from "@/lib/auth-helpers";
import { createPostgresClient } from "@rosegriffon/db/service";

export interface PatreonViewerAccess {
  linked: boolean;
  isActiveMember: boolean;
  patronStatus: string | null;
  currentlyEntitledCents: number | null;
  tierAmountsCents: number[];
}

const NO_ACCESS: PatreonViewerAccess = {
  currentlyEntitledCents: null,
  isActiveMember: false,
  linked: false,
  patronStatus: null,
  tierAmountsCents: [],
};

/**
 * Détermine le statut Patreon du viewer connecté.
 *
 * - `linked` : compte Better Auth lié au provider `patreon` (présence dans `account`).
 * - `isActiveMember` : `patreon_memberships.patron_status === 'active_patron'`.
 *
 * Renvoie l'objet "no access" pour les visiteurs anonymes.
 */
export const getViewerPatreonAccess = cache(async (): Promise<PatreonViewerAccess> => {
  const user = await getServerUser();
  if (!user) {
    return NO_ACCESS;
  }

  const db = createPostgresClient();
  const { data: account } = await db
    .from("account")
    .select("user_id")
    .eq("user_id", user.id)
    .eq("provider_id", "patreon")
    .maybeSingle();

  if (!account) {
    return NO_ACCESS;
  }

  const { data: membership } = await db
    .from("patreon_memberships")
    .select("patron_status, currently_entitled_cents, tier_amounts_cents")
    .eq("user_id", user.id)
    .maybeSingle();

  const patronStatus = membership?.patron_status ?? null;
  return {
    currentlyEntitledCents: membership?.currently_entitled_cents ?? null,
    isActiveMember: patronStatus === "active_patron",
    linked: true,
    patronStatus,
    tierAmountsCents: membership?.tier_amounts_cents ?? [],
  };
});
