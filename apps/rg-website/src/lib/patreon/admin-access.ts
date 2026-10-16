"use server";

import { cache } from "react";
import { createPostgresClient } from "@rosegriffon/db/service";

/**
 * Email du compte créateur Patreon Rose Griffon (autorisation principale), fourni par
 * l'environnement serveur (`PATREON_CREATOR_EMAIL`) pour ne pas figer d'adresse
 * personnelle dans le code. Sans valeur, seule la whitelist Discord donne accès.
 */
const PATREON_CREATOR_EMAIL = process.env.PATREON_CREATOR_EMAIL?.trim().toLowerCase() || null;

/**
 * Whitelist Discord — IDs additionnels autorisés à accéder aux outils
 * d'administration Patreon (page + APIs sous /admin/patreon).
 *
 * Match résolu via :
 *  1. `profiles.discord_id` (alimenté par la session Better Auth Discord)
 *  2. `account.account_id` provider_id='discord' (fallback si profile pas synchro)
 */
const PATREON_ADMIN_DISCORD_WHITELIST = new Set<string>(["165739958928146432", "299502648317444096"]);

interface UserLike {
  id: string;
  email?: string | null;
}

/**
 * Vérifie si un user a accès à la zone admin Patreon.
 * - Email = créateur Patreon principal → ✓
 * - Discord ID ∈ whitelist → ✓
 * - Sinon → ✗
 */
export const isPatreonAdmin = cache(async (user: UserLike | null): Promise<boolean> => {
  if (!user) {
    return false;
  }
  if (PATREON_CREATOR_EMAIL && user.email?.toLowerCase() === PATREON_CREATOR_EMAIL) {
    return true;
  }

  const db = createPostgresClient();

  const { data: profile } = await db.from("profiles").select("discord_id").eq("id", user.id).maybeSingle();
  if (profile?.discord_id && PATREON_ADMIN_DISCORD_WHITELIST.has(profile.discord_id)) {
    return true;
  }

  const { data: account } = await db
    .from("account")
    .select("account_id")
    .eq("user_id", user.id)
    .eq("provider_id", "discord")
    .maybeSingle();
  if (account?.account_id && PATREON_ADMIN_DISCORD_WHITELIST.has(account.account_id)) {
    return true;
  }

  return false;
});
