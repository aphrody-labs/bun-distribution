/**
 * `POST /api/auth/patreon/disconnect` — dissocier Patreon, vraiment.
 *
 * ── CE QUE LA ROUTE FAISAIT (ET CE QU'ELLE PROMETTAIT) ─────────────────────
 * Elle ne supprimait que `patreon_oauth_tokens`. Le bouton « Dissocier »
 * répondait donc « Compte Patreon dissocié », la page se rechargeait… et la
 * ligne restait affichée « Connecté » — parce que l'onglet Connexions lit la
 * table `account`, jamais touchée. Pire : la remise de 20 % réservée aux
 * mécènes continuait de s'appliquer au panier, puisqu'elle se calcule sur
 * `patreon_memberships`, jamais touchée non plus. Une dissociation qui ne
 * dissocie rien est plus grave qu'un bouton absent : elle fait croire que
 * c'est fait.
 *
 * ── LA GARDE QUI ÉVITE DE S'ENFERMER DEHORS ───────────────────────────────
 * Sur ce site on ne se connecte QUE par un fournisseur (Discord, Google,
 * Twitch, Patreon) : `emailAndPassword` n'y est pas activé. Retirer la dernière
 * ligne `account` d'un compte, c'est donc lui retirer sa seule porte d'entrée —
 * sans mot de passe de secours, sans rien. La route refuse ce cas et le dit,
 * au lieu de le faire poliment.
 */
import { NextResponse } from "next/server";
import { createPostgresClient } from "@rosegriffon/db/service";

import { getServerUser } from "@/lib/auth-helpers";

export async function POST() {
  const user = await getServerUser();
  if (!user) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }
  const supabase = createPostgresClient();

  const { data: comptes, error: erreurComptes } = await supabase
    .from("account")
    .select("provider_id")
    .eq("user_id", user.id);

  if (erreurComptes) {
    console.error("[patreon/disconnect] lecture des comptes liés impossible", erreurComptes);
    return NextResponse.json({ error: "Comptes liés illisibles." }, { status: 500 });
  }

  const liés = (comptes ?? []) as Array<{ provider_id: string }>;
  if (!liés.some(compte => compte.provider_id === "patreon")) {
    // Rien à dissocier : la réponse reste un succès, l'état demandé est atteint.
    await supabase.from("patreon_oauth_tokens").delete().eq("user_id", user.id);
    return NextResponse.json({ ok: true });
  }
  if (liés.length <= 1) {
    return NextResponse.json(
      {
        error:
          "Patreon est ta seule façon de te connecter : lie d'abord Discord, Google ou Twitch, sinon tu ne pourrais plus revenir.",
      },
      { status: 409 },
    );
  }

  // Les trois traces d'un lien Patreon : le compte (ce que la page affiche), le
  // jeton (ce qui permet d'interroger l'API) et le mécénat (ce qui donne la
  // remise). En laisser une seule, c'est laisser la dissociation à moitié faite.
  const resultats = await Promise.all([
    supabase.from("account").delete().eq("user_id", user.id).eq("provider_id", "patreon"),
    supabase.from("patreon_oauth_tokens").delete().eq("user_id", user.id),
    supabase.from("patreon_memberships").delete().eq("user_id", user.id),
  ]);

  const echec = resultats.find(resultat => resultat.error);
  if (echec?.error) {
    console.error("[patreon/disconnect] dissociation incomplète", echec.error);
    return NextResponse.json({ error: "Dissociation incomplète." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
