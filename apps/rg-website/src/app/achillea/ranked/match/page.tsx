import { Suspense } from "react";
import { metadonneesAchillea } from "@/app/achillea/metadonnees";
import RankedMatchClient from "./ranked-match-client";

/*
 * Page serveur : elle n'existe que pour porter `metadata`, que `"use client"`
 * interdit. L'interface, inchangée, vit dans `ranked-match-client.tsx`.
 */
export const metadata = metadonneesAchillea({
  titre: "Match classé en cours",
  description: "Salon de match classé Achilléa : composition, score et rapport de résultat.",
  chemin: "/achillea/ranked/match",
  indexable: false,
});

export default function RankedMatchPage() {
  return (
    // `useSearchParams` impose une frontière Suspense dès que la page est
    // rendue depuis un composant serveur : sans elle, le build échoue.
    <Suspense fallback={null}>
      <RankedMatchClient />
    </Suspense>
  );
}
