import { metadonneesAchillea } from "@/app/achillea/metadonnees";
import RankedDisputesClient from "./ranked-disputes-client";

/*
 * Page serveur : elle n'existe que pour porter `metadata`, que `"use client"`
 * interdit. L'interface, inchangée, vit dans `ranked-disputes-client.tsx`.
 */
export const metadata = metadonneesAchillea({
	titre: "Litiges du mode classé",
	description:
		"Arbitrage des résultats contestés en mode classé Achilléa.",
	chemin: "/achillea/admins/ranked-disputes",
	indexable: false,
});

export default function RankedDisputesPage() {
	return <RankedDisputesClient />;
}
