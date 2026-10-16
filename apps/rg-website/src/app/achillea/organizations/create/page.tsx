import { metadonneesAchillea } from "@/app/achillea/metadonnees";
import OrganizationCreateClient from "./organization-create-client";

/*
 * Page serveur : elle n'existe que pour porter `metadata`, que `"use client"`
 * interdit. L'interface, inchangée, vit dans `organization-create-client.tsx`.
 */
export const metadata = metadonneesAchillea({
	titre: "Enregistrer une organisation",
	description:
		"Déclarer une organisation esport auprès d'Achilléa pour la faire accréditer.",
	chemin: "/achillea/organizations/create",
	indexable: false,
});

export default function OrganizationCreatePage() {
	return <OrganizationCreateClient />;
}
