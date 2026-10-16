import { metadonneesAchillea } from "@/app/achillea/metadonnees";
import ClansClient from "./clans-client";

/* La page serveur porte les métadonnées et transmet la recherche initiale au client. */
export const metadata = metadonneesAchillea({
  titre: "Clans compétitifs",
  description: "Les clans Achilléa d'Inazuma Eleven: Victory Road : recrutement et notoriété.",
  chemin: "/achillea/clans",
  indexable: true,
});

export default async function ClansPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const { q } = await searchParams;
  const initialQuery = typeof q === "string" ? q : (q?.[0] ?? "");
  return <ClansClient initialQuery={initialQuery} />;
}
