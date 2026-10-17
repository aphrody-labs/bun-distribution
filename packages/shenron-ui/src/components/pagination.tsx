"use client";

/**
 * Pagination — barre de navigation par pages pour les listes filtrées côté
 * client (grille de personnages, index longs).
 *
 * La fenêtre est bornée, la position est écrite dans l'URL (`?p=3`, en
 * `replaceState` — aucun aller-retour serveur), et le lecteur sait toujours où
 * il en est. Première et dernière pages toujours visibles, une fenêtre
 * glissante autour de la page courante (`pagesVisibles`), des ellipses
 * ailleurs.
 *
 * Aucune chaîne n'est figée dans le rendu : libellés et locale arrivent en
 * props, avec pour défauts les textes français historiques du site.
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import { ChevronDroite, ChevronGauche } from "../icones";
import { pagesVisibles } from "../lib/page-window";

export { pagesVisibles };

export type PaginationLabels = {
  /** Nom accessible du chevron « précédent ». */
  previous: string;
  /** Nom accessible du chevron « suivant ». */
  next: string;
  /**
   * Gabarit du compteur. Jetons : `{start}`, `{end}`, `{total}`, `{unit}`
   * (nombres déjà formatés selon `locale`).
   */
  range: string;
  /** Nom des éléments comptés (« 121–240 sur 1 307 fiches »). */
  unit: string;
  /** Nom accessible de la région de navigation. */
  nav: string;
};

export const DEFAULT_PAGINATION_LABELS: PaginationLabels = {
  previous: "Page précédente",
  next: "Page suivante",
  range: "{start}–{end} sur {total} {unit}",
  unit: "résultats",
  nav: "Pagination",
};

function formatRange(template: string, values: Record<string, string>): string {
  return template.replace(/\{(start|end|total|unit)\}/g, (_, k: string) => values[k] ?? "");
}

export function Pagination({
  page,
  parPage,
  total,
  onPageChange,
  /** Paramètre d'URL synchronisé. `null` = ne rien écrire dans l'URL. */
  urlParam = "p",
  locale = "fr-FR",
  labels,
  className = "",
}: {
  page: number;
  parPage: number;
  total: number;
  onPageChange: (page: number) => void;
  urlParam?: string | null;
  locale?: string;
  labels?: Partial<PaginationLabels>;
  className?: string;
}) {
  const l = { ...DEFAULT_PAGINATION_LABELS, ...labels };
  const nf = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const navRef = useRef<HTMLElement | null>(null);
  const boutonCourantRef = useRef<HTMLButtonElement | null>(null);
  // Armé par un chevron seulement : lui seul peut se désactiver sous le doigt.
  const rendreLeFocus = useRef(false);
  const pages = Math.max(1, Math.ceil(total / parPage));
  const debut = total === 0 ? 0 : (page - 1) * parPage + 1;
  const fin = Math.min(total, page * parPage);
  const numeros = useMemo(() => pagesVisibles(page, pages), [page, pages]);

  useEffect(() => {
    if (!urlParam) return;
    const url = new URL(window.location.href);
    if (page <= 1) url.searchParams.delete(urlParam);
    else url.searchParams.set(urlParam, String(page));
    window.history.replaceState(null, "", url.toString());
  }, [page, urlParam]);

  // Atteindre la première ou la dernière page DÉSACTIVE le chevron pressé : le
  // focus retomberait sur `<body>`. On le rattrape sur le numéro courant.
  useEffect(() => {
    if (!rendreLeFocus.current) return;
    rendreLeFocus.current = false;
    const actif = document.activeElement;
    if (actif && actif !== document.body && navRef.current?.contains(actif)) return;
    boutonCourantRef.current?.focus({ preventScroll: true });
  }, [page]);

  const aller = useCallback(
    (p: number, rendreFocus = false) => {
      const cible = Math.min(pages, Math.max(1, p));
      if (cible === page) return;
      rendreLeFocus.current = rendreFocus;
      onPageChange(cible);
      // Défilement INSTANTANÉ sous `prefers-reduced-motion` (WCAG 2.3.3).
      const moinsDAnimation = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      window.scrollTo({
        top: 0,
        behavior: moinsDAnimation ? "auto" : "smooth",
      });
    },
    [page, pages, onPageChange],
  );

  if (total === 0) return null;

  // h-11/min-w-11 = 44 px de cible tactile ; `px-1.5` pour tenir à 320 px.
  const btn =
    "grid h-11 min-w-11 place-items-center rounded-lg px-1.5 font-display text-[14px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dbz-orange/60 disabled:cursor-not-allowed disabled:opacity-35";

  return (
    <div className={`flex flex-col items-center gap-3 ${className}`}>
      <p className="font-scouter text-[11px] tabular-nums text-white/45">
        {formatRange(l.range, {
          start: nf.format(debut),
          end: nf.format(fin),
          total: nf.format(total),
          unit: l.unit,
        })}
      </p>

      {pages > 1 && (
        <nav ref={navRef} aria-label={l.nav} className="flex max-w-full flex-wrap items-center justify-center gap-1">
          <button
            type="button"
            onClick={() => aller(page - 1, true)}
            disabled={page <= 1}
            aria-label={l.previous}
            className={`${btn} text-white/70 hover:bg-white/[0.06] hover:text-white`}
          >
            <ChevronGauche className="h-4 w-4" />
          </button>

          {numeros.map((n, i) =>
            n === null ? (
              <span key={`gap-${i}`} aria-hidden className="grid h-11 w-5 place-items-center text-white/30">
                …
              </span>
            ) : (
              <button
                key={n}
                type="button"
                ref={n === page ? boutonCourantRef : undefined}
                onClick={() => aller(n)}
                aria-current={n === page ? "page" : undefined}
                aria-label={`Page ${n}`}
                className={`${btn} tabular-nums ${
                  n === page ? "bg-dbz-orange text-black" : "text-white/70 hover:bg-white/[0.06] hover:text-white"
                }`}
              >
                {n}
              </button>
            ),
          )}

          <button
            type="button"
            onClick={() => aller(page + 1, true)}
            disabled={page >= pages}
            aria-label={l.next}
            className={`${btn} text-white/70 hover:bg-white/[0.06] hover:text-white`}
          >
            <ChevronDroite className="h-4 w-4" />
          </button>
        </nav>
      )}
    </div>
  );
}
