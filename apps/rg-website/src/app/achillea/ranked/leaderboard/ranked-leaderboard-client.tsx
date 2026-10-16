"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createAchilleaClient } from "@/lib/achillea";
import type { LeaderboardPage, RankedTierInfo } from "@rosegriffon/achillea-types";
import { UserAvatar } from "@/components/achillea/UserAvatar";
import { Trophy, Search, Loader2, ChevronLeft, ChevronRight, ArrowLeft } from "lucide-react";
import { signalerException } from "@/lib/achillea/signaler";

export default function RankedLeaderboardPage({
  initialData,
  initialTiers,
}: {
  initialData?: LeaderboardPage | null;
  initialTiers?: RankedTierInfo[] | null;
}) {
  const [mode, setMode] = useState<2 | 4>(2);
  const [page, setPage] = useState<number>(0);
  const pageSize = 25;
  const [data, setData] = useState<LeaderboardPage | null>(initialData ?? null);
  const [tiers, setTiers] = useState<RankedTierInfo[] | null>(initialTiers ?? null);
  const [loading, setLoading] = useState<boolean>(initialData == null);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [tierKey, setTierKey] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [tiersError, setTiersError] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchQuery.trim());
      setPage(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const [requestIdentity1, setRequestIdentity1] = useState<readonly unknown[]>([mode]);
  if ([mode].some((value, position) => !Object.is(value, requestIdentity1[position]))) {
    setRequestIdentity1([mode]);
    (() => {
      setTiersError(false);
    })();
  }
  useEffect(() => {
    let cancelled = false;

    createAchilleaClient()
      .ranked.tiers(mode)
      .then(result => {
        if (!cancelled) {
          setTiers(result.ok ? result.value : null);
          setTiersError(!result.ok);
          if (!result.ok) setTierKey("");
        }
      })
      .catch(cause => {
        signalerException("ranked/tiers", cause);
        if (!cancelled) {
          setTiers(null);
          setTiersError(true);
          setTierKey("");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [mode]);

  const selectedTier = tiers?.find(tier => tier.key === tierKey);
  const [requestIdentity2, setRequestIdentity2] = useState<readonly unknown[]>([
    mode,
    page,
    search,
    tierKey,
    selectedTier,
    tiersError,
  ]);
  if (
    [mode, page, search, tierKey, selectedTier, tiersError].some(
      (value, position) => !Object.is(value, requestIdentity2[position]),
    )
  ) {
    setRequestIdentity2([mode, page, search, tierKey, selectedTier, tiersError]);
    (() => {
      if (tierKey && !selectedTier && !tiersError) return;
      setLoading(true);
      setError(null);
      setData(null);
    })();
  }
  useEffect(() => {
    if (tierKey && !selectedTier && !tiersError) return;
    let cancelled = false;

    const client = createAchilleaClient();
    client.ranked
      .leaderboard({
        mode,
        page,
        pageSize,
        search,
        minElo: selectedTier?.minElo,
        maxElo: selectedTier?.maxElo,
      })
      .then(board => {
        if (cancelled) return;
        if (!board.ok) {
          setError("Le classement est momentanément indisponible.");
          return;
        }
        setData(board.value);
      })
      .catch(cause => {
        signalerException("ranked/leaderboard", cause);
        if (!cancelled) setError("Le classement est momentanément indisponible.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [mode, page, search, tierKey, selectedTier, tiersError]);

  const entries = data?.entries ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / pageSize) || 1;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">
      {/* Breadcrumb / Top Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-6">
        <div className="space-y-1">
          <Link
            href="/achillea/ranked"
            className="inline-flex items-center gap-1.5 text-lg text-muted-foreground hover:text-foreground transition mb-1"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Retour au hub classé
          </Link>
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <Trophy className="w-5 h-5" />
            </span>
            <h1 className="text-3xl font-bold tracking-tight">Classement Général (Leaderboard)</h1>
          </div>
          <p className="text-lg text-muted-foreground">
            Les meilleurs joueurs classés de la saison active sur Inazuma Eleven: Victory Road.
          </p>
        </div>

        {/* Mode switch */}
        <fieldset
          aria-label="Mode du classement"
          className="m-0 min-w-0 border-0 flex items-center p-1 bg-muted rounded-lg self-start sm:self-auto"
        >
          <button
            type="button"
            aria-pressed={mode === 2}
            onClick={() => {
              setMode(2);
              setPage(0);
              setTierKey("");
              setTiers(null);
            }}
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
            onClick={() => {
              setMode(4);
              setPage(0);
              setTierKey("");
              setTiers(null);
            }}
            className={`min-h-11 px-4 py-1.5 text-lg font-semibold rounded-md transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
              mode === 4
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            2 contre 2 (Duo)
          </button>
        </fieldset>
      </div>

      {/* Search filter and counts */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            aria-label="Rechercher un joueur dans le classement"
            type="text"
            placeholder="Rechercher un joueur..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="min-h-11 w-full pl-9 pr-3 py-2 text-lg bg-card border border-border rounded-lg placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          />
        </div>
        <label className="flex w-full flex-col gap-1 text-lg sm:w-64">
          <span className="font-semibold">Palier</span>
          <select
            value={tierKey}
            onChange={event => {
              setTierKey(event.target.value);
              setPage(0);
            }}
            className="min-h-11 rounded-lg border border-border bg-card px-3 py-2 text-lg text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <option value="">Tous les paliers</option>
            {tiers?.map(tier => (
              <option key={tier.key} value={tier.key}>
                {tier.key} ({tier.playerCount})
              </option>
            ))}
          </select>
        </label>
        {tiersError && (
          <output className="text-lg text-amber-400">Paliers indisponibles. Le classement reste consultable.</output>
        )}

        <div className="text-lg text-muted-foreground self-end sm:self-auto">
          Total : <span className="font-semibold text-foreground">{total}</span> joueur
          {total > 1 ? "s" : ""} classé{total > 1 ? "s" : ""}
        </div>
      </div>

      {/* Leaderboard Table */}
      <div className="border border-border rounded-2xl bg-card overflow-hidden shadow-sm">
        {loading ? (
          <div className="py-20 text-center space-y-3">
            <Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" />
            <p className="text-lg text-muted-foreground">Chargement du classement...</p>
          </div>
        ) : error && !data ? (
          <div role="alert" className="py-16 text-center text-rose-400 text-lg">
            {error}
          </div>
        ) : entries.length === 0 ? (
          <output className="py-16 text-center text-muted-foreground text-lg space-y-2">
            <p>{search || tierKey ? "Aucun joueur ne correspond aux filtres." : "Aucun joueur classé pour ce mode."}</p>
            {(search || tierKey) && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                  setTierKey("");
                  setPage(0);
                }}
                className="min-h-11 rounded-lg border border-border px-4 text-lg font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                Effacer les filtres
              </button>
            )}
          </output>
        ) : (
          <>
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full text-left text-lg">
                <caption className="sr-only">
                  Classement des joueurs en {mode === 2 ? "solo" : "duo"}, {total} joueur
                  {total > 1 ? "s" : ""} classé{total > 1 ? "s" : ""}
                </caption>
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-muted-foreground uppercase text-lg tracking-wider">
                    <th scope="col" className="py-3 px-4 w-16 text-center">
                      Rang
                    </th>
                    <th scope="col" className="py-3 px-4">
                      Joueur
                    </th>
                    <th scope="col" className="py-3 px-4 text-center">
                      Palier
                    </th>
                    <th scope="col" className="py-3 px-4 text-right">
                      Points classés (AP)
                    </th>
                    <th scope="col" className="py-3 px-4 text-right">
                      Parties
                    </th>
                    <th scope="col" className="py-3 px-4 text-right">
                      Pic
                    </th>
                    <th scope="col" className="py-3 px-4">
                      Historique
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {entries.map(entry => {
                    const actualRank = entry.rank;
                    return (
                      <tr key={entry.userId} className="hover:bg-muted/30 transition-colors">
                        <td className="py-3 px-4 text-center font-bold">
                          {actualRank === 1 ? (
                            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-amber-400 text-black text-lg font-extrabold">
                              1
                            </span>
                          ) : actualRank === 2 ? (
                            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-slate-300 text-black text-lg font-extrabold">
                              2
                            </span>
                          ) : actualRank === 3 ? (
                            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-amber-700 text-white text-lg font-extrabold">
                              3
                            </span>
                          ) : (
                            <span className="text-muted-foreground font-mono">#{actualRank}</span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <Link
                            href={`/achillea/users/${entry.userId}`}
                            className="inline-flex items-center gap-2.5 font-semibold text-foreground hover:text-primary transition"
                          >
                            <UserAvatar avatar={entry.avatar} displayName={entry.displayName} className="w-7 h-7" />
                            <span>{entry.displayName}</span>
                          </Link>
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span className="px-2 py-0.5 rounded-md bg-background border border-border text-lg font-medium">
                            {tiers?.find(tier => entry.elo >= tier.minElo && entry.elo <= tier.maxElo)?.key ?? "—"}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right font-bold text-amber-400 font-mono text-lg">
                          {entry.elo} AP
                        </td>
                        <td className="py-3 px-4 text-right text-muted-foreground">{entry.gamesPlayed}</td>
                        <td className="py-3 px-4 text-right text-muted-foreground font-mono">{entry.peakRating}</td>
                        <td className="py-3 px-4">
                          <Link
                            href={`/achillea/ranked/history?player=${encodeURIComponent(entry.userId)}`}
                            className="text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                          >
                            Voir les matchs de {entry.displayName}
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="divide-y divide-border lg:hidden" aria-label="Classement des joueurs">
              {entries.map(entry => (
                <article key={entry.userId} className="space-y-3 p-4 text-lg">
                  <div className="flex items-center gap-3">
                    <span className="min-w-12 font-bold text-amber-400">#{entry.rank}</span>
                    <Link
                      href={`/achillea/users/${entry.userId}`}
                      className="inline-flex min-h-11 min-w-0 items-center gap-2 font-semibold hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    >
                      <UserAvatar avatar={entry.avatar} displayName={entry.displayName} className="h-8 w-8 shrink-0" />
                      <span className="truncate">{entry.displayName}</span>
                    </Link>
                  </div>
                  <dl className="grid grid-cols-2 gap-2 text-muted-foreground">
                    <div>
                      <dt>Points classés</dt>
                      <dd className="font-bold text-amber-400">{entry.elo} AP</dd>
                    </div>
                    <div>
                      <dt>Palier</dt>
                      <dd className="font-semibold text-foreground">
                        {tiers?.find(tier => entry.elo >= tier.minElo && entry.elo <= tier.maxElo)?.key ?? "—"}
                      </dd>
                    </div>
                    <div>
                      <dt>Parties</dt>
                      <dd className="text-foreground">{entry.gamesPlayed}</dd>
                    </div>
                    <div>
                      <dt>Pic</dt>
                      <dd className="text-foreground">{entry.peakRating}</dd>
                    </div>
                  </dl>
                  <Link
                    href={`/achillea/ranked/history?player=${encodeURIComponent(entry.userId)}`}
                    className="inline-flex min-h-11 items-center text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    Voir les matchs de {entry.displayName}
                  </Link>
                </article>
              ))}
            </div>
          </>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <nav
            aria-label="Pages du classement"
            className="flex flex-wrap items-center justify-between gap-3 p-4 border-t border-border bg-muted/20"
          >
            <button
              type="button"
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0 || loading}
              className="inline-flex min-h-11 items-center gap-1 px-3 py-1.5 text-lg font-semibold rounded-md border border-border bg-card hover:bg-muted disabled:opacity-40 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              Précédent
            </button>
            <span className="text-lg text-muted-foreground">
              Page <span className="font-semibold text-foreground">{page + 1}</span> sur{" "}
              <span className="font-semibold text-foreground">{totalPages}</span>
            </span>
            <button
              type="button"
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1 || loading}
              className="inline-flex min-h-11 items-center gap-1 px-3 py-1.5 text-lg font-semibold rounded-md border border-border bg-card hover:bg-muted disabled:opacity-40 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              Suivant
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </nav>
        )}
      </div>
    </div>
  );
}
