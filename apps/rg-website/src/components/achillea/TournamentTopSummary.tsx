"use client";

import { useResetState } from "@/hooks/use-reset-state";

import React, { useEffect, useState } from "react";
import { createAchilleaClient } from "@/lib/achillea";
import { UserAvatar } from "./UserAvatar";
import { Trophy, Loader2 } from "lucide-react";
import type { TournamentSummary } from "@rosegriffon/achillea-types";

interface TournamentTopSummaryProps {
  tournamentId: number;
  isFinished?: boolean;
}

export function TournamentTopSummary({
  tournamentId,
  isFinished = false,
}: TournamentTopSummaryProps) {
  const [attempt, setAttempt] = useState(0);
  const requestKey = `${tournamentId}:${attempt}`;
  const [summary, setSummary] = useResetState<TournamentSummary | null>(null, requestKey);
  const [loading, setLoading] = useResetState<boolean>(true, requestKey);
  const [error, setError] = useResetState<string | null>(null, requestKey);

  useEffect(() => {
    let cancelled = false;
    const client = createAchilleaClient();

    client.tournaments
      .summary(tournamentId)
      .then((res) => {
        if (cancelled) return;
        if (res.ok && res.value) {
          setSummary(res.value);
        } else {
          setError("Le classement est temporairement indisponible.");
        }
      })
      .catch(() => {
        if (!cancelled) setError("La connexion au serveur a échoué.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [tournamentId, attempt]);

  if (loading) {
    return (
      <output aria-live="polite" className="py-8 text-center space-y-2">
        <Loader2 className="w-6 h-6 animate-spin text-amber-400 mx-auto" />
        <p className="text-lg text-muted-foreground">Chargement des classements et du podium…</p>
      </output>
    );
  }

  if (error)
    return (
      <div
        role="alert"
        className="rounded-2xl border border-rose-500/50 bg-rose-500/10 p-6 text-lg space-y-4"
      >
        <p>{error}</p>
        <button
          type="button"
          onClick={() => setAttempt((value) => value + 1)}
          className="min-h-11 rounded-lg border border-current px-5 font-semibold focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-amber-300"
        >
          Réessayer
        </button>
      </div>
    );

  if (!summary?.top10?.length)
    return (
      <output className="rounded-2xl border border-border bg-card p-6 text-lg space-y-2">
        <h3 className="font-bold">
          {isFinished ? "Classement non résolu" : "Aucun classement disponible"}
        </h3>
        <p className="text-muted-foreground">
          {isFinished
            ? "Les résultats enregistrés ne permettent pas encore de valider le bracket et le podium. Aucun rang ni point de circuit n'est attribué ici."
            : "Le tournoi n'a pas encore de classement confirmé. Revenez après la validation des matchs."}
        </p>
      </output>
    );

  const podium = summary.top10.filter((entry) => entry.rank <= 3);
  const rest = summary.top10.filter((entry) => entry.rank > 3);

  return (
    <div className="space-y-6">
      {/* Podium Section */}
      <div className="border border-border bg-card rounded-3xl p-6 shadow-xs space-y-6">
        <div className="flex items-center gap-2 border-b border-border pb-3">
          <span className="p-2 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <Trophy className="w-4 h-4" />
          </span>
          <h3 className="font-bold text-lg uppercase tracking-wider text-foreground">
            Classement (ex æquo inclus)
          </h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
          {podium.map((entry, idx) => {
            const isWinner = entry.rank === 1;
            const isSecond = entry.rank === 2;

            const medalBg = isWinner
              ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
              : isSecond
                ? "bg-slate-400/10 border-slate-400/30 text-slate-300"
                : "bg-amber-700/10 border-amber-700/30 text-amber-600";

            return (
              <div
                key={entry.userId || idx}
                className={`p-5 rounded-2xl border text-center space-y-3 flex flex-col items-center justify-center relative shadow-xs ${medalBg}`}
              >
                <div className="absolute top-3 left-3 font-mono font-black text-lg">
                  #{entry.rank}
                </div>

                <UserAvatar
                  avatar={entry.avatar}
                  displayName={entry.displayName}
                  className="w-14 h-14 ring-2 ring-border shadow-md"
                />

                <div className="space-y-0.5">
                  <div className="font-bold text-lg text-foreground truncate max-w-[150px]">
                    {entry.displayName}
                  </div>
                  {entry.clan && (
                    <div className="text-lg text-muted-foreground font-semibold">
                      [{entry.clan.shortName}] {entry.clan.name}
                    </div>
                  )}
                </div>

                {entry.points > 0 && (
                  <div className="px-2.5 py-1 rounded-full bg-amber-500/20 text-amber-400 text-lg font-mono font-bold flex items-center gap-1">
                    +{entry.points} points de circuit
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Classement hors podium, ex æquo inclus. */}
      {rest.length > 0 && (
        <div className="border border-border bg-card rounded-2xl overflow-hidden shadow-xs">
          <div className="p-4 bg-muted/30 border-b border-border text-lg font-bold uppercase tracking-wider text-muted-foreground">
            Autres places classées
          </div>
          <div className="divide-y divide-border/60">
            {rest.map((entry, idx) => (
              <div
                key={entry.userId || idx}
                className="p-3 px-4 flex flex-wrap items-center justify-between gap-3 text-lg hover:bg-muted/20 transition"
              >
                <div className="flex items-center gap-3">
                  <span className="font-mono font-bold text-muted-foreground min-w-6">
                    {entry.rankLabel}
                  </span>
                  <UserAvatar
                    avatar={entry.avatar}
                    displayName={entry.displayName}
                    className="w-7 h-7"
                  />
                  <span className="font-semibold text-foreground">{entry.displayName}</span>
                  {entry.clan && (
                    <span className="text-lg text-muted-foreground">[{entry.clan.shortName}]</span>
                  )}
                </div>

                {entry.points > 0 && (
                  <span className="font-mono font-bold text-amber-400">
                    +{entry.points} points de circuit
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
