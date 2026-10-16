import { metadonneesAchillea } from "@/app/achillea/metadonnees";
import AstralLeagueClient from "./astral-league-client";
import { createAchilleaClient } from "@/lib/achillea";

/*
 * Page serveur : elle n'existe que pour porter `metadata`, que `"use client"`
 * interdit. L'interface, inchangée, vit dans `astral-league-client.tsx`.
 */
export const metadata = metadonneesAchillea({
  titre: "Astral League",
  description:
    "Le championnat Astral League d'Achilléa : classement, calendrier des journées et règlement de la saison.",
  chemin: "/achillea/leagues/astral",
  indexable: true,
});

export default async function AstralLeaguePage() {
  const result = await createAchilleaClient().leagues.astral("astral");
  return <AstralLeagueClient initialSeason={result.ok ? result.value : null} />;
}
