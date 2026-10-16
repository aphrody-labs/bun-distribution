import { metadonneesAchillea } from "@/app/achillea/metadonnees";
import ClanDashboardClient from "./clan-dashboard-client";

/*
 * Page serveur : elle n'existe que pour porter `metadata`, que `"use client"`
 * interdit. L'interface, inchangée, vit dans `clan-dashboard-client.tsx`.
 */
export const metadata = metadonneesAchillea({
	titre: "Tableau de bord de mon clan",
	description:
		"Gestion des membres, des candidatures et des invitations de votre clan Achilléa.",
	chemin: "/achillea/clans/dashboard",
	indexable: false,
});

export default function ClanDashboardPage() {
	return <ClanDashboardClient />;
}
