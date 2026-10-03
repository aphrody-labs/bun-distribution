"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import Link from "next/link";
import { useAchilleaAuth, createAchilleaClient } from "@/lib/achillea";
import { UserAvatar } from "@/components/achillea/UserAvatar";
import { Sparkline } from "@/components/achillea/Sparkline";
import { type RankedHistoryEntry, MatchMode } from "@rosegriffon/achillea-types";
import {
  History,
  ArrowLeft,
  Loader2,
  ShieldAlert,
  Calendar,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from "lucide-react";
import { signalerException } from "@/lib/achillea/signaler";

type ResultFilter = "all" | "win" | "loss" | "draw" | "forfeit";

export default function RankedHistoryPage({
  playerId,
  initialMode = -1,
  initialPeriod = 0,
  initialResult = "all",
}: {
  playerId?: string;
  initialMode?: -1 | 2 | 4;
  initialPeriod?: number;
  initialResult?: ResultFilter;
}) {
  const { isAuthenticated, isLoading: authLoading, status: authStatus, login } = useAchilleaAuth();
  const [mode, setMode] = useState<-1 | 2 | 4>(initialMode);
  const [period, setPeriod] = useState<number>(initialPeriod);
  const [resultFilter, setResultFilter] = useState<ResultFilter>(initialResult);
  const [history, setHistory] = useState<RankedHistoryEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextOffset, setNextOffset] = useState(0);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestGeneration = useRef(0);
  const [filterTime, setFilterTime] = useState(() => Date.now());
  const changeFilter = (key: "mode" | "period" | "result", value: string) => {
    setFilterTime(Date.now());
    const url = new URL(window.location.href);
    if (value === "all" || value === "0") url.searchParams.delete(key);
    else url.searchParams.set(key, value);
    window.history.pushState(null, "", url);
    if (key === "mode") setMode(value === "2" ? 2 : value === "4" ? 4 : -1);
    if (key === "period") setPeriod(Number(value));
    if (key === "result") setResultFilter(value as ResultFilter);
  };
  useEffect(() => {
    const restore = () => {
      setFilterTime(Date.now());
      const params = new URLSearchParams(window.location.search);
      setMode(params.get("mode") === "2" ? 2 : params.get("mode") === "4" ? 4 : -1);
      setPeriod(params.get("period") === "7" ? 7 : params.get("period") === "30" ? 30 : 0);
      const result = params.get("result");
      setResultFilter(
        result === "win" || result === "loss" || result === "draw" || result === "forfeit"
          ? result
          : "all",
      );
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);

  const [requestIdentity1, setRequestIdentity1] = useState<readonly unknown[]>([
    isAuthenticated,
    mode,
    playerId,
  ]);
  if (
    [isAuthenticated, mode, playerId].some(
      (value, position) => !Object.is(value, requestIdentity1[position]),
    )
  ) {
    setRequestIdentity1([isAuthenticated, mode, playerId]);
    (() => {
      if (!playerId && !isAuthenticated) {
        setLoading(false);
        setHasMore(false);
        return;
      }
      setLoading(true);
      setError(null);
      setHistory([]);
      setHasMore(false);
      setLoadingMore(false);
      setNextOffset(0);
      setLoadMoreError(null);
    })();
  }
  useEffect(() => {
    requestGeneration.current += 1;
    if (!playerId && !isAuthenticated) {
      return;
    }

    let cancelled = false;

    const client = createAchilleaClient();

    const modeQuery = mode === -1 ? undefined : mode;

    const request = playerId
      ? client.users.rankedHistory(playerId, { mode: modeQuery, limit: 100 })
      : client.users.myRankedHistory({ mode: modeQuery, limit: 100 });
    request
      .then((res) => {
        if (cancelled) return;
        if (res.ok && res.value) {
          setHistory(res.value);
          setHasMore(res.value.length === 100);
          setNextOffset(res.value.length);
        } else {
          setError("Impossible de charger votre historique de matchs.");
        }
      })
      .catch((cause) => {
        signalerException("ranked/history", cause);
        if (!cancelled) setError("Impossible de charger votre historique de matchs.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, mode, playerId]);

  const loadMore = async () => {
    if (loading || loadingMore || !hasMore) return;
    const generation = requestGeneration.current;
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const query = { mode: mode === -1 ? undefined : mode, limit: 100, offset: nextOffset };
      const client = createAchilleaClient();
      const response = playerId
        ? await client.users.rankedHistory(playerId, query)
        : await client.users.myRankedHistory(query);
      if (generation !== requestGeneration.current) return;
      if (!response.ok) {
        setLoadMoreError("Impossible de charger la suite des matchs.");
        return;
      }
      setHistory((previous) => {
        const seen = new Set(previous.map((match) => match.lobbyId));
        return [...previous, ...response.value.filter((match) => !seen.has(match.lobbyId))];
      });
      setHasMore(response.value.length === 100);
      setNextOffset((previous) => previous + response.value.length);
    } catch (cause) {
      signalerException("ranked/history/load-more", cause);
      if (generation === requestGeneration.current)
        setLoadMoreError("Impossible de charger la suite des matchs.");
    } finally {
      if (generation === requestGeneration.current) setLoadingMore(false);
    }
  };

  // Filter by period
  const filteredHistory = useMemo(() => {
    const cutoff = period === 0 ? 0 : filterTime - period * 24 * 3600 * 1000;
    return history.filter((m) => {
      if (resultFilter !== "all" && m.result !== resultFilter) return false;
      if (period === 0) return true;
      const t = new Date(m.endedAt).getTime();
      return Number.isFinite(t) && t >= cutoff;
    });
  }, [history, period, resultFilter, filterTime]);

  // Calculate stats
  const stats = useMemo(() => {
    const wins = filteredHistory.filter((m) => m.result === "win").length;
    const losses = filteredHistory.filter((m) => m.result === "loss").length;
    const draws = filteredHistory.filter((m) => m.result === "draw").length;
    const forfeits = filteredHistory.filter((m) => m.result === "forfeit").length;
    const total = filteredHistory.length;
    const totalDelta = filteredHistory.reduce((acc, m) => acc + (m.eloDelta ?? 0), 0);
    const winrate = total > 0 ? Math.round((wins / total) * 100) : 0;
    return { wins, losses, draws, forfeits, total, totalDelta, winrate };
  }, [filteredHistory]);

  // Sparkline data (in chronological order, so reversed from history DESC)
  const sparklineData = useMemo(() => {
    return [...filteredHistory].reverse().map((m) => m.eloDelta ?? 0);
  }, [filteredHistory]);

  const formatDate = (isoString: string) => {
    try {
      const d = new Date(isoString);
      return new Intl.DateTimeFormat("fr-FR", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(d);
    } catch {
      return isoString;
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-6">
        <div className="space-y-1">
          <Link
            href="/achillea/ranked"
            className="inline-flex items-center gap-1.5 text-lg text-muted-foreground hover:text-foreground transition mb-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Retour au hub classé
          </Link>
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <History className="w-5 h-5" />
            </span>
            <h1 className="text-3xl font-bold tracking-tight">
              {playerId ? "Historique public des matchs" : "Historique de mes matchs"}
            </h1>
          </div>
          <p className="text-lg text-muted-foreground">
            {playerId
              ? "Consultez les résultats classés publics de ce joueur."
              : "Consultez le bilan de vos rencontres classées, vos scores et vos variations d'AP."}
          </p>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 flex-wrap self-start sm:self-auto">
          <fieldset
            aria-label="Mode des matchs"
            className="m-0 min-w-0 border-0 flex items-center p-1 bg-muted rounded-lg"
          >
            <button
              type="button"
              aria-pressed={mode === -1}
              onClick={() => changeFilter("mode", "all")}
              className={`min-h-11 px-3 py-1 text-lg font-semibold rounded-md transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                mode === -1
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Tous
            </button>
            <button
              type="button"
              aria-pressed={mode === 2}
              onClick={() => changeFilter("mode", "2")}
              className={`min-h-11 px-3 py-1 text-lg font-semibold rounded-md transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                mode === 2
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              1v1
            </button>
            <button
              type="button"
              aria-pressed={mode === 4}
              onClick={() => changeFilter("mode", "4")}
              className={`min-h-11 px-3 py-1 text-lg font-semibold rounded-md transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                mode === 4
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              2v2
            </button>
          </fieldset>

          <fieldset
            aria-label="Période des matchs"
            className="m-0 min-w-0 border-0 flex items-center p-1 bg-muted rounded-lg"
          >
            <button
              type="button"
              aria-pressed={period === 7}
              onClick={() => changeFilter("period", "7")}
              className={`min-h-11 px-3 py-1 text-lg font-semibold rounded-md transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                period === 7
                  ? "bg-secondary text-secondary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              7 jours
            </button>
            <button
              type="button"
              aria-pressed={period === 30}
              onClick={() => changeFilter("period", "30")}
              className={`min-h-11 px-3 py-1 text-lg font-semibold rounded-md transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                period === 30
                  ? "bg-secondary text-secondary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              30 jours
            </button>
            <button
              type="button"
              aria-pressed={period === 0}
              onClick={() => changeFilter("period", "0")}
              className={`min-h-11 px-3 py-1 text-lg font-semibold rounded-md transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                period === 0
                  ? "bg-secondary text-secondary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Tout
            </button>
          </fieldset>
          <label className="flex flex-col gap-1 text-lg font-semibold">
            Résultat
            <select
              value={resultFilter}
              onChange={(event) => changeFilter("result", event.target.value)}
              className="min-h-11 rounded-lg border border-border bg-card px-3 py-2 text-lg text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <option value="all">Tous les résultats</option>
              <option value="win">Victoires</option>
              <option value="loss">Défaites</option>
              <option value="draw">Nuls</option>
              <option value="forfeit">Forfaits</option>
            </select>
          </label>
        </div>
      </div>

      {/*
       * `isLoading` avant `!isAuthenticated` : pendant l'aller-retour
       * `GET /auth/me`, `isAuthenticated` vaut false et le mur s'affichait à
       * un joueur pourtant connecté.
       */}
      {authLoading && !playerId ? (
        <div className="py-20 text-center text-lg text-muted-foreground">
          Vérification de la session…
        </div>
      ) : authStatus === "error" && !playerId ? (
        <div
          role="alert"
          className="p-8 border border-destructive bg-card rounded-2xl text-center space-y-4"
        >
          <h2 className="text-xl font-bold">Session momentanément indisponible</h2>
          <p className="text-lg text-muted-foreground">
            Le service de connexion ne répond pas. Réessayez pour consulter votre historique
            personnel.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-6 py-2.5 bg-primary text-primary-foreground text-lg font-semibold rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            Réessayer
          </button>
        </div>
      ) : !isAuthenticated && !playerId ? (
        <div className="p-8 border border-border bg-card rounded-2xl text-center space-y-4">
          <ShieldAlert className="w-12 h-12 text-amber-400 mx-auto opacity-80" />
          <h2 className="text-xl font-bold">Consulter les matchs classés</h2>
          <p className="text-lg text-muted-foreground max-w-md mx-auto">
            Choisissez un joueur dans le classement pour consulter son historique public.
            Connectez-vous pour retrouver votre historique personnel.
          </p>
          <Link
            href="/achillea/ranked/leaderboard"
            className="inline-flex items-center px-6 py-2.5 border border-border rounded-lg text-lg font-semibold hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            Voir le classement et les historiques publics
          </Link>
          <button
            type="button"
            onClick={() => login()}
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-primary text-primary-foreground text-lg font-semibold rounded-lg hover:bg-primary/90 transition shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            Se connecter
          </button>
        </div>
      ) : loading ? (
        <div className="py-20 text-center space-y-3">
          <Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" />
          <p className="text-lg text-muted-foreground">Chargement de votre historique...</p>
        </div>
      ) : error ? (
        <div
          role="alert"
          className="border border-rose-500/30 rounded-2xl p-8 text-center text-lg text-rose-400"
        >
          {error}
        </div>
      ) : (
        <>
          {/* Performance summary card */}
          <div className="border border-border bg-card rounded-2xl p-6 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-border/60 pb-4">
              <div className="space-y-1">
                <h3 className="font-bold text-lg">Bilan des matchs filtrés</h3>
                <div className="text-lg text-muted-foreground">
                  {stats.total} match{stats.total > 1 ? "s" : ""} enregistré
                  {stats.total > 1 ? "s" : ""}
                </div>
                {hasMore && (
                  <p className="text-lg text-muted-foreground">
                    Bilan provisoire : d’autres matchs sont disponibles. Les filtres portent sur les
                    matchs chargés.
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2">
                <span className="text-lg text-muted-foreground">Bilan AP :</span>
                <span
                  className={`px-2.5 py-0.5 rounded-full font-mono font-bold text-lg ${
                    stats.totalDelta > 0
                      ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                      : stats.totalDelta < 0
                        ? "bg-rose-500/10 text-rose-400 border border-rose-500/30"
                        : "bg-muted text-muted-foreground"
                  }`}
                >
                  {stats.totalDelta > 0 ? `+${stats.totalDelta}` : stats.totalDelta} AP
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-lg">
              <div className="p-3 rounded-xl bg-background/60 border border-border">
                <div className="text-muted-foreground">Victoires</div>
                <div className="text-lg font-bold text-emerald-400">{stats.wins}</div>
              </div>
              <div className="p-3 rounded-xl bg-background/60 border border-border">
                <div className="text-muted-foreground">Défaites</div>
                <div className="text-lg font-bold text-rose-400">{stats.losses}</div>
              </div>
              <div className="p-3 rounded-xl bg-background/60 border border-border">
                <div className="text-muted-foreground">Nuls</div>
                <div className="text-lg font-bold text-sky-400">{stats.draws}</div>
              </div>
              <div className="p-3 rounded-xl bg-background/60 border border-border">
                <div className="text-muted-foreground">Forfaits</div>
                <div className="text-lg font-bold text-amber-400">{stats.forfeits}</div>
              </div>
              <div className="p-3 rounded-xl bg-background/60 border border-border">
                <div className="text-muted-foreground">Winrate</div>
                <div className="text-lg font-bold">{stats.winrate}%</div>
              </div>
            </div>

            {sparklineData.length > 1 && (
              <div className="pt-2 flex items-center justify-between border-t border-border/50 text-lg text-muted-foreground">
                <span>Évolution des deltas récents</span>
                <Sparkline data={sparklineData} width={180} height={32} />
              </div>
            )}
          </div>

          {/* History list */}
          {filteredHistory.length === 0 ? (
            <div className="border border-dashed border-border rounded-2xl p-12 text-center text-muted-foreground text-lg space-y-2">
              <Calendar className="w-8 h-8 mx-auto opacity-50 mb-2" />
              <p className="font-semibold">Aucun match chargé ne correspond aux filtres.</p>
              <p className="text-lg">
                {hasMore
                  ? "Chargez les matchs suivants pour poursuivre la recherche."
                  : "Essayez un autre mode, une autre période ou un autre résultat."}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredHistory.map((match) => {
                const isWin = match.result === "win";
                const isDraw = match.result === "draw";
                const isForfeit = match.result === "forfeit";
                const delta = match.eloDelta ?? 0;

                return (
                  <div
                    key={match.lobbyId}
                    className="border border-border bg-card rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition hover:bg-muted/20"
                  >
                    {/* Status badge & Date */}
                    <div className="flex items-center gap-3">
                      {isWin ? (
                        <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
                          <CheckCircle2 className="w-5 h-5" />
                        </div>
                      ) : isDraw ? (
                        <div className="w-10 h-10 rounded-xl bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-sky-400 shrink-0">
                          <History className="w-5 h-5" />
                        </div>
                      ) : isForfeit ? (
                        <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
                          <AlertTriangle className="w-5 h-5" />
                        </div>
                      ) : (
                        <div className="w-10 h-10 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-400 shrink-0">
                          <XCircle className="w-5 h-5" />
                        </div>
                      )}

                      <div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-lg font-bold uppercase ${
                              isWin
                                ? "text-emerald-400"
                                : isDraw
                                  ? "text-sky-400"
                                  : isForfeit
                                    ? "text-amber-400"
                                    : "text-rose-400"
                            }`}
                          >
                            {isWin
                              ? "Victoire"
                              : isDraw
                                ? "Match nul"
                                : isForfeit
                                  ? "Forfait"
                                  : "Défaite"}
                          </span>
                          <span className="px-1.5 py-0.5 rounded text-lg bg-muted text-muted-foreground font-mono">
                            {match.mode === MatchMode.ONE_VS_ONE ? "1v1" : "2v2"}
                          </span>
                        </div>
                        <div className="text-lg text-muted-foreground mt-0.5">
                          {formatDate(match.endedAt)}
                        </div>
                      </div>
                    </div>

                    {/* Opponent & Score */}
                    <div className="flex items-center justify-between sm:justify-end gap-6 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-lg text-muted-foreground hidden sm:inline">vs</span>
                        <Link
                          href={`/achillea/users/${match.opponent.userId}`}
                          className="inline-flex min-h-11 items-center gap-2 text-lg font-semibold hover:text-primary transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                        >
                          <UserAvatar
                            avatar={match.opponent.avatar}
                            displayName={match.opponent.displayName}
                            className="w-6 h-6"
                          />
                          <span className="truncate max-w-[120px]">
                            {match.opponent.displayName}
                          </span>
                        </Link>
                      </div>

                      {/* Score */}
                      <div className="font-mono font-bold text-lg bg-background border border-border px-3 py-1 rounded-lg">
                        {match.myScore} - {match.opponentScore}
                      </div>

                      {/* Delta AP */}
                      <div
                        className={`w-20 text-right font-mono font-bold text-lg ${
                          delta > 0
                            ? "text-emerald-400"
                            : delta < 0
                              ? "text-rose-400"
                              : "text-muted-foreground"
                        }`}
                      >
                        {delta > 0 ? `+${delta}` : delta} AP
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {hasMore && (
            <div className="flex flex-col items-center gap-2">
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className="min-h-11 rounded-lg border border-border bg-card px-5 py-2 text-lg font-semibold hover:bg-muted disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                {loadingMore ? "Chargement…" : "Charger 100 matchs supplémentaires"}
              </button>
              {loadMoreError && (
                <p role="alert" className="text-lg text-rose-400">
                  {loadMoreError}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
