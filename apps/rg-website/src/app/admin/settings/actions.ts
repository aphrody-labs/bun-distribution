"use server";

import { revalidatePath } from "next/cache";
import { createPostgresClient } from "@rosegriffon/db/service";
import { logAdminAction } from "@/lib/admin-logger";
import { getServerUser } from "@/lib/auth-helpers";
import { isAdmin, resolveProfile } from "@rosegriffon/auth";
import { parseAdminPublicSetting } from "@/lib/admin-settings-contract";
import { ADMIN_PUBLIC_SETTINGS } from "@/lib/admin-settings-contract";

export async function updateSetting(
  key: string,
  value: unknown, // Changed to unknown to avoid any lint error
  _description?: string,
) {
  const parsed = parseAdminPublicSetting(key, value);
  if (!parsed.ok) return { message: `Erreur : ${parsed.message}` };
  const supabase = createPostgresClient();

  const user = await getServerUser();

  if (!user) {
    return { message: "Erreur : Non authentifié" };
  }

  const profile = await resolveProfile(supabase, user);
  if (!profile || !isAdmin(profile.role)) {
    return { message: "Erreur : Non autorisé" };
  }

  const updateData: Record<string, unknown> = {
    key: parsed.key,
    updated_at: new Date().toISOString(),
    value: parsed.value,
  };
  // The client does not define the contract or audit text.
  updateData.description = ADMIN_PUBLIC_SETTINGS[parsed.key].label;

  const { error } = await supabase.from("settings").upsert(updateData);

  if (error) {
    return { message: `Erreur lors de la mise à jour: ${error.message}` };
  }

  await logAdminAction("update", "settings", parsed.key, { description: updateData.description });

  revalidatePath("/admin/settings");
  revalidatePath("/"); // Revalidate home page as well
  return { message: "Paramètre mis à jour avec succès" };
}
