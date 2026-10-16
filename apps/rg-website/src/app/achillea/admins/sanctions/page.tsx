import { metadonneesAchillea } from "@/app/achillea/metadonnees";
import SanctionsClient from "./sanctions-client";

/*
 * Page serveur : elle n'existe que pour porter `metadata`, que `"use client"`
 * interdit. L'interface, inchangée, vit dans `sanctions-client.tsx`.
 */
export const metadata = metadonneesAchillea({
  titre: "Sanctions",
  description: "Registre des sanctions prononcées sur le circuit Achilléa.",
  chemin: "/achillea/admins/sanctions",
  indexable: false,
});

export default function SanctionsPage() {
  return <SanctionsClient />;
}
