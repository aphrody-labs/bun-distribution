import { metadonneesAchillea } from "@/app/achillea/metadonnees";
import ClanCreateClient from "./clan-create-client";

/*
 * Page serveur : elle n'existe que pour porter `metadata`, que `"use client"`
 * interdit. L'interface, inchangée, vit dans `clan-create-client.tsx`.
 */
export const metadata = metadonneesAchillea({
	titre: "Créer un clan",
	description:
		"Fonder un clan compétitif Achilléa sur Inazuma Eleven: Victory Road.",
	chemin: "/achillea/clans/create",
	indexable: false,
});

export default function ClanCreatePage() {
	return <ClanCreateClient />;
}
