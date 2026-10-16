import type { Metadata } from "next";
import { rechercherPartout } from "@rosegriffon/search";

import { searchExecutors } from "@/lib/db/search";
import { absoluteUrl } from "@/lib/site-url";
import { SearchPageContent } from "./search-page";

export const metadata: Metadata = {
  alternates: { canonical: absoluteUrl("/search") },
  description: "Recherche unifiée dans tout le réseau Rose Griffon : Association, Wiki Azalée et E-Sport Achilléa.",
  robots: { follow: true, index: false },
  title: "Recherche unifiée | Rose Griffon",
};

export const dynamic = "force-dynamic";

export default function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string; tab?: string }> }) {
  return (
    <SearchPageContent
      searchParams={searchParams}
      search={async query => {
        return rechercherPartout(searchExecutors, query, { limiteParSource: 5, limiteTotale: 100 });
      }}
    />
  );
}
