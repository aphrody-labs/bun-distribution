"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { createAchilleaClient, rankImagePath } from "@/lib/achillea";
import { TierDistribution } from "@/components/achillea/TierDistribution";
import type { RankedTierInfo } from "@rosegriffon/achillea-types";
import { Layers, ArrowLeft, Sparkles, TrendingUp } from "lucide-react";
import { signalerException } from "@/lib/achillea/signaler";

export default function RankedTiersPage({
  initialTiers,
}: {
  initialTiers?: RankedTierInfo[] | null;
}) {
  const [mode, setMode] = useState<2 | 4>(2);
  const [tiers, setTiers] = useState<RankedTierInfo[]>(initialTiers ?? []);
  const [loading, setLoading] = useState<boolean>(initialTiers == null);
  const [error, setError] = useState<string | null>(null);

  const [requestIdentity1, setRequestIdentity1] = useState<readonly unknown[]>([mode]);
  if ([mode].some((value, position) => !Object.is(value, requestIdentity1[position]))) {
    setRequestIdentity1([mode]);
    (() => {
      setLoading(true);
      setError(null);
    })();
  }
  useEffect(() => {
    let cancelled = false;

    const client = createAchilleaClient();

    client.ranked
      .tiers(mode)
      .then((res) => {
        if (cancelled) return;
        if (res.ok) setTiers(res.value);
        else setError("Les paliers sont momentanément indisponibles.");
      })
      .catch((cause) => {
        signalerException("ranked/tiers", cause);
        if (!cancelled) setError("Les paliers sont momentanément indisponibles.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [mode]);

  const totalPlayers = tiers.reduce((acc, t) => acc + (t.playerCount || 0), 0);

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-6">
        <div className="space-y-1">
          <Link
            href="/achillea/ranked"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg text-lg text-muted-foreground hover:text-foreground transition mb-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Retour au hub classé
          </Link>
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20">
              <Layers className="w-5 h-5" />
            </span>
            <h1 className="text-3xl font-bold tracking-tight">Paliers Compétitifs</h1>
          </div>
          <p className="text-lg text-muted-foreground">
            Découvrez les 11 échelons du classement Achilléa, les seuils d'AP et la répartition des
            compétiteurs.
          </p>
        </div>

        {/* Mode switch */}
        <div className="flex items-center p-1 bg-muted rounded-lg self-start sm:self-auto">
          <button
            type="button"
            aria-pressed={mode === 2}
            onClick={() => setMode(2)}
            className={`min-h-11 px-4 py-1.5 text-lg font-semibold rounded-md transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
              mode === 2
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            1 contre 1 (Solo)
          </button>
          <button
            type="button"
            aria-pressed={mode === 4}
            onClick={() => setMode(4)}
            className={`min-h-11 px-4 py-1.5 text-lg font-semibold rounded-md transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
              mode === 4
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            2 contre 2 (Duo)
          </button>
        </div>
      </div>

      {/* Distribution bar */}
      <div className="border border-border bg-card rounded-2xl p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-primary" />
            <h3 className="font-semibold text-lg">Répartition globale des joueurs</h3>
          </div>
          <span className="text-lg text-muted-foreground">
            {totalPlayers > 0 ? `${totalPlayers} compétiteurs actifs` : "Saison active"}
          </span>
        </div>
        {loading && tiers.length === 0 ? (
          <output className="text-lg text-muted-foreground">Chargement des paliers…</output>
        ) : error && tiers.length === 0 ? (
          <p role="alert" className="text-lg text-rose-400">
            {error}
          </p>
        ) : (
          <TierDistribution tiers={tiers} />
        )}
        {error && tiers.length > 0 && (
          <output className="text-lg text-amber-400">
            {error} Les dernières données chargées restent affichées.
          </output>
        )}
      </div>

      {/* Tiers Grid */}
      {tiers.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {tiers.map((tier, idx) => {
            const badgePath = rankImagePath(tier.key, "/ranks");
            const gradient =
              tier.gradient?.length >= 2
                ? `linear-gradient(135deg, ${tier.gradient.join(", ")})`
                : "linear-gradient(135deg, #959595, #494949)";
            const pct = totalPlayers > 0 ? Math.round((tier.playerCount / totalPlayers) * 100) : 0;
            const isTopTier = idx >= 8; // Divin, Supernova, Légendaire

            return (
              <div
                key={tier.key}
                className={`border rounded-2xl p-5 bg-card relative overflow-hidden transition hover:shadow-md ${
                  isTopTier ? "border-amber-500/40" : "border-border"
                }`}
              >
                {isTopTier && (
                  <div className="absolute -right-8 -top-8 w-24 h-24 bg-amber-500/10 rounded-full blur-xl pointer-events-none" />
                )}

                <div className="flex items-start gap-4">
                  <div
                    className="w-16 h-16 rounded-xl p-2 flex items-center justify-center shrink-0 shadow-md relative"
                    style={{ background: gradient }}
                  >
                    <Image
                      src={badgePath}
                      alt={tier.key}
                      width={48}
                      height={48}
                      className="object-contain drop-shadow"
                    />
                  </div>

                  <div className="space-y-1 flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="font-bold text-base truncate">{tier.key}</h4>
                      <span className="text-lg font-mono font-bold text-amber-400">
                        {tier.minElo} {tier.maxElo < 9000 ? `- ${tier.maxElo}` : "+"} AP
                      </span>
                    </div>

                    <p className="text-lg text-muted-foreground">Palier {idx + 1} sur 11</p>

                    <div className="flex items-center justify-between gap-3 text-lg pt-2 border-t border-border/60 text-muted-foreground">
                      <span>{tier.playerCount} joueurs</span>
                      <span className="font-semibold text-foreground">{pct}% de l'effectif</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Progression note */}
      <div className="p-6 rounded-2xl bg-muted/30 border border-border space-y-2 text-lg text-muted-foreground">
        <h4 className="font-semibold text-foreground text-lg flex items-center gap-1.5">
          <Sparkles className="w-4 h-4 text-amber-400" />
          Règles du système d'AP (Achilléa Points)
        </h4>
        <p>
          Le barème ELO utilise un coefficient K progressif et asymétrique : les premiers paliers
          (Fer à Or) bénéficient d'un gain plus élevé (+20 AP) que de perte (-5 AP) pour encourager
          la progression. À partir du palier Divin, les gains et pertes s'équilibrent de manière
          symétrique (±16 AP) à niveau égal.
        </p>
      </div>
    </div>
  );
}
