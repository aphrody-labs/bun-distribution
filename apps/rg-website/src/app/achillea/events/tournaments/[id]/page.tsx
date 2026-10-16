import type { Metadata } from "next";
import { metadonneesAchillea, resume } from "@/app/achillea/metadonnees";
import TournamentDetailClient from "@/app/achillea/tournaments/[id]/tournament-detail-client";
import { createAchilleaClient, tournamentStateLabel } from "@/lib/achillea";
import { signalerEchec } from "@/lib/achillea/signaler";

interface FicheTournoiProps {
  params: Promise<{ id: string }>;
}

/*
 * Alias historique de `/achillea/tournaments/[id]`.
 *
 * Le titre est résolu comme sur la page cible, et le canonical pointe vers
 * elle : les liens `events/*` déjà partagés continuent de fonctionner sans
 * créer un doublon indexé.
 */
export async function generateMetadata({ params }: FicheTournoiProps): Promise<Metadata> {
  const { id } = await params;
  const numero = Number.parseInt(id, 10);
  const chemin = `/achillea/tournaments/${id}`;

  if (!Number.isFinite(numero)) {
    return metadonneesAchillea({
      titre: "Tournoi introuvable",
      description: "Ce tournoi Achilléa n'existe pas.",
      chemin: null,
      indexable: false,
    });
  }

  const resultat = await createAchilleaClient().tournaments.get(numero);
  if (!resultat.ok) {
    signalerEchec(`events/tournaments/${id} — métadonnées`, resultat);
    return metadonneesAchillea({
      titre: "Fiche de tournoi",
      description: "Format, inscrits et arbre de rencontres d'un tournoi Achilléa.",
      chemin,
    });
  }

  const [tournoi, inscrits] = resultat.value;
  return metadonneesAchillea({
    titre: tournoi.name,
    description:
      resume(tournoi.description) ??
      `${tournoi.name} — tournoi Inazuma Eleven: Victory Road sur Achilléa. ${tournamentStateLabel(tournoi.internalState)}, ${inscrits.length} inscrit(s).`,
    chemin,
  });
}

export default async function EventsTournamentDetailPage({ params }: FicheTournoiProps) {
  const { id } = await params;
  return <TournamentDetailClient id={id} />;
}
