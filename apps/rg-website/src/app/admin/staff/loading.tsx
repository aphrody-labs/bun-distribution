import { Skeleton } from "@rosegriffon/ui";

/**
 * Squelette de chargement.
 *
 * Il reprend le gabarit exact de la page (même conteneur, en-tête, bande de
 * statistiques, barre de filtres, grille de cartes) : l'ancien squelette
 * utilisait `p-6` face au `max-w-7xl px-4 py-8` de la page, ce qui provoquait un
 * saut de mise en page au moment de l'hydratation.
 */
export default function StaffLoading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 lg:px-8">
      <div className="space-y-8">
        {/* En-tête */}
        <div className="flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <Skeleton className="size-10 shrink-0 rounded-lg" />
            <div className="space-y-2">
              <Skeleton className="h-8 w-56" />
              <Skeleton className="h-4 w-72 max-w-full" />
            </div>
          </div>
          <Skeleton className="h-10 w-full sm:w-44" />
        </div>

        {/* Statistiques */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-32 rounded-xl" />
          ))}
        </div>

        {/* Filtres */}
        <div className="flex flex-col gap-4 sm:flex-row">
          <Skeleton className="h-10 flex-1" />
          <Skeleton className="h-10 w-full sm:w-[250px]" />
          <Skeleton className="h-10 w-full sm:w-32" />
        </div>

        {/* Cartes de membres */}
        <div className="space-y-4">
          <Skeleton className="h-7 w-48" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }, (_, index) => (
              <Skeleton key={index} className="h-64 rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
