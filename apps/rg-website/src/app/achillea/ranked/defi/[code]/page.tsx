import { metadonneesAchillea } from "@/app/achillea/metadonnees";
import RankedChallengeClient from "./ranked-challenge-client";

/*
 * Page serveur : elle n'existe que pour porter `metadata`, que `"use client"`
 * interdit. L'interface, inchangée, vit dans `ranked-challenge-client.tsx`.
 *
 * `chemin: null` : le code de défi est un lien d'invitation à usage privé.
 * Le publier dans un canonical reviendrait à ouvrir le salon à quiconque lit
 * la source de la page.
 */
export const metadata = metadonneesAchillea({
  titre: "Défi privé",
  description: "Rejoindre un défi classé Achilléa depuis un lien d'invitation.",
  chemin: null,
  indexable: false,
});

export default async function RankedChallengePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <RankedChallengeClient code={code} />;
}
