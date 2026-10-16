"use client";

import type { RankedTierInfo } from "@rosegriffon/achillea-types";

interface TierDistributionProps {
  tiers?: RankedTierInfo[];
  highlightKey?: string | null;
  className?: string;
}

export function TierDistribution({ tiers = [], highlightKey, className }: TierDistributionProps) {
  const total = tiers.reduce((acc, t) => acc + (t.playerCount ?? 0), 0);
  const maxCount = Math.max(1, ...tiers.map(t => t.playerCount ?? 0));

  if (!tiers.length)
    return <output className="text-lg text-on-surface-variant">Répartition des paliers indisponible.</output>;

  const percent = (count: number) => {
    if (maxCount === 0) return 0;
    if (count === 0) return 0;
    return Math.max(2, Math.round((count / maxCount) * 100));
  };

  const percentLabel = (count: number) => {
    if (total === 0) return "0";
    const v = (count / total) * 100;
    if (v < 0.1 && count > 0) return "<0.1";
    return v.toFixed(1);
  };

  const gradient = (g?: string[] | null) => {
    if (!g || g.length < 2) return "linear-gradient(90deg, #555, #777)";
    return `linear-gradient(90deg, ${g.join(", ")})`;
  };

  return (
    <ul className={`flex flex-col gap-3 ${className ?? ""}`} aria-label="Répartition des joueurs par palier">
      {total === 0 && (
        <output className="text-lg text-on-surface-variant">
          Aucun joueur classé dans ces paliers pour le moment.
        </output>
      )}
      {tiers.map(t => {
        const isMine = t.key === highlightKey;
        return (
          <li
            key={t.key}

            aria-label={`${t.key} : ${t.playerCount ?? 0} joueur${(t.playerCount ?? 0) > 1 ? "s" : ""}, ${percentLabel(t.playerCount ?? 0)} %`}
            className={`flex items-center gap-3 transition-all text-lg ${
              isMine ? "font-bold text-primary" : "text-on-surface"
            }`}
          >
            <div className="w-28 md:w-36 text-right break-words">{t.key}</div>
            <div
              className={`flex-1 relative h-7 rounded-full overflow-hidden bg-surface-variant ${
                isMine ? "ring-2 ring-primary ring-offset-1" : ""
              }`}
            >
              <div
                className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
                style={{
                  width: `${percent(t.playerCount ?? 0)}%`,
                  background: gradient(t.gradient),
                }}
              />
            </div>
            <div className="font-mono w-28 md:w-32 text-right tabular-nums">
              {t.playerCount ?? 0}
              <span className="opacity-60 ml-1">({percentLabel(t.playerCount ?? 0)}%)</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
