import { metadonneesAchillea } from "@/app/achillea/metadonnees";
import TournamentsClient from "./tournaments-client";
import { createAchilleaClient } from "@/lib/achillea";
import { remainingTournamentPages } from "@/lib/achillea/tournament-pagination";

/*
 * Page serveur : elle n'existe que pour porter `metadata`, que `"use client"`
 * interdit. L'interface, inchangée, vit dans `tournaments-client.tsx`.
 */
export const metadata = metadonneesAchillea({
  titre: "Tournois",
  description: "Tous les tournois Achilléa : préinscriptions ouvertes, rencontres en cours et éditions terminées.",
  chemin: "/achillea/tournaments",
  indexable: true,
});

export default async function TournamentsPage() {
  const client = createAchilleaClient();
  const first = await client.tournaments.list({ page: 1, pageSize: 50 });
  if (!first.ok) return <TournamentsClient initialLoadError />;

  const remaining = await Promise.all(
    remainingTournamentPages(first.value.meta).map(page => client.tournaments.list({ page, pageSize: 50 })),
  );
  const allLoaded = remaining.every(result => result.ok);
  const tournaments = allLoaded
    ? [...first.value.data, ...remaining.flatMap(result => (result.ok ? result.value.data : []))]
    : first.value.data;

  return <TournamentsClient initialTournaments={tournaments} initialLoadError={!allLoaded} />;
}
