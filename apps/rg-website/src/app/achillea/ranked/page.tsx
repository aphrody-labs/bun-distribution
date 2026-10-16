import { metadonneesAchillea } from "@/app/achillea/metadonnees";
import RankedClient from "./ranked-client";

/*
 * Page serveur : elle n'existe que pour porter `metadata`, que `"use client"`
 * interdit. L'interface, inchangée, vit dans `ranked-client.tsx`.
 */
export const metadata = metadonneesAchillea({
	titre: "Mode classé",
	description:
		"File d'attente 1v1 et 2v2, défis privés et profil ELO du mode classé Achilléa.",
	chemin: "/achillea/ranked",
	indexable: true,
});

export default function RankedPage() {
	return <RankedClient />;
}
