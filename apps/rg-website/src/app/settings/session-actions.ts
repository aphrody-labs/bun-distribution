"use server";

import { getServerSession } from "@/lib/auth-helpers";
import { getPgPool } from "@/lib/db/pg";

/**
 * Révoque une session du compte courant sans sérialiser son jeton au client.
 *
 * La ligne est supprimée directement : Better Auth relit chaque session en
 * base (pas de cache cookie), donc la session révoquée tombe à la requête
 * suivante. `auth.api.listSessions`/`revokeSession` exigent une session
 * « fraîche » (moins d'un jour) et refusaient l'action à tout membre connecté
 * depuis plus longtemps — c'est-à-dire presque tous.
 */
export async function revokeAccountSession(id: string): Promise<{ error?: string }> {
  const current = await getServerSession();
  if (!current?.user || !id || id.length > 128 || id === current.session.id) {
    return { error: "Session invalide ou expirée." };
  }

  try {
    const { rowCount } = await getPgPool().query(`DELETE FROM session WHERE id = $1 AND user_id = $2`, [
      id,
      current.user.id,
    ]);
    if (!rowCount) return { error: "Session introuvable." };
    return {};
  } catch (error) {
    console.error("[compte] révocation de session impossible", error);
    return { error: "Impossible de révoquer cette session." };
  }
}
