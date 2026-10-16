import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@rosegriffon/ui";
import { BarChart3 } from "lucide-react";
import type { Metadata } from "next";

import { BreadcrumbSchema, PageContainer, PageHero } from "@/components/shared";
import { WikiPagination } from "@/components/shared/WikiPagination";
import {
  SONDAGES_PAR_PAGE,
  compterSondages,
  construireContexteSondages,
  listerSondages,
  normaliserStatut,
} from "@/lib/discord/polls";
import { absoluteUrl } from "@/lib/site-url";
import { parseSearchParams } from "@/lib/validations";

import { CarteSondage } from "./_components/CarteSondage";
import { FiltresSondages } from "./_components/FiltresSondages";

// Les sondages sont archivés par le cron une fois par jour : une page figée une
// heure suffit largement et évite de rejouer les requêtes à chaque visite.
export const revalidate = 3600;

export const metadata: Metadata = {
  alternates: { canonical: absoluteUrl("/sondages") },
  description:
    "Les sondages posés à la communauté Rose Griffon sur Discord : questions, choix, résultats détaillés et participation.",
  openGraph: {
    description: "Questions, choix et résultats des sondages de la communauté Rose Griffon sur Discord.",
    title: "Sondages de la communauté · Rose Griffon",
    type: "website",
    url: absoluteUrl("/sondages"),
  },
  title: "Sondages de la communauté · Rose Griffon",
};

export default async function PageSondages({
  searchParams,
}: {
  // Next 16 : `searchParams` est une promesse, il faut l'attendre.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  // `page` et `q` passent par le schéma zod partagé du site ; `statut` n'y
  // figure pas (zod retire les clés inconnues) et se valide contre sa propre
  // liste blanche.
  const { page, q } = parseSearchParams(params);
  const statut = normaliserStatut(params.statut);
  const recherche = q ?? "";

  const [{ sondages, total }, compteurs] = await Promise.all([
    listerSondages({ page, parPage: SONDAGES_PAR_PAGE, q: recherche, statut }),
    compterSondages(),
  ]);
  const contexte = await construireContexteSondages(sondages);

  return (
    <PageContainer>
      <BreadcrumbSchema
        items={[
          { item: "/", name: "Accueil" },
          { item: "/sondages", name: "Sondages" },
        ]}
      />

      <PageHero
        description="Ce que la communauté Rose Griffon a voté, question par question : les sondages du serveur Discord, avec leurs choix, leurs résultats et leur participation."
        eyebrow="Salon 🧐〡sondages"
        icon={<BarChart3 className="size-6 text-rg-or" aria-hidden />}
        title="Les sondages de la communauté"
      />

      <FiltresSondages
        enCours={compteurs.enCours}
        q={recherche}
        resultats={total}
        statut={statut}
        total={compteurs.total}
      />

      {sondages.length === 0 ? (
        <Empty className="rounded-[40px] border-2 border-dashed border-outline-variant/30 bg-surface-container-lowest py-24">
          <EmptyHeader>
            <EmptyTitle>Aucun sondage à afficher</EmptyTitle>
            <EmptyDescription>
              {recherche
                ? `Aucune question ne contient « ${recherche} ». Essayez un autre mot, ou revenez à la liste complète.`
                : "Les sondages du salon Discord apparaîtront ici dès leur prochain archivage."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <div className="grid gap-6 lg:grid-cols-2">
            {sondages.map(sondage => (
              <CarteSondage key={sondage.poll_id} contexte={contexte} sondage={sondage} />
            ))}
          </div>

          {/* `WikiPagination` ne réécrit que `page` : la recherche et le filtre
					    d'état survivent au changement de page. */}
          <WikiPagination currentPage={page} itemsPerPage={SONDAGES_PAR_PAGE} totalItems={total} />
        </>
      )}
    </PageContainer>
  );
}
