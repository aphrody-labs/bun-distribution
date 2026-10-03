"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { createAchilleaClient } from "@/lib/achillea";
import type {
  LeagueSeasonPayload,
  LeagueMatchRow,
} from "@rosegriffon/achillea-types/domain/league";
import {
  Trophy,
  ArrowLeft,
  Calendar,
  Users,
  Sparkles,
  Layers,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { signalerException } from "@/lib/achillea/signaler";

interface PlayoffResult {
  round: string;
  label: string;
  homeId: string;
  awayId: string;
  homeScore: number;
  awayScore: number;
}

function isPlayoffResult(value: unknown): value is PlayoffResult {
  if (typeof value !== "object" || value === null) return false;
  const result = value as Partial<PlayoffResult>;
  return (
    typeof result.round === "string" &&
    typeof result.label === "string" &&
    typeof result.homeId === "string" &&
    typeof result.awayId === "string" &&
    typeof result.homeScore === "number" &&
    typeof result.awayScore === "number"
  );
}

export default function AstralLeaguePage({
  initialSeason = null,
}: {
  initialSeason?: LeagueSeasonPayload | null;
}) {
  const [season, setSeason] = useState<LeagueSeasonPayload | null>(initialSeason);
  const [loading, setLoading] = useState<boolean>(initialSeason == null);
  const [activeTab, setActiveTab] = useState<"standings" | "matches" | "playoffs" | "rules">(
    "standings",
  );
  const [selectedMatchday, setSelectedMatchday] = useState<number>(1);

  useEffect(() => {
    let cancelled = false;

    const client = createAchilleaClient();

    client.leagues
      .astral("astral")
      .then((res) => {
        if (cancelled) return;
        if (res.ok && res.value) {
          setSeason(res.value);
        }
      })
      .catch((cause) => {
        signalerException("leagues/astral", cause);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const standings = useMemo(() => {
    if (!season?.standings) return [];
    return [...season.standings].sort((a, b) => a.rank - b.rank);
  }, [season]);

  const teamsMap = useMemo(() => {
    const map = new Map<string, string>();
    if (!season?.teams) return map;
    for (const t of season.teams) {
      map.set(t.tag, t.name);
    }
    return map;
  }, [season]);

  const totalMatchdays = season?.meta?.matchdays ?? 7;

  const matchdayResults = useMemo(() => {
    if (!season?.results) return [];
    return season.results.filter((m: LeagueMatchRow) => m.matchday === selectedMatchday);
  }, [season, selectedMatchday]);

  const playoffResults = useMemo(
    () => (Array.isArray(season?.playoffs) ? season.playoffs.filter(isPlayoffResult) : []),
    [season],
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-4 min-[600px]:px-6 min-[600px]:py-6">
      {/* Breadcrumb */}
      <div className="space-y-2 border-b border-border pb-4">
        <Link
          href="/achillea"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition mb-2"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Retour au hub Achilléa
        </Link>
        <div className="flex items-center gap-2">
          <span className="p-2 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <Trophy className="w-5 h-5" />
          </span>
          <h1 className="text-2xl font-bold tracking-tight min-[840px]:text-3xl">Astral League</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs font-medium text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Users className="w-4 h-4 text-primary" />
            {season?.teams?.length ?? 8} équipes
          </span>
          <span className="flex items-center gap-1.5">
            <Calendar className="w-4 h-4 text-primary" />
            {totalMatchdays} journées
          </span>
          <span className="flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-amber-400" />
            Top 4 Play-offs
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-border pb-px overflow-x-auto">
        <button
          type="button"
          onClick={() => setActiveTab("standings")}
          className={`px-4 py-2 text-xs font-semibold border-b-2 transition -mb-px flex items-center gap-1.5 ${
            activeTab === "standings"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Trophy className="w-3.5 h-3.5" />
          Classement Général
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("matches")}
          className={`px-4 py-2 text-xs font-semibold border-b-2 transition -mb-px flex items-center gap-1.5 ${
            activeTab === "matches"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Calendar className="w-3.5 h-3.5" />
          Calendrier & Journées
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("playoffs")}
          className={`px-4 py-2 text-xs font-semibold border-b-2 transition -mb-px flex items-center gap-1.5 ${
            activeTab === "playoffs"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Sparkles className="w-3.5 h-3.5 text-amber-400" />
          Play-offs (Final Four)
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("rules")}
          className={`px-4 py-2 text-xs font-semibold border-b-2 transition -mb-px flex items-center gap-1.5 ${
            activeTab === "rules"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          Format & Barème
        </button>
      </div>

      {loading ? (
        <div className="py-20 text-center space-y-3">
          <Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Chargement des données de l'Astral League...
          </p>
        </div>
      ) : (
        <>
          {/* Standings Tab */}
          {activeTab === "standings" && (
            <div className="border border-border rounded-2xl bg-card overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/40 text-muted-foreground uppercase text-xs tracking-wider">
                      <th className="py-3 px-4 w-12 text-center">Rang</th>
                      <th className="py-3 px-4">Équipe</th>
                      <th className="py-3 px-3 text-center">J</th>
                      <th className="py-3 px-3 text-center">V</th>
                      <th className="py-3 px-3 text-center">V.P.</th>
                      <th className="py-3 px-3 text-center">D</th>
                      <th className="py-3 px-3 text-center">D.P.</th>
                      <th className="py-3 px-3 text-center">BP</th>
                      <th className="py-3 px-3 text-center">BC</th>
                      <th className="py-3 px-3 text-center">Diff</th>
                      <th className="py-3 px-4 text-right">Points</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {standings.map((row) => {
                      const isPlayoffSpot = row.rank <= 4;
                      const teamName = teamsMap.get(row.teamId) || row.teamId;

                      return (
                        <tr
                          key={row.teamId}
                          className={`transition hover:bg-muted/30 ${
                            isPlayoffSpot ? "bg-primary/[0.02]" : ""
                          }`}
                        >
                          <td className="py-3 px-4 text-center font-bold">
                            <span
                              className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-extrabold ${
                                row.rank === 1
                                  ? "bg-amber-400 text-black"
                                  : row.rank === 2
                                    ? "bg-slate-300 text-black"
                                    : row.rank === 3
                                      ? "bg-amber-700 text-white"
                                      : isPlayoffSpot
                                        ? "bg-primary/20 text-primary"
                                        : "text-muted-foreground"
                              }`}
                            >
                              {row.rank}
                            </span>
                          </td>
                          <td
                            aria-label={teamName}
                            className="py-3 px-4 font-semibold text-foreground"
                          >
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                                {row.teamId}
                              </span>
                              <span>{teamName}</span>
                            </div>
                          </td>
                          <td className="py-3 px-3 text-center text-muted-foreground font-mono">
                            {row.played}
                          </td>
                          <td className="py-3 px-3 text-center font-semibold text-emerald-400 font-mono">
                            {row.wins}
                          </td>
                          <td className="py-3 px-3 text-center font-semibold text-emerald-300 font-mono">
                            {row.winsOt}
                          </td>
                          <td className="py-3 px-3 text-center text-rose-400 font-mono">
                            {row.losses}
                          </td>
                          <td className="py-3 px-3 text-center text-rose-300 font-mono">
                            {row.lossesOt}
                          </td>
                          <td className="py-3 px-3 text-center text-muted-foreground font-mono">
                            {row.mapsFor}
                          </td>
                          <td className="py-3 px-3 text-center text-muted-foreground font-mono">
                            {row.mapsAgainst}
                          </td>
                          <td
                            className={`py-3 px-3 text-center font-mono font-semibold ${
                              row.mapDiff > 0
                                ? "text-emerald-400"
                                : row.mapDiff < 0
                                  ? "text-rose-400"
                                  : "text-muted-foreground"
                            }`}
                          >
                            {row.mapDiff > 0 ? `+${row.mapDiff}` : row.mapDiff}
                          </td>
                          <td className="py-3 px-4 text-right font-black text-amber-400 font-mono text-sm">
                            {row.points} pts
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="p-3 bg-muted/20 border-t border-border flex items-center gap-2 text-xs text-muted-foreground">
                <span className="w-2.5 h-2.5 rounded-full bg-primary/40 inline-block" />
                <span>Les 4 premières équipes sont qualifiées pour les Play-offs.</span>
              </div>
            </div>
          )}

          {/* Matches / Matchday Tab */}
          {activeTab === "matches" && (
            <div className="space-y-4">
              {/* Matchday Selector */}
              <div className="flex items-center justify-between p-3 rounded-2xl bg-card border border-border">
                <button
                  type="button"
                  onClick={() => setSelectedMatchday((d) => Math.max(1, d - 1))}
                  disabled={selectedMatchday === 1}
                  className="p-1.5 rounded-lg border border-border hover:bg-muted disabled:opacity-40 transition"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="font-bold text-sm">
                  Journée {selectedMatchday} sur {totalMatchdays}
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedMatchday((d) => Math.min(totalMatchdays, d + 1))}
                  disabled={selectedMatchday >= totalMatchdays}
                  className="p-1.5 rounded-lg border border-border hover:bg-muted disabled:opacity-40 transition"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              {/* Matches list for current day */}
              {matchdayResults.length === 0 ? (
                <div className="border border-dashed border-border rounded-2xl p-12 text-center text-xs text-muted-foreground">
                  Aucune rencontre programmée pour cette journée.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {matchdayResults.map((match: LeagueMatchRow, idx: number) => {
                    const homeName = teamsMap.get(match.homeId) || match.homeId;
                    const awayName = teamsMap.get(match.awayId) || match.awayId;

                    return (
                      <div
                        key={idx}
                        className="border border-border bg-card rounded-2xl p-4 flex items-center justify-between gap-4"
                      >
                        <div className="text-right flex-1 min-w-0">
                          <div className="font-bold text-xs truncate">{homeName}</div>
                          <div className="text-xs font-mono text-muted-foreground">
                            [{match.homeId}]
                          </div>
                        </div>

                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-background border border-border font-mono font-bold text-sm shrink-0">
                          <span>{match.homeScore}</span>
                          <span className="text-muted-foreground">-</span>
                          <span>{match.awayScore}</span>
                        </div>

                        <div className="text-left flex-1 min-w-0">
                          <div className="font-bold text-xs truncate">{awayName}</div>
                          <div className="text-xs font-mono text-muted-foreground">
                            [{match.awayId}]
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Playoffs Final Four Tab */}
          {activeTab === "playoffs" && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-2xl bg-card border border-border">
                <div className="flex items-center gap-3">
                  <span className="p-2 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
                    <Trophy className="w-5 h-5" />
                  </span>
                  <div>
                    <h3 className="font-bold text-sm text-foreground uppercase tracking-wider">
                      Final Four — Play-offs Officiels
                    </h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Arbre à élimination directe réunissant les 4 meilleures équipes de la saison
                      régulière.
                    </p>
                  </div>
                </div>
                <span className="px-3 py-1 rounded-full bg-amber-500/10 text-amber-400 text-xs font-bold border border-amber-500/20">
                  Saison 1
                </span>
              </div>

              {season?.meta?.champion && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm font-bold text-amber-300">
                  Champion de la saison :{" "}
                  {teamsMap.get(season.meta.champion) ?? season.meta.champion}
                </div>
              )}

              {playoffResults.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
                  Aucun résultat de play-offs publié pour cette saison.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {playoffResults.map((match, index) => (
                    <article
                      key={`${match.round}-${index}`}
                      className="rounded-2xl border border-border bg-card p-5 shadow-xs"
                    >
                      <h4 className="mb-3 border-b border-border/60 pb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                        {match.label}
                      </h4>
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="min-w-0 truncate font-semibold">
                          {teamsMap.get(match.homeId) ?? match.homeId}
                        </span>
                        <span className="shrink-0 rounded-lg bg-background px-3 py-1 font-mono font-bold">
                          {match.homeScore} - {match.awayScore}
                        </span>
                        <span className="min-w-0 truncate text-right font-semibold">
                          {teamsMap.get(match.awayId) ?? match.awayId}
                        </span>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Rules Tab */}
          {activeTab === "rules" && (
            <div className="border border-border bg-card rounded-2xl p-6 space-y-4 text-xs text-muted-foreground leading-relaxed">
              <h3 className="font-bold text-sm text-foreground">Barème de Points Astral League</h3>
              <ul className="list-disc list-inside space-y-1.5">
                <li>
                  <b className="text-foreground">Victoire dans le temps réglementaire</b> :{" "}
                  {season?.pointsConfig?.winRegulation ?? 3} points.
                </li>
                <li>
                  <b className="text-foreground">Victoire en prolongation</b> :{" "}
                  {season?.pointsConfig?.winOvertime ?? 2} points.
                </li>
                <li>
                  <b className="text-foreground">Défaite en prolongation</b> :{" "}
                  {season?.pointsConfig?.lossOvertime ?? 1} point.
                </li>
                <li>
                  <b className="text-foreground">Défaite dans le temps réglementaire</b> :{" "}
                  {season?.pointsConfig?.lossRegulation ?? 0} point.
                </li>
              </ul>

              <h3 className="font-bold text-sm text-foreground pt-4 border-t border-border/60">
                Phase Finale (Play-offs)
              </h3>
              <p>
                Les 4 premières équipes accèdent à l'arbre des play-offs en match à élimination
                directe pour désigner le grand champion de la saison.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
