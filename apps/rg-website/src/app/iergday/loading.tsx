import { Skeleton } from "@rosegriffon/ui";

import { PageContainer } from "@/components/shared/PageShell";

/*
 * Squelette de chargement : même gabarit que la page réelle (bannière puis
 * grille 1 → 4 colonnes) pour éviter le saut de mise en page à l'arrivée des
 * données. Aucune couleur en dur — `Skeleton` porte déjà `bg-accent`.
 */
export default function ChargementCampagne() {
  return (
    <PageContainer>
      <Skeleton className="h-64 rounded-3xl md:h-80" />

      <div className="space-y-6">
        <Skeleton className="h-10 w-64 rounded-full" />
        <ul className="grid list-none grid-cols-1 gap-4 p-0 xs:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, index) => index).map(index => (
            <li key={`squelette-${index}`}>
              <Skeleton className="aspect-4/5 w-full rounded-[24px]" />
            </li>
          ))}
        </ul>
      </div>
    </PageContainer>
  );
}
