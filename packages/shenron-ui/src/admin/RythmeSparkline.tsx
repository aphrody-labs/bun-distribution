/**
 * Courbe des dépôts de transcription sur 30 jours.
 *
 * SVG rendu côté serveur, sans librairie de graphes : la page admin en affiche
 * un seul, et importer une dépendance de charting pour 30 points coûterait plus
 * de kilo-octets que toute la page. Même parti pris que `/admin/activite`.
 *
 * Un « point » = une révision de `db_databooks`, c'est-à-dire un lot déposé —
 * pas une planche. C'est l'unité réelle du travail, et la seule que
 * `wiki_revisions` permette de compter (il stocke un instantané de la fiche,
 * pas un delta par planche).
 */
const LARGEUR = 720;
const HAUTEUR = 56;

export function RythmeSparkline({
  points,
}: {
  points: { jour: string; revisions: number }[];
}) {
  if (points.length < 2) return null;

  const max = Math.max(...points.map((p) => p.revisions), 1);
  const pas = LARGEUR / (points.length - 1);
  const y = (v: number) => HAUTEUR - (v / max) * (HAUTEUR - 6) - 3;
  const ligne = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${i * pas},${y(p.revisions)}`)
    .join(" ");
  const aire = `${ligne} L${LARGEUR},${HAUTEUR} L0,${HAUTEUR} Z`;

  const totalRevisions = points.reduce((n, p) => n + p.revisions, 0);
  const premier = points[0];
  const dernier = points[points.length - 1];
  const jourLisible = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "short",
    });

  return (
    <figure className="mt-4">
      <figcaption className="mb-1.5 flex items-baseline justify-between text-[10px] uppercase tracking-widest text-white/40">
        <span>Dépôts sur 30 jours</span>
        <span className="tabular-nums text-white/55">
          {totalRevisions} révision{totalRevisions > 1 ? "s" : ""} · pic {max}
          /jour
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${LARGEUR} ${HAUTEUR}`}
        preserveAspectRatio="none"
        className="h-14 w-full"
        role="img"
        aria-label={`Dépôts de transcription du ${jourLisible(premier.jour)} au ${jourLisible(dernier.jour)} : ${totalRevisions} révisions, maximum ${max} en une journée.`}
      >
        <path d={aire} fill="currentColor" className="text-dbz-orange/15" />
        <path
          d={ligne}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          className="text-dbz-orange"
        />
      </svg>
      <div className="flex justify-between text-[10px] tabular-nums text-white/35">
        <span>{jourLisible(premier.jour)}</span>
        <span>{jourLisible(dernier.jour)}</span>
      </div>
    </figure>
  );
}
