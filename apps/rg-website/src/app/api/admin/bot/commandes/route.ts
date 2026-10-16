import { NextResponse } from "next/server";

import { requireApiAdmin } from "@/lib/api-auth";
import { commandesDesBots } from "@/lib/bot/serveur";

export const dynamic = "force-dynamic";

/**
 * `GET /api/admin/bot/commandes` — l'arbre des slash commands réellement
 * enregistrées, profil par profil.
 *
 * La liste vient des décorateurs `discordx` exécutés au chargement de chaque
 * processus : c'est exactement ce qu'un membre voit dans Discord. Un catalogue
 * recopié dans le site aurait divergé au premier ajout de commande — le
 * catalogue des tâches cron l'a fait, dix-huit noms contre vingt-deux.
 */
export async function GET() {
  const garde = await requireApiAdmin();
  if (!garde.ok) {
    return garde.response;
  }

  const { commandes, indisponibles } = await commandesDesBots();

  return NextResponse.json(
    { commandes, indisponibles, total: commandes.length },
    { headers: { "cache-control": "private, no-store" } },
  );
}
