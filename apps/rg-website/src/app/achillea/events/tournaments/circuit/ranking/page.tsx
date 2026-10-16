import { metadonneesAchillea } from "@/app/achillea/metadonnees";
import CircuitRankingClient from "@/app/achillea/tournaments/circuit/ranking/circuit-ranking-client";

/* Alias historique de `/achillea/tournaments/circuit/ranking`. */
export const metadata = metadonneesAchillea({
  titre: "Classement du circuit",
  description: "Le classement général du circuit Achilléa : joueurs, clans et tournois comptant pour la saison.",
  chemin: "/achillea/tournaments/circuit/ranking",
});

export default function EventsCircuitRankingPage() {
  return <CircuitRankingClient />;
}
