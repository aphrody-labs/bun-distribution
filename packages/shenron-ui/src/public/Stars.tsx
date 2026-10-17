/**
 * Affichage / saisie d'étoiles 1–5 (SVG). Présentation pure + mode interactif.
 */
"use client";

type StarsProps = {
  /** Valeur 0–5 (peut être fractionnaire pour la moyenne). */
  value: number;
  /** Taille visuelle. */
  size?: "sm" | "md" | "lg";
  /** Si true, les étoiles sont cliquables. */
  interactive?: boolean;
  /** Hover preview (0–5). */
  hover?: number | null;
  onHover?: (n: number | null) => void;
  onSelect?: (n: number) => void;
  /** Label accessibilité. */
  label?: string;
  className?: string;
};

const SIZE = {
  sm: "h-3.5 w-3.5",
  md: "h-5 w-5",
  lg: "h-7 w-7",
} as const;

function StarIcon({
  fill,
  className,
}: {
  /** 0 = vide, 1 = plein, 0.5 = demi (approx via clip). */
  fill: number;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(1, fill)) * 100;
  return (
    <span className={`relative inline-block ${className ?? ""}`} aria-hidden>
      {/* Contour vide */}
      <svg viewBox="0 0 24 24" className="absolute inset-0 text-white/20" fill="currentColor">
        <path d="M12 2.5l2.9 6.1 6.7.9-4.9 4.6 1.3 6.6L12 17.5 6 20.7l1.3-6.6L2.4 9.5l6.7-.9L12 2.5z" />
      </svg>
      {/* Remplissage orange */}
      <span className="absolute inset-0 overflow-hidden" style={{ width: `${pct}%` }}>
        <svg viewBox="0 0 24 24" className="h-full w-auto text-dbz-orange" fill="currentColor">
          <path d="M12 2.5l2.9 6.1 6.7.9-4.9 4.6 1.3 6.6L12 17.5 6 20.7l1.3-6.6L2.4 9.5l6.7-.9L12 2.5z" />
        </svg>
      </span>
    </span>
  );
}

export function Stars({
  value,
  size = "md",
  interactive = false,
  hover = null,
  onHover,
  onSelect,
  label = "Note",
  className = "",
}: StarsProps) {
  const display = hover != null ? hover : value;
  const sz = SIZE[size];

  return (
    <div
      className={`inline-flex items-center gap-0.5 ${className}`}
      role={interactive ? "radiogroup" : "img"}
      aria-label={interactive ? label : `${label} : ${value > 0 ? value.toFixed(1).replace(/\.0$/, "") : "—"} sur 5`}
    >
      {[1, 2, 3, 4, 5].map(n => {
        const fill = Math.max(0, Math.min(1, display - (n - 1)));
        if (!interactive) {
          return <StarIcon key={n} fill={fill} className={sz} />;
        }
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={Math.round(value) === n}
            aria-label={`${n} étoile${n > 1 ? "s" : ""}`}
            // Le dessin garde sa taille (`sz` reste sur l'icône) mais la zone
            // cliquable monte à 44 px : à 28 px, une étoile était hors de
            // portée du pouce. On élargit la boîte plutôt que d'employer
            // `.cible-44`, dont les zones se chevaucheraient d'une étoile à
            // l'autre et feraient noter à côté.
            className="grid min-h-11 min-w-11 cursor-pointer place-items-center rounded-lg transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dbz-orange"
            onMouseEnter={() => onHover?.(n)}
            onMouseLeave={() => onHover?.(null)}
            onFocus={() => onHover?.(n)}
            onBlur={() => onHover?.(null)}
            onClick={() => onSelect?.(n)}
          >
            <StarIcon fill={fill >= 0.5 ? 1 : 0} className={sz} />
          </button>
        );
      })}
    </div>
  );
}

/** Badge compact moyenne + count (listes / cartes). */
export function RatingBadge({
  average,
  count,
  className = "",
}: {
  average: number;
  count: number;
  className?: string;
}) {
  if (count <= 0) {
    return (
      <span
        className={`inline-flex items-center gap-1 text-[11px] font-display tracking-wide text-white/50 ${className}`}
      >
        <span className="text-white/25">★</span> Pas encore noté
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[12px] font-display font-semibold text-dbz-orange ${className}`}
      title={`${count} note${count > 1 ? "s" : ""}`}
    >
      <span aria-hidden>★</span>
      <span className="tabular-nums text-white">{average.toFixed(1)}</span>
      <span className="text-white/50 font-normal">({count})</span>
    </span>
  );
}
