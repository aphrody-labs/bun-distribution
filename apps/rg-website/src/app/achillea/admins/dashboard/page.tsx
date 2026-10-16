import { metadonneesAchillea } from "@/app/achillea/metadonnees";
import AdminDashboardClient from "./admin-dashboard-client";

/*
 * Page serveur : elle n'existe que pour porter `metadata`, que `"use client"`
 * interdit. L'interface, inchangée, vit dans `admin-dashboard-client.tsx`.
 */
export const metadata = metadonneesAchillea({
  titre: "Tableau de bord administrateur",
  description: "Supervision du domaine compétitif Achilléa.",
  chemin: "/achillea/admins/dashboard",
  indexable: false,
});

export default function AdminDashboardPage() {
  return <AdminDashboardClient />;
}
