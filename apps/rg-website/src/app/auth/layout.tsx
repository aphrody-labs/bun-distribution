import type { Metadata } from "next";
import type { ReactNode } from "react";

// Pages techniques du parcours d'authentification (erreur de code OAuth). Aucun
// contenu propre : rien à indexer. La page étant un composant client, la
// consigne doit vivre ici.
export const metadata: Metadata = {
  robots: { follow: false, index: false },
};

export default function AuthTechniqueLayout({ children }: { children: ReactNode }) {
  return children;
}
