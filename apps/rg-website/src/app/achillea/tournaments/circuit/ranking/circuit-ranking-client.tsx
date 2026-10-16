"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createAchilleaClient } from "@/lib/achillea";
import { UserAvatar } from "@/components/achillea/UserAvatar";
import type { CircuitRanking } from "@rosegriffon/achillea-types";
import { Trophy, ArrowLeft, Crown, Shield, Users, Loader2, ChevronRight } from "lucide-react";
import { signalerException } from "@/lib/achillea/signaler";

export default function CircuitRankingPage() {
  const [data, setData] = useState<CircuitRanking | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"players" | "clans" | "tournaments">("players");
  const [playerQuery, setPlayerQuery] = useState("");
  const [minimumTournaments, setMinimumTournaments] = useState(0);
  const [clanQuery, setClanQuery] = useState("");
  const [standingsFilter, setStandingsFilter] = useState<"all" | "resolved" | "unresolved">("all");

  useEffect(() => {
    let cancelled = false;

    const client = createAchilleaClient();

    client.tournaments
      .circuitRanking()
      .then((res) => {
        if (cancelled) return;
        if (res.ok && res.value) {
          setData(res.value);
        } else {
          setError("Le classement du circuit est indisponible pour le moment.");
        }
      })
      .catch((cause) => {
        signalerException("tournaments/circuit/ranking", cause);
        if (!cancelled) setError("Le classement du circuit est indisponible pour le moment.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const leaderboard = data?.leaderboard ?? [];
  const clanRanking = data?.clanRanking ?? [];
  const tournaments = data?.tournaments ?? [];

  const top3 = leaderboard.slice(0, 3);
  const visiblePlayers = leaderboard.filter((player) => {
    const query = playerQuery.trim().toLocaleLowerCase("fr-FR");
    return (
      player.tournamentsPlayed >= minimumTournaments &&
      (!query ||
        `${player.displayName} ${player.username} ${player.clan?.name ?? ""} ${player.clan?.shortName ?? ""}`
          .toLocaleLowerCase("fr-FR")
          .includes(query))
    );
  });
  const visibleClans = clanRanking.filter((clan) =>
    `${clan.name} ${clan.shortName}`
      .toLocaleLowerCase("fr-FR")
      .includes(clanQuery.trim().toLocaleLowerCase("fr-FR")),
  );
  const visibleTournaments = tournaments.filter(
    (tournament) => standingsFilter === "all" || tournament.standingsStatus === standingsFilter,
  );

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">
      {/* Breadcrumb */}
      <div className="space-y-1 border-b border-border pb-6">
        <Link
          href="/achillea/tournaments"
          className="inline-flex items-center gap-1.5 text-lg text-muted-foreground hover:text-foreground transition mb-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Retour aux tournois
        </Link>
        <div className="flex items-center gap-2">
          <span className="p-2 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <Trophy className="w-5 h-5" />
          </span>
          <h1 className="text-3xl font-bold tracking-tight">
            Circuit Achilléa — Classement Officiel
          </h1>
        </div>
        <p className="text-lg text-muted-foreground">
          Barème de points cumulés sur l'ensemble des tournois homologués de la saison compétitive.
        </p>
      </div>

      {/* Top 3 Podium */}
      {top3.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 pb-2 items-end">
          {/* #2 */}
          {top3[1] && (
            <div className="order-2 sm:order-1 border border-slate-700/60 bg-gradient-to-b from-slate-800/40 to-card rounded-2xl p-5 text-center space-y-3 relative shadow-md">
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full text-lg font-bold bg-slate-300 text-black shadow">
                #2 Argent
              </span>
              <div className="pt-2">
                <UserAvatar
                  avatar={top3[1].avatar}
                  displayName={top3[1].displayName}
                  className="w-16 h-16 mx-auto ring-2 ring-slate-300"
                />
              </div>
              <div>
                <Link
                  href={`/achillea/users/${top3[1].userId}`}
                  className="inline-flex min-h-11 items-center font-bold text-lg hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  {top3[1].displayName}
                </Link>
                {top3[1].clan && (
                  <span className="text-lg text-muted-foreground">[{top3[1].clan.shortName}]</span>
                )}
                <div className="text-xl font-extrabold text-slate-300 mt-1">
                  {top3[1].points} pts
                </div>
                <div className="text-lg text-muted-foreground mt-0.5">
                  {top3[1].wins} titre{top3[1].wins > 1 ? "s" : ""} · {top3[1].tournamentsPlayed}{" "}
                  tournoi{top3[1].tournamentsPlayed > 1 ? "s" : ""}
                </div>
              </div>
            </div>
          )}

          {/* #1 Champion */}
          {top3[0] && (
            <div className="order-1 sm:order-2 border-2 border-amber-500/80 bg-gradient-to-b from-amber-500/10 via-card to-card rounded-2xl p-6 text-center space-y-3 relative shadow-xl sm:-translate-y-2">
              <div className="absolute -top-4 left-1/2 -translate-x-1/2 flex items-center gap-1 px-3.5 py-1 rounded-full text-lg font-bold bg-amber-400 text-black shadow-lg">
                <Crown className="w-3.5 h-3.5 fill-black" />
                #1 Leader Circuit
              </div>
              <div className="pt-2">
                <UserAvatar
                  avatar={top3[0].avatar}
                  displayName={top3[0].displayName}
                  className="w-20 h-20 mx-auto ring-4 ring-amber-400 shadow-amber-500/20"
                />
              </div>
              <div>
                <Link
                  href={`/achillea/users/${top3[0].userId}`}
                  className="inline-flex min-h-11 items-center font-bold text-lg hover:text-amber-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  {top3[0].displayName}
                </Link>
                {top3[0].clan && (
                  <span className="text-lg text-muted-foreground">[{top3[0].clan.shortName}]</span>
                )}
                <div className="text-2xl font-black text-amber-400 mt-1">{top3[0].points} pts</div>
                <div className="text-lg text-muted-foreground mt-0.5">
                  {top3[0].wins} titre{top3[0].wins > 1 ? "s" : ""} · {top3[0].tournamentsPlayed}{" "}
                  tournoi{top3[0].tournamentsPlayed > 1 ? "s" : ""}
                </div>
              </div>
            </div>
          )}

          {/* #3 */}
          {top3[2] && (
            <div className="order-3 border border-amber-800/60 bg-gradient-to-b from-amber-950/20 to-card rounded-2xl p-5 text-center space-y-3 relative shadow-md">
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full text-lg font-bold bg-amber-700 text-amber-100 shadow">
                #3 Bronze
              </span>
              <div className="pt-2">
                <UserAvatar
                  avatar={top3[2].avatar}
                  displayName={top3[2].displayName}
                  className="w-16 h-16 mx-auto ring-2 ring-amber-700"
                />
              </div>
              <div>
                <Link
                  href={`/achillea/users/${top3[2].userId}`}
                  className="inline-flex min-h-11 items-center font-bold text-lg hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  {top3[2].displayName}
                </Link>
                {top3[2].clan && (
                  <span className="text-lg text-muted-foreground">[{top3[2].clan.shortName}]</span>
                )}
                <div className="text-xl font-extrabold text-amber-600 mt-1">
                  {top3[2].points} pts
                </div>
                <div className="text-lg text-muted-foreground mt-0.5">
                  {top3[2].wins} titre{top3[2].wins > 1 ? "s" : ""} · {top3[2].tournamentsPlayed}{" "}
                  tournoi{top3[2].tournamentsPlayed > 1 ? "s" : ""}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tabs */}
      <fieldset
        aria-label="Vues du circuit"
        className="m-0 min-w-0 border-0 p-0 flex flex-wrap items-center gap-2 border-b border-border pb-px"
      >
        <button
          type="button"
          aria-pressed={activeTab === "players"}
          onClick={() => setActiveTab("players")}
          className={`px-4 py-2 text-lg font-semibold border-b-2 transition -mb-px flex items-center gap-1.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
            activeTab === "players"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          Classement Joueurs ({leaderboard.length})
        </button>
        <button
          type="button"
          aria-pressed={activeTab === "clans"}
          onClick={() => setActiveTab("clans")}
          className={`px-4 py-2 text-lg font-semibold border-b-2 transition -mb-px flex items-center gap-1.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
            activeTab === "clans"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Shield className="w-3.5 h-3.5" />
          Classement Clans ({clanRanking.length})
        </button>
        <button
          type="button"
          aria-pressed={activeTab === "tournaments"}
          onClick={() => setActiveTab("tournaments")}
          className={`px-4 py-2 text-lg font-semibold border-b-2 transition -mb-px flex items-center gap-1.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
            activeTab === "tournaments"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Trophy className="w-3.5 h-3.5" />
          Tournois du circuit ({tournaments.length})
        </button>
      </fieldset>

      {loading ? (
        <div className="py-20 text-center space-y-3">
          <Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" />
          <p className="text-lg text-muted-foreground">Chargement du classement du circuit...</p>
        </div>
      ) : error ? (
        <p role="alert" className="rounded-xl border border-destructive p-5 text-lg">
          {error}
        </p>
      ) : (
        <>
          {/* Players Tab */}
          {activeTab === "players" &&
            (leaderboard.length === 0 ? (
              <p className="rounded-xl border border-border p-5 text-lg">
                Aucun résultat de bracket homologué pour le moment.
              </p>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-4 rounded-xl border border-border bg-card p-4 text-lg">
                  <label className="flex flex-col gap-1">
                    Rechercher un joueur ou un clan
                    <input
                      type="search"
                      aria-label="Rechercher un joueur ou un clan"
                      value={playerQuery}
                      onChange={(event) => setPlayerQuery(event.target.value)}
                      className="min-h-11 rounded-md border border-border bg-background px-3 py-2 text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    Tournois minimum
                    <select
                      value={minimumTournaments}
                      onChange={(event) => setMinimumTournaments(Number(event.target.value))}
                      className="min-h-11 rounded-md border border-border bg-background px-3 py-2 text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    >
                      <option value={0}>Tous</option>
                      <option value={2}>2 ou plus</option>
                      <option value={3}>3 ou plus</option>
                      <option value={5}>5 ou plus</option>
                    </select>
                  </label>
                  <p aria-live="polite" className="self-end text-muted-foreground">
                    {visiblePlayers.length} joueur{visiblePlayers.length > 1 ? "s" : ""} sur{" "}
                    {leaderboard.length}
                  </p>
                </div>
                {visiblePlayers.length === 0 ? (
                  <p className="rounded-xl border border-border p-5 text-lg">
                    Aucun joueur ne correspond aux filtres.
                  </p>
                ) : (
                  <>
                    <div className="grid gap-3 lg:hidden" aria-label="Classement des joueurs">
                      {visiblePlayers.map((player) => (
                        <article
                          key={player.userId}
                          className="rounded-2xl border border-border bg-card p-4 text-lg space-y-3"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="font-bold text-amber-400">
                              #{leaderboard.indexOf(player) + 1}
                            </span>
                            <strong className="text-amber-400">{player.points} pts</strong>
                          </div>
                          <Link
                            href={`/achillea/users/${player.userId}`}
                            className="flex min-h-11 items-center gap-3 font-semibold text-foreground hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                          >
                            <UserAvatar
                              avatar={player.avatar}
                              displayName={player.displayName}
                              className="h-10 w-10"
                            />
                            {player.displayName}
                          </Link>
                          <dl className="grid grid-cols-2 gap-2 text-muted-foreground">
                            <div>
                              <dt>Clan</dt>
                              <dd className="text-foreground">{player.clan?.shortName ?? "—"}</dd>
                            </div>
                            <div>
                              <dt>Tournois</dt>
                              <dd className="text-foreground">{player.tournamentsPlayed}</dd>
                            </div>
                            <div>
                              <dt>Titres</dt>
                              <dd className="text-foreground">{player.wins}</dd>
                            </div>
                            <div>
                              <dt>Podiums</dt>
                              <dd className="text-foreground">{player.podiums}</dd>
                            </div>
                            <div>
                              <dt>Meilleur rang</dt>
                              <dd className="text-foreground">
                                {player.bestRankLabel || `#${player.bestRank}`}
                              </dd>
                            </div>
                            <div>
                              <dt>Palier</dt>
                              <dd className="text-foreground capitalize">{player.tier}</dd>
                            </div>
                          </dl>
                        </article>
                      ))}
                    </div>
                    <div className="hidden lg:block border border-border rounded-2xl bg-card overflow-x-auto">
                      <table className="w-full min-w-[1000px] text-left text-lg">
                        <thead>
                          <tr className="border-b border-border bg-muted/40 text-muted-foreground uppercase text-lg tracking-wider">
                            <th className="py-3 px-4 w-16 text-center">Rang</th>
                            <th className="py-3 px-4">Joueur</th>
                            <th className="py-3 px-4 text-center">Clan</th>
                            <th className="py-3 px-4 text-right">Points Circuit</th>
                            <th className="py-3 px-4 text-right">Titres</th>
                            <th className="py-3 px-4 text-right">Podiums</th>
                            <th className="py-3 px-4 text-right">Meilleur rang</th>
                            <th className="py-3 px-4 text-right">Palier</th>
                            <th className="py-3 px-4 text-right">Tournois</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/60">
                          {visiblePlayers.map((player) => (
                            <tr key={player.userId} className="hover:bg-muted/30 transition">
                              <td className="py-3 px-4 text-center font-bold text-muted-foreground font-mono">
                                #{leaderboard.indexOf(player) + 1}
                              </td>
                              <td className="py-3 px-4">
                                <Link
                                  href={`/achillea/users/${player.userId}`}
                                  className="inline-flex items-center gap-2.5 font-semibold text-foreground hover:text-primary transition"
                                >
                                  <UserAvatar
                                    avatar={player.avatar}
                                    displayName={player.displayName}
                                    className="w-7 h-7"
                                  />
                                  <span>{player.displayName}</span>
                                </Link>
                              </td>
                              <td className="py-3 px-4 text-center">
                                {player.clan ? (
                                  <span className="px-2 py-0.5 rounded bg-muted text-lg font-mono">
                                    [{player.clan.shortName}]
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground">-</span>
                                )}
                              </td>
                              <td className="py-3 px-4 text-right font-bold text-amber-400 font-mono text-lg">
                                {player.points} pts
                              </td>
                              <td className="py-3 px-4 text-right font-semibold text-emerald-400">
                                {player.wins > 0 ? `🏆 ${player.wins}` : "0"}
                              </td>
                              <td className="py-3 px-4 text-right font-mono">{player.podiums}</td>
                              <td className="py-3 px-4 text-right">
                                {player.bestRankLabel || `#${player.bestRank}`}
                              </td>
                              <td className="py-3 px-4 text-right capitalize">{player.tier}</td>
                              <td className="py-3 px-4 text-right text-muted-foreground font-mono">
                                {player.tournamentsPlayed}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            ))}

          {/* Clans Tab */}
          {activeTab === "clans" &&
            (clanRanking.length === 0 ? (
              <p className="rounded-xl border border-border p-5 text-lg">
                Aucun classement de clan calculé pour le moment.
              </p>
            ) : (
              <div className="space-y-4">
                <label className="flex max-w-md flex-col gap-1 text-lg">
                  Rechercher un clan
                  <input
                    type="search"
                    aria-label="Rechercher un clan"
                    value={clanQuery}
                    onChange={(event) => setClanQuery(event.target.value)}
                    className="min-h-11 rounded-md border border-border bg-background px-3 text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  />
                </label>
                <p aria-live="polite" className="text-lg text-muted-foreground">
                  {visibleClans.length} clan{visibleClans.length > 1 ? "s" : ""} sur{" "}
                  {clanRanking.length}
                </p>
                {visibleClans.length === 0 && (
                  <p className="rounded-xl border border-border p-5 text-lg">
                    Aucun clan ne correspond à la recherche.
                  </p>
                )}
                <div className="grid gap-3 md:hidden">
                  {visibleClans.map((clan) => (
                    <article
                      key={clan.id}
                      className="rounded-2xl border border-border bg-card p-4 text-lg"
                    >
                      <div className="flex justify-between gap-3">
                        <strong>#{clanRanking.indexOf(clan) + 1}</strong>
                        <strong className="text-amber-400">{clan.points} pts</strong>
                      </div>
                      <Link
                        href={`/achillea/clans/${clan.id}`}
                        className="flex min-h-11 items-center font-bold hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                      >
                        {clan.name} [{clan.shortName}]
                      </Link>
                      <p>
                        {clan.wins} titre{clan.wins > 1 ? "s" : ""} · {clan.players} joueur
                        {clan.players > 1 ? "s" : ""} actif{clan.players > 1 ? "s" : ""}
                      </p>
                    </article>
                  ))}
                </div>
                <div className="hidden md:block border border-border rounded-2xl bg-card overflow-x-auto">
                  <table className="w-full min-w-[720px] text-left text-lg">
                    <thead>
                      <tr className="border-b border-border bg-muted/40 text-muted-foreground uppercase text-lg tracking-wider">
                        <th className="py-3 px-4 w-16 text-center">Rang</th>
                        <th className="py-3 px-4">Clan</th>
                        <th className="py-3 px-4 text-right">Points Cumulés</th>
                        <th className="py-3 px-4 text-right">Titres</th>
                        <th className="py-3 px-4 text-right">Joueurs Actifs</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {visibleClans.map((clan) => (
                        <tr key={clan.id} className="hover:bg-muted/30 transition">
                          <td className="py-3 px-4 text-center font-bold text-muted-foreground font-mono">
                            #{clanRanking.indexOf(clan) + 1}
                          </td>
                          <td className="py-3 px-4">
                            <Link
                              href={`/achillea/clans/${clan.id}`}
                              className="font-bold text-foreground hover:text-primary transition"
                            >
                              {clan.name} [{clan.shortName}]
                            </Link>
                          </td>
                          <td className="py-3 px-4 text-right font-bold text-amber-400 font-mono text-lg">
                            {clan.points} pts
                          </td>
                          <td className="py-3 px-4 text-right font-semibold text-emerald-400">
                            {clan.wins > 0 ? `🏆 ${clan.wins}` : "0"}
                          </td>
                          <td className="py-3 px-4 text-right text-muted-foreground font-mono">
                            {clan.players}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}

          {/* Tournaments Palmarès */}
          {activeTab === "tournaments" &&
            (tournaments.length === 0 ? (
              <p className="rounded-xl border border-border p-5 text-lg">
                Aucun tournoi du circuit disponible pour le moment.
              </p>
            ) : (
              <div className="space-y-4">
                <label className="flex max-w-md flex-col gap-1 text-lg">
                  État du classement
                  <select
                    value={standingsFilter}
                    onChange={(event) =>
                      setStandingsFilter(event.target.value as typeof standingsFilter)
                    }
                    className="min-h-11 rounded-md border border-border bg-background px-3 text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    <option value="all">Tous les tournois</option>
                    <option value="resolved">Classement résolu</option>
                    <option value="unresolved">Classement non résolu</option>
                  </select>
                </label>
                <p aria-live="polite" className="text-lg text-muted-foreground">
                  {visibleTournaments.length} tournoi{visibleTournaments.length > 1 ? "s" : ""} sur{" "}
                  {tournaments.length}
                </p>
                {visibleTournaments.length === 0 && (
                  <p className="rounded-xl border border-border p-5 text-lg">
                    Aucun tournoi ne correspond au filtre.
                  </p>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {visibleTournaments.map((t) => (
                    <div
                      key={t.id}
                      className="border border-border bg-card rounded-2xl p-5 space-y-3 transition hover:shadow-md"
                    >
                      <div className="flex items-center justify-between">
                        <h4 className="font-bold text-lg">{t.name}</h4>
                        <span className="text-lg text-muted-foreground">
                          {new Date(t.grandFinalAt).toLocaleDateString("fr-FR")}
                        </span>
                      </div>

                      {/* Podium preview */}
                      <div className="space-y-1.5 pt-2 border-t border-border/60 text-lg">
                        {t.standingsStatus === "unresolved" && (
                          <p className="text-lg text-muted-foreground">
                            Classement historique non résolu : aucun podium ni point attribué.
                          </p>
                        )}
                        {t.podium.map((p) => (
                          <div
                            key={p.userId}
                            className="flex items-center justify-between text-muted-foreground"
                          >
                            <span className="font-medium text-foreground">
                              {p.rankLabel ||
                                (p.rank === 1 ? "🥇 1er" : p.rank === 2 ? "🥈 2e" : "🥉 3e")}{" "}
                              : {p.displayName}
                            </span>
                          </div>
                        ))}
                      </div>

                      <Link
                        href={`/achillea/tournaments/${t.id}`}
                        className="inline-flex min-h-11 items-center gap-1 text-lg text-primary font-semibold hover:underline pt-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                      >
                        Voir le tournoi
                        <ChevronRight className="w-3.5 h-3.5" />
                      </Link>
                    </div>
                  ))}
                </div>
              </div>
            ))}
        </>
      )}
    </div>
  );
}
