"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/session";
import { moderateComment, SocialError } from "@/lib/social";
import { socialErrorMessage } from "@/lib/social-shared";

/**
 * Actions de modération des commentaires — **surface d'administration**.
 *
 * Elles n'implémentent aucune règle : tout passe par `lib/social.ts`, le même
 * module que l'API publique et que l'API des agents. Ce fichier ne fait que deux
 * choses : exiger les droits (`requireAdmin`) et purger le cache de l'écran.
 */

export type ModerationResult = { ok: true } | { ok: false; error: string };

export async function hideCommentAction(id: string): Promise<ModerationResult> {
  return run(id, "hide");
}

export async function restoreCommentAction(id: string): Promise<ModerationResult> {
  return run(id, "restore");
}

export async function pinCommentAction(id: string, pinned: boolean): Promise<ModerationResult> {
  return run(id, pinned ? "unpin" : "pin");
}

async function run(
  id: string,
  action: "hide" | "restore" | "pin" | "unpin",
): Promise<ModerationResult> {
  const me = await requireAdmin();
  try {
    await moderateComment(id, action, {
      type: "user",
      id: me.user.id,
      name: me.user.username,
      isAdmin: true,
    });
    revalidatePath("/admin/moderation/commentaires");
    return { ok: true };
  } catch (err) {
    if (err instanceof SocialError) return { ok: false, error: socialErrorMessage(err.code) };
    console.error("[admin] modération commentaire", err);
    return { ok: false, error: "Action impossible." };
  }
}

/**
 * Retrait définitif par la modération.
 *
 * Techniquement, c'est le même `hidden` que l'action ci-dessus : rien n'est
 * effacé de la base. C'est volontaire — l'historique de modération doit rester
 * lisible, et un fil dont on supprime des lignes devient incompréhensible pour
 * ceux qui y avaient répondu.
 */
