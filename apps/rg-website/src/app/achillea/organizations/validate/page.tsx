import { metadonneesAchillea } from "@/app/achillea/metadonnees";
import OrganizationValidateClient from "./organization-validate-client";

/*
 * Page serveur : elle n'existe que pour porter `metadata`, que `"use client"`
 * interdit. L'interface, inchangée, vit dans `organization-validate-client.tsx`.
 */
export const metadata = metadonneesAchillea({
  titre: "Organisations à valider",
  description: "File de validation des organisations esport candidates à l'accréditation.",
  chemin: "/achillea/organizations/validate",
  indexable: false,
});

export default function OrganizationValidatePage() {
  return <OrganizationValidateClient />;
}
