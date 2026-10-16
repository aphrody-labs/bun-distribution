import { Skeleton } from "@rosegriffon/ui";

/**
 * Squelette de la page « Mon compte ».
 *
 * ── IL DOIT RESSEMBLER À CE QUI ARRIVE ─────────────────────────────────────
 * Le précédent annonçait TROIS onglets là où la page en a quatre (profil,
 * adresse, connexions, sécurité), et posait deux cartes pleine largeur là où
 * l'onglet Profil ouvre sur une colonne d'avatar et un formulaire. Un squelette
 * qui ne préfigure pas la mise en page ne fait pas patienter : il fait sauter le
 * contenu au moment où il arrive, ce que le squelette est précisément censé
 * éviter.
 */
export default function AccountLoading() {
  return (
    <div className="container mx-auto space-y-8 p-6">
      {/* En-tête : retour, titre, adresse */}
      <div className="space-y-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-4 w-72" />
      </div>

      {/* Quatre onglets, comme la coquille */}
      <div className="flex flex-wrap gap-2 border-b border-border pb-2">
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-9 w-28" />
      </div>

      {/* Onglet Profil : carte avatar à gauche, formulaire à droite */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-4 rounded-xl border border-border p-6 lg:col-span-1">
          <Skeleton className="mx-auto size-28 rounded-full" />
          <Skeleton className="mx-auto h-5 w-32" />
          <Skeleton className="mx-auto h-4 w-20" />
          <Skeleton className="h-9 w-full rounded-full" />
        </div>

        <div className="space-y-5 rounded-xl border border-border p-6 lg:col-span-2">
          <Skeleton className="h-6 w-48" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-10 w-full" />
              </div>
            ))}
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-24 w-full" />
          </div>
          {/* Bannière + badges */}
          <Skeleton className="h-24 w-full rounded-xl" />
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-8 w-56 rounded-full" />
            <Skeleton className="h-8 w-40 rounded-full" />
          </div>
          <Skeleton className="h-10 w-40 rounded-full" />
        </div>
      </div>
    </div>
  );
}
