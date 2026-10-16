/**
 * Squelettes des pages du wiki — servis par les `loading.tsx` (frontière
 * Suspense de Next : affichés INSTANTANÉMENT pendant le rendu async de la page).
 *
 * Onze routes de l'encyclopédie n'en avaient aucun : entre le clic et le premier
 * pixel, l'écran restait sur la page précédente sans rien indiquer, et la
 * navigation paraissait bloquée alors qu'elle travaillait. Ces pages sont les
 * plus lourdes du site (1 307 personnages, 825 techniques, 318 databooks).
 *
 * Server Components purs (aucun JS) : l'animation vient de `animate-pulse`.
 */

/** En-tête typographique (le `PageHero` sans image). */
export function HeroSkeleton() {
  return (
    <section className="w-full border-b border-white/[0.08] py-16">
      <div className="mx-auto flex min-h-[160px] max-w-[1280px] flex-col justify-center px-6 lg:px-10">
        <div className="mb-4 h-3 w-32 animate-pulse rounded bg-white/10" />
        <div className="mb-4 h-12 w-2/3 max-w-xl animate-pulse rounded bg-white/15" />
        <div className="h-4 w-full max-w-lg animate-pulse rounded bg-white/10" />
      </div>
    </section>
  );
}

/** Grille de vignettes (personnages, planètes, databooks…). */
export function GridSkeleton({
  count = 24,
  ratio = "aspect-[3/4]",
}: {
  count?: number;
  /** Proportion des vignettes : 3/4 portrait, 2/3 affiche, video pour un scan. */
  ratio?: string;
}) {
  return (
    <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="space-y-2">
          <div
            className={`${ratio} animate-pulse rounded-lg bg-white/[0.06]`}
          />
          <div className="h-3 w-3/4 animate-pulse rounded bg-white/[0.06]" />
        </div>
      ))}
    </div>
  );
}

/** Liste de cartes larges (techniques, arcs, races). */
export function CardListSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="space-y-2.5 rounded-xl border border-white/[0.06] p-5"
        >
          <div className="h-4 w-1/2 animate-pulse rounded bg-white/10" />
          <div className="h-3 w-full animate-pulse rounded bg-white/[0.06]" />
          <div className="h-3 w-4/5 animate-pulse rounded bg-white/[0.06]" />
        </div>
      ))}
    </div>
  );
}

/** Barre d'outils d'un index (recherche + filtres + compteur). */
export function ToolbarSkeleton() {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="h-11 w-full max-w-md animate-pulse rounded-full bg-white/[0.06]" />
      <div className="h-11 w-28 animate-pulse rounded-full bg-white/[0.06]" />
      <div className="h-3 w-32 animate-pulse rounded bg-white/[0.06] sm:ml-auto" />
    </div>
  );
}

/** Page d'index complète — le montage le plus courant. */
export function IndexSkeleton({ children }: { children?: React.ReactNode }) {
  return (
    <div>
      <HeroSkeleton />
      <div className="w-full mx-auto max-w-[1400px] space-y-8 px-6 py-14 lg:px-10 lg:py-20">
        <ToolbarSkeleton />
        {children ?? <GridSkeleton />}
      </div>
    </div>
  );
}
