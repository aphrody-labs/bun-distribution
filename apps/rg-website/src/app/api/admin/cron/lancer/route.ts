import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { requireApiAdmin } from "@/lib/api-auth";
import { logAdminAction } from "@/lib/admin-logger";
import { declencherTache } from "@/lib/bot/cron";

export const dynamic = "force-dynamic";

/**
 * `POST /api/admin/cron/lancer` — déclenche une tâche de `rg-cron.service`.
 *
 * ── LA POLITIQUE EST APPLIQUÉE ICI, PAS SEULEMENT DANS L'INTERFACE ─────────
 * Le bouton absent d'une carte n'est pas une garde : n'importe qui muni d'une
 * session `staff` peut poster ce corps à la main. `declencherTache()` relit
 * donc le catalogue partagé et refuse — quatre tâches sont interdites depuis
 * TOUTES les surfaces (elles réécrivent la production ou consomment un quota
 * externe), et les autres exigent le rôle que le catalogue leur donne.
 *
 * Le démon lance en tâche de fond et répond 202 : la réponse dit « démarrée »,
 * jamais « réussie ». Certaines tâches durent plusieurs minutes, et prétendre
 * le contraire enverrait chercher un résultat qui n'existe pas encore.
 */
export async function POST(requete: NextRequest) {
  const garde = await requireApiAdmin();
  if (!garde.ok) {
    return garde.response;
  }

  let corps: { tache?: unknown };
  try {
    corps = (await requete.json()) as { tache?: unknown };
  } catch {
    return NextResponse.json({ error: "Corps JSON illisible" }, { status: 400 });
  }

  const nom = typeof corps.tache === "string" ? corps.tache.trim() : "";
  if (nom === "") {
    return NextResponse.json({ error: "Nom de tâche manquant" }, { status: 400 });
  }

  const resultat = await declencherTache(nom, garde.data.role);

  if (resultat.ok) {
    await logAdminAction("cron.tache.lancer", "rg-cron", resultat.tache, {
      role: garde.data.role,
      via: "admin-web",
    });
  }

  return NextResponse.json(resultat, { status: resultat.ok ? 202 : 403 });
}
