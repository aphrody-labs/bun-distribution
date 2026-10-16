import Image from "next/image";
import Link from "next/link";
import { rankImagePath } from "@/lib/achillea";
import { ArrowRight, Crown } from "lucide-react";
import type { RankedTierInfo } from "@rosegriffon/achillea-types";

const TIER_COLORS: Record<string, string> = {
  Fer: "#959595",
  Bronze: "#b17253",
  Argent: "#7facb8",
  Or: "#c2ad88",
  Platine: "#897e8b",
  Diamant: "#88f6ff",
  Émeraude: "#2d925c",
  Rubis: "#ff5648",
  Divin: "#7edcb5",
  Supernova: "#f010ff",
  Légendaire: "#ffa910",
};

export function RankedTiersGrid({
  tiers,
  className = "",
}: {
  tiers: RankedTierInfo[];
  className?: string;
}) {
  return (
    <section
      aria-labelledby="ranked-tiers-title"
      className={`max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6 ${className}`}
    >
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-outline/15 pb-4">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-achillea-purple/25 border border-achillea-lime/40 text-achillea-lime text-lg font-bold uppercase tracking-wider">
            <Crown className="size-3.5" />
            Progression &amp; Classement
          </div>
          <h2
            id="ranked-tiers-title"
            className="text-2xl sm:text-3xl font-black text-on-surface tracking-tight"
          >
            L&apos;Échelle des 11 Paliers ELO
          </h2>
          <p className="text-lg text-on-surface-variant max-w-2xl">
            Franchissez les seuils de points d&apos;action (AP) en match classé 1v1 et 2v2 pour
            faire évoluer votre palier et débloquer les insignes officiels.
          </p>
        </div>

        <Link
          href="/achillea/ranked/tiers"
          className="inline-flex min-h-11 items-center gap-1.5 text-lg font-bold text-achillea-lime hover:underline shrink-0 group rounded-lg focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-achillea-lime"
        >
          Répartition complète des joueurs
          <ArrowRight className="size-3.5 group-hover:translate-x-0.5 transition-transform" />
        </Link>
      </div>

      {tiers.length === 0 ? (
        <output className="text-lg text-on-surface-variant">
          Les seuils Achilléa sont temporairement indisponibles.
        </output>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {tiers.map((tier, index) => {
            const badgeUrl = rankImagePath(tier.key, "/achillea/ranks");
            const level = index + 1;
            const color = TIER_COLORS[tier.key] ?? "#959595";
            const pointsLabel =
              tier.maxElo >= 9000 ? `${tier.minElo}+ AP` : `${tier.minElo} - ${tier.maxElo} AP`;

            return (
              <Link
                key={tier.key}
                href="/achillea/ranked/tiers"
                className="group relative flex min-h-11 flex-col items-center p-3 rounded-2xl bg-surface/80 border border-outline/20 hover:border-achillea-lime/60 hover:bg-surface hover:shadow-xl transition-all duration-300 text-center overflow-hidden focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-achillea-lime"
              >
                {/* Subtle top indicator with tier gradient */}
                <div className="absolute top-0 inset-x-0 h-1" style={{ backgroundColor: color }} />

                {/* Rank Badge Image */}
                <div className="relative size-14 sm:size-16 my-2 group-hover:scale-110 transition-transform duration-300 drop-shadow-md">
                  <Image
                    src={badgeUrl}
                    alt={`Badge Palier ${tier.key}`}
                    fill
                    unoptimized
                    className="object-contain"
                  />
                </div>

                {/* Tier Name */}
                <h3 className="text-lg font-black text-on-surface group-hover:text-achillea-lime transition-colors">
                  {tier.key}
                </h3>

                {/* Points range */}
                <span className="text-lg font-bold text-on-surface-variant font-mono tabular-nums mt-0.5">
                  {pointsLabel}
                </span>

                {/* Micro level indicator */}
                <span className="text-lg uppercase tracking-wider text-on-surface-variant mt-1">
                  Rang #{level}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
