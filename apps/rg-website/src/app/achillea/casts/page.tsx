import { metadonneesAchillea } from "@/app/achillea/metadonnees";
import CastsClient from "./casts-client";

/*
 * Page serveur : elle n'existe que pour porter `metadata`, que `"use client"`
 * interdit. L'interface, inchangée, vit dans `casts-client.tsx`.
 */
export const metadata = metadonneesAchillea({
  titre: "Casters et régie",
  description: "L'équipe de commentateurs et de streamers officiels d'Achilléa sur Inazuma Eleven: Victory Road.",
  chemin: "/achillea/casts",
  indexable: true,
});

export default function CastsPage() {
  return <CastsClient />;
}
