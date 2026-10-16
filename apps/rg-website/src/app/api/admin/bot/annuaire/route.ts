import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { RG_GUILD_ID } from "@rosegriffon/types/discord";

import { requireApiAdmin } from "@/lib/api-auth";
import { annuaireGuilde } from "@/lib/bot/serveur";

export const dynamic = "force-dynamic";

const FLOCON = /^\d{15,25}$/;

/**
 * `GET /api/admin/bot/annuaire?guild=…` — salons et rôles de la guilde.
 *
 * ── POURQUOI CETTE ROUTE EXISTE ────────────────────────────────────────────
 * Sans elle, le formulaire de réglages demanderait des FLOCONS : « colle ici
 * l'identifiant du salon d'annonce ». C'est exactement la manœuvre qui pose un
 * rôle de direction sur le mauvais rôle — un chiffre de dix-huit caractères ne
 * se relit pas. L'interface propose donc des noms, et n'envoie des flocons que
 * ceux qu'elle a reçus du bot lui-même.
 *
 * L'annuaire n'est PAS mis en cache par le navigateur : un salon créé il y a
 * trente secondes doit apparaître, sinon le staff conclut que le bot ne le voit
 * pas et va chercher une panne inexistante.
 */
export async function GET(requete: NextRequest) {
  const garde = await requireApiAdmin();
  if (!garde.ok) {
    return garde.response;
  }

  const brut = (requete.nextUrl.searchParams.get("guild") ?? "").trim();
  const guildId = brut === "" ? RG_GUILD_ID : brut;
  if (!FLOCON.test(guildId)) {
    return NextResponse.json({ error: "Identifiant de guilde invalide" }, { status: 400 });
  }

  const annuaire = await annuaireGuilde(guildId);
  return NextResponse.json(
    { guildId, ...annuaire },
    {
      headers: { "cache-control": "private, no-store" },
      status: annuaire.source === null ? 503 : 200,
    },
  );
}
