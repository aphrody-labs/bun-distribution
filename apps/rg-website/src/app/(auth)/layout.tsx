import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getServerUser } from "@/lib/auth-helpers";

// Formulaires de connexion et de récupération de mot de passe : aucun contenu à
// indexer, et une page de connexion en résultat de recherche n'aide personne.
// Les pages sont des composants client, elles ne peuvent pas porter ça elles-mêmes.
export const metadata: Metadata = {
  robots: { follow: false, index: false },
};

/**
 * Server-side guard pour les pages d'auth (login, forgot-password, reset).
 * Si l'utilisateur a déjà une session valide, on évite la confusion en le
 * renvoyant directement sur son espace.
 */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const user = await getServerUser();
  if (user) {
    redirect("/dashboard");
  }
  return <>{children}</>;
}
