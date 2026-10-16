import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { ACHILLEA_SESSION_COOKIE_NAME, ACHILLEA_SESSION_TTL_SECONDS } from "@rosegriffon/auth/achillea-session";
import { getServerSession } from "@/lib/auth-helpers";

/**
 * Passerelle d'identité : une session Rose Griffon vaut une session Achilléa.
 *
 * LE PROBLÈME QU'ELLE SUPPRIME
 * Le même visiteur avait DEUX comptes sur le même site. La session Rose Griffon
 * (Better Auth) ouvrait `/wiki`, `/shop`, `/settings` ; la session Achilléa —
 * un JWT maison posé par l'API après son propre OAuth Discord — ouvrait
 * `/achillea/**`. Deux boutons « Connexion » dans le même chrome, deux
 * déconnexions, et un membre connecté depuis dix minutes qui se voyait proposer
 * de se connecter en arrivant sur la page des clans.
 *
 * CE QU'ELLE FAIT
 * Elle lit la session Rose Griffon, retrouve le compte Discord qui lui est lié
 * (`account.provider_id = 'discord'`), s'assure que ce joueur existe dans
 * `achillea."user"` — c'est la même base depuis la fusion — et signe le jeton
 * qu'attend l'API Achilléa. Aucun second écran Discord : le lien de compte a
 * déjà eu lieu, une fois, côté Rose Griffon.
 *
 * POURQUOI L'IDENTIFIANT DISCORD
 * C'est la seule clé commune, et ce n'est pas un accident : le compte Achilléa
 * NAÎT d'un OAuth Discord, son identifiant primaire EST l'identifiant Discord.
 * Un membre connecté par e-mail ou Google sans Discord lié n'a donc pas de
 * contrepartie côté e-sport — la route le dit (`409`) au lieu de fabriquer un
 * compte fantôme.
 *
 * L'émission du jeton appartient à l'API unifiée : cette route ne fait que
 * vérifier la session Better Auth, résoudre le compte Discord lié, puis appeler
 * le pont interne authentifié. Le secret JWT et l'écriture de `achillea.user`
 * restent ainsi hors du runtime Next.js.
 */

/**
 * Attributs du cookie de session.
 *
 * Domaine parent : le jeton doit valoir pour `rosegriffon.fr` ET
 * `ranked.rosegriffon.fr`, que le front appelle directement.
 */
const COOKIE = {
  domain: process.env.NODE_ENV === "production" ? ".rosegriffon.fr" : undefined,
  httpOnly: true,
  path: "/",
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
} as const;

export async function POST() {
  const internalToken = process.env.API_ADMIN_TOKEN;
  if (!internalToken) {
    return NextResponse.json({ error: "passerelle_non_configuree" }, { status: 503 });
  }

  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: "non_authentifie" }, { status: 401 });
  }

  try {
    const apiUrl = (
      process.env.ACHILLEA_API_URL ??
      process.env.NEXT_PUBLIC_ACHILLEA_API_URL ??
      "https://api.rosegriffon.fr"
    ).replace(/\/$/, "");
    const exchange = await fetch(`${apiUrl}/v1/auth/session/exchange`, {
      method: "POST",
      headers: { authorization: `Bearer ${internalToken}`, "content-type": "application/json" },
      body: JSON.stringify({ betterAuthUserId: session.user.id }),
      cache: "no-store",
    });
    if (!exchange.ok) {
      if (exchange.status === 409) {
        const magasin = await cookies();
        magasin.set(ACHILLEA_SESSION_COOKIE_NAME, "", { ...COOKIE, maxAge: 0 });
        return NextResponse.json({ error: "discord_non_lie" }, { status: 409 });
      }
      console.error("[achillea/session] API exchange failed", exchange.status);
      return NextResponse.json({ error: "api_unifiee_indisponible" }, { status: 503 });
    }
    const payload = (await exchange.json()) as { token?: string; user?: { id: string | null } };
    if (!payload.token) return NextResponse.json({ error: "session_invalide" }, { status: 503 });

    const magasin = await cookies();
    magasin.set(ACHILLEA_SESSION_COOKIE_NAME, payload.token, {
      ...COOKIE,
      maxAge: ACHILLEA_SESSION_TTL_SECONDS,
    });

    return NextResponse.json(payload.user ?? { id: null });
  } catch (error) {
    console.error("[achillea/session] Erreur session Achilléa:", error);
    return NextResponse.json({ error: "base_de_donnees_indisponible" }, { status: 503 });
  }
}

/** Ferme la session Achilléa en même temps que celle de Rose Griffon. */
export async function DELETE() {
  const magasin = await cookies();
  magasin.set(ACHILLEA_SESSION_COOKIE_NAME, "", { ...COOKIE, maxAge: 0 });
  return NextResponse.json({ ok: true });
}
