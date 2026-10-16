import { metadonneesAchillea } from "@/app/achillea/metadonnees";
import TournamentCreateClient from "@/app/achillea/tournaments/create/tournament-create-client";

/* Alias historique de `/achillea/tournaments/create` (routes `events/*`). */
export const metadata = metadonneesAchillea({
	titre: "Créer un tournoi",
	description: "Déclarer un tournoi Inazuma Eleven: Victory Road sur le circuit Achilléa.",
	chemin: "/achillea/tournaments/create",
	indexable: false,
});

export default function EventsTournamentCreatePage() {
	return <TournamentCreateClient />;
}
