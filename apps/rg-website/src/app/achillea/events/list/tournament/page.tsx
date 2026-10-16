import { metadonneesAchillea } from "@/app/achillea/metadonnees";
import TournamentsClient from "@/app/achillea/tournaments/tournaments-client";

/*
 * Alias historique de `/achillea/tournaments` (routes `events/*` du front
 * Angular, gardées vivantes pour les liens déjà partagés).
 *
 * Canonical vers le chemin CIBLE : deux URL pour la même liste, une seule
 * indexée.
 */
export const metadata = metadonneesAchillea({
  titre: "Tournois",
  description: "Tous les tournois Achilléa : préinscriptions ouvertes, rencontres en cours et éditions terminées.",
  chemin: "/achillea/tournaments",
});

export default function EventsTournamentsListPage() {
  return <TournamentsClient />;
}
