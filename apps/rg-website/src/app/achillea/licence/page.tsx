import { metadonneesAchillea } from "@/app/achillea/metadonnees";
import LicenceClient from "./licence-client";

/*
 * Page serveur : elle n'existe que pour porter `metadata`, que `"use client"`
 * interdit. L'interface, inchangée, vit dans `licence-client.tsx`.
 */
export const metadata = metadonneesAchillea({
  titre: "Ma licence compétiteur",
  description: "Votre licence compétiteur Achilléa, son statut et son QR de vérification.",
  chemin: "/achillea/licence",
  indexable: false,
});

export default function LicencePage() {
  return <LicenceClient />;
}
