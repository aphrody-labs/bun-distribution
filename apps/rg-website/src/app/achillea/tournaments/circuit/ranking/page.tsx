import { metadonneesAchillea } from "@/app/achillea/metadonnees";
import CircuitRankingClient from "./circuit-ranking-client";

/*
 * Page serveur : elle n'existe que pour porter `metadata`, que `"use client"`
 * interdit. L'interface, inchangée, vit dans `circuit-ranking-client.tsx`.
 */
export const metadata = metadonneesAchillea({
  titre: "Classement du circuit",
  description: "Le classement général du circuit Achilléa : joueurs, clans et tournois comptant pour la saison.",
  chemin: "/achillea/tournaments/circuit/ranking",
  indexable: true,
});

export default function CircuitRankingPage() {
  return <CircuitRankingClient />;
}
