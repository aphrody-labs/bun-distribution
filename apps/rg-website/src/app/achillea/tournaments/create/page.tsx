import { metadonneesAchillea } from "@/app/achillea/metadonnees";
import TournamentCreateClient from "./tournament-create-client";

/*
 * Page serveur : elle n'existe que pour porter `metadata`, que `"use client"`
 * interdit. L'interface, inchangée, vit dans `tournament-create-client.tsx`.
 */
export const metadata = metadonneesAchillea({
	titre: "Créer un tournoi",
	description:
		"Déclarer un tournoi Inazuma Eleven: Victory Road sur le circuit Achilléa.",
	chemin: "/achillea/tournaments/create",
	indexable: false,
});

export default function TournamentCreatePage() {
	return <TournamentCreateClient />;
}
