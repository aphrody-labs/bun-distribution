"use client";

import { Button, Card, DiscordIcon } from "@rosegriffon/ui";
import { ArrowRight, Award, Calendar, Gamepad2, Sparkles, Swords, Trophy, Users } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { UserAvatar } from "@/components/achillea/UserAvatar";

import type { AchilleaPreviewData, PreviewClan, PreviewTournament } from "@/app/api/public/achillea/preview/route";
import type { ChiffresEsport, LigneClassement } from "@/lib/achillea/classement";

export interface AchilleaLiveHubProps {
  classement?: LigneClassement[];
  chiffresEsport?: ChiffresEsport;
  previewData?: AchilleaPreviewData;
  showHeader?: boolean;
  description?: string;
  link?: string;
  discordLink?: string;
}

type PreviewTab = "leaderboard" | "clans" | "tournaments" | "modes";

/** Carte miniature de joueur classé (Leaderboard) */
function RankedPlayerMiniCard({ player }: { player: LigneClassement }) {
  const rankClass =
    player.rang === 1
      ? "achillea-rank-1"
      : player.rang === 2
        ? "achillea-rank-2"
        : player.rang === 3
          ? "achillea-rank-3"
          : "achillea-rank-default";

  return (
    <Link
      href="/achillea/ranked/leaderboard"
      className="group/player p-3.5 rounded-2xl bg-achillea-purple-dark/70 hover:bg-achillea-purple-hover border border-achillea-purple/30 hover:border-achillea-lime/60 transition-all duration-200 flex flex-col justify-between relative overflow-hidden h-full"
    >
      <div className="flex items-center gap-3">
        <UserAvatar
          userId={player.userId}
          avatar={player.avatar}
          name={player.nom}
          size="lg"
          className="group-hover/player:scale-105 transition-transform rounded-xl border border-achillea-purple/40"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            <span className={`text-xs font-black px-1.5 py-0.5 rounded border ${rankClass}`}>#{player.rang}</span>
            {player.palier && (
              <span className="text-xs font-bold text-achillea-purple-light px-1.5 py-0.5 rounded bg-achillea-purple/20 border border-achillea-purple/30">
                {player.palier}
              </span>
            )}
          </div>
          <h4 className="text-sm font-bold text-foreground truncate group-hover/player:text-achillea-lime transition-colors">
            {player.nom}
          </h4>
          <div className="text-xs text-muted-foreground tabular-nums">
            {player.victoires}V - {player.defaites}D ({player.parties} matchs)
          </div>
        </div>
      </div>
      <div className="pt-2 mt-2 border-t border-achillea-purple/20 flex items-center justify-between text-xs">
        <span className="font-bold text-achillea-lime tabular-nums text-xs">{player.elo} ELO</span>
        <span className="text-xs text-muted-foreground group-hover/player:text-foreground flex items-center gap-0.5 transition-colors">
          Profil →
        </span>
      </div>
    </Link>
  );
}

/** Carte miniature de Clan compétitif */
function ClanMiniCard({ clan }: { clan: PreviewClan }) {
  return (
    <Link
      href={`/achillea/clans/${clan.id}`}
      className="group/clan p-3.5 rounded-2xl bg-achillea-purple-dark/70 hover:bg-achillea-purple-hover border border-achillea-purple/30 hover:border-achillea-lime/60 transition-all duration-200 flex flex-col justify-between relative overflow-hidden h-full"
    >
      <div className="flex items-center gap-3">
        <div className="relative size-12 shrink-0 rounded-xl overflow-hidden bg-background/60 border border-achillea-purple/40 group-hover/clan:scale-105 transition-transform p-0.5">
          {clan.clanAvatarUrl ? (
            <Image src={clan.clanAvatarUrl} alt={clan.name} fill unoptimized className="object-cover rounded-lg" />
          ) : (
            <div className="size-full flex items-center justify-center font-black text-xs text-achillea-lime bg-achillea-purple/30">
              {clan.shortenedName}
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-xs font-black px-1.5 py-0.5 rounded uppercase tracking-wider bg-achillea-purple/30 text-achillea-lime border border-achillea-purple/60">
              [{clan.shortenedName}]
            </span>
            {clan.isRecruiting ? (
              <span className="text-xs font-semibold px-1.5 py-0.5 rounded achillea-status-recruiting border">
                Recrute
              </span>
            ) : (
              <span className="text-xs font-semibold px-1.5 py-0.5 rounded achillea-status-full border">Complet</span>
            )}
          </div>
          <h4 className="text-sm font-bold text-foreground truncate group-hover/clan:text-achillea-lime transition-colors">
            {clan.name}
          </h4>
          <p className="text-xs text-muted-foreground truncate font-light">
            {clan.clanBiography || "Clan compétitif Inazuma Eleven"}
          </p>
        </div>
      </div>
      <div className="pt-2 mt-2 border-t border-achillea-purple/20 flex items-center justify-between text-xs">
        <span className="text-xs text-muted-foreground flex items-center gap-1">
          <Users className="size-3 text-achillea-purple-light" />
          {clan.membersCount} membres
        </span>
        <span className="text-xs text-muted-foreground group-hover/clan:text-foreground flex items-center gap-0.5 transition-colors">
          Fiche clan →
        </span>
      </div>
    </Link>
  );
}

/** Carte miniature de Tournoi compétitif */
function TournamentMiniCard({ tournament }: { tournament: PreviewTournament }) {
  const formattedDate = tournament.starts_at
    ? new Date(tournament.starts_at).toLocaleDateString("fr-FR", {
        day: "numeric",
        month: "short",
        timeZone: "Europe/Paris",
      })
    : "À venir";

  const formatLabel =
    tournament.tournament_type === "single_elimination"
      ? "Élimination directe"
      : tournament.tournament_type || "Format compétitif";

  return (
    <Link
      href={`/achillea/tournaments/${tournament.id}`}
      className="group/tourn p-3.5 rounded-2xl bg-achillea-purple-dark/70 hover:bg-achillea-purple-hover border border-achillea-purple/30 hover:border-achillea-lime/60 transition-all duration-200 flex flex-col justify-between relative overflow-hidden h-full"
    >
      <div className="flex items-center gap-3">
        <div className="relative size-12 shrink-0 rounded-xl overflow-hidden bg-background/60 border border-achillea-purple/40 group-hover/tourn:scale-105 transition-transform p-1 flex items-center justify-center">
          {tournament.logo ? (
            <Image src={tournament.logo} alt={tournament.name} fill unoptimized className="object-contain p-1" />
          ) : (
            <div className="size-full flex items-center justify-center text-achillea-lime bg-achillea-purple/30">
              <Trophy className="size-5" />
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-achillea-purple/20 text-achillea-purple-light border border-achillea-purple/30">
              {formatLabel}
            </span>
          </div>
          <h4 className="text-sm font-bold text-foreground truncate group-hover/tourn:text-achillea-lime transition-colors">
            {tournament.name}
          </h4>
          <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
            <span className="flex items-center gap-1">
              <Calendar className="size-3 text-achillea-purple-light" />
              {formattedDate}
            </span>
            {tournament.participants_number && <span>· {tournament.participants_number} slots</span>}
          </div>
        </div>
      </div>
      <div className="pt-2 mt-2 border-t border-achillea-purple/20 flex items-center justify-between text-xs">
        <span className="text-xs font-semibold achillea-status-live">
          {tournament.internal_state === "Finished" ? "Terminé" : "Inscriptions / En cours"}
        </span>
        <span className="text-xs text-muted-foreground group-hover/tourn:text-foreground flex items-center gap-0.5 transition-colors">
          Arbre &amp; Brackets →
        </span>
      </div>
    </Link>
  );
}

export function AchilleaLiveHub({
  classement = [],
  chiffresEsport,
  previewData,
  showHeader = true,
  description = "Matchs classés, clans et tournois de la scène compétitive Inazuma Eleven.",
  link = "/achillea",
  discordLink = "https://discord.gg/achillea-competitif-inazuma-eleven-fr-1055585286320554055",
}: AchilleaLiveHubProps) {
  const [activePreview, setActivePreview] = useState<PreviewTab>("clans");
  const [fetchedData, setLiveData] = useState<AchilleaPreviewData | undefined>(previewData);
  const liveData = previewData ?? fetchedData;

  // Synchroniser les données initiales ou charger depuis l'API directe en arrière-plan
  useEffect(() => {
    if (previewData) return;
    let isMounted = true;
    fetch("/api/public/achillea/preview")
      .then(res => res.json())
      .then(data => {
        if (isMounted && data && !data.error) {
          setLiveData(data);
        }
      })
      .catch(() => {});
    return () => {
      isMounted = false;
    };
  }, [previewData]);

  // Données consolidées
  const topPlayers = liveData?.leaderboard || classement;
  const clans = liveData?.clans || [];
  const tournaments = liveData?.tournaments || [];
  const stats = liveData?.stats || chiffresEsport;

  return (
    <section
      aria-label={showHeader ? undefined : "Achilléa"}
      aria-labelledby={showHeader ? "achillea-hub-title" : undefined}
      className="w-full px-4 min-[600px]:px-0"
    >
      <Card className="overflow-hidden border border-achillea-purple/40 achillea-glow-card achillea-card-gradient relative rounded-3xl p-3.5 min-[600px]:p-5 min-[840px]:p-6 flex flex-col gap-4">
        {/* Background lighting effects */}
        <Image
          src="/achillea/achillea-banner.png"
          alt=""
          fill
          sizes="100vw"
          className="pointer-events-none object-cover object-right opacity-[0.08]"
          aria-hidden
        />
        <div className="absolute inset-0 opacity-10 mix-blend-overlay pointer-events-none achillea-bg-noise" />
        <div className="absolute -right-24 -top-24 size-96 bg-achillea-purple rounded-full blur-[140px] opacity-25 pointer-events-none" />
        <div className="absolute -left-24 -bottom-24 size-96 bg-achillea-lime rounded-full blur-[140px] opacity-15 pointer-events-none" />

        {/* ── 1. IDENTITÉ DU HUB ── */}
        {showHeader && (
          <div className="relative z-10 flex flex-col gap-3 border-b border-achillea-purple/30 pb-4 min-[600px]:flex-row min-[600px]:items-center min-[600px]:justify-between">
            {/* Logo & Identité */}
            <div className="flex items-center gap-3 sm:gap-3.5">
              <div className="relative size-11 sm:size-14 shrink-0 rounded-2xl bg-background/50 border border-achillea-lime/40 p-1.5 flex items-center justify-center shadow-lg">
                <Image
                  src="/achillea/logo1.svg"
                  alt="Logo Achilléa"
                  width={44}
                  height={44}
                  className="object-contain achillea-glow-logo"
                />
              </div>
              <div className="min-w-0">
                <h2
                  id="achillea-hub-title"
                  className="text-xl sm:text-2xl md:text-3xl lg:text-4xl font-black text-foreground leading-tight tracking-tight sm:tracking-wide font-expressive-title"
                >
                  <span className="bg-clip-text text-transparent achillea-text-gradient">Achilléa</span>
                </h2>
                <p className="mt-0.5 max-w-xl text-xs text-muted-foreground sm:text-sm">{description}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                asChild
                size="sm"
                className="min-h-10 rounded-xl border border-achillea-lime/50 bg-achillea-purple px-3 text-xs font-black text-achillea-lime hover:bg-achillea-purple/80"
              >
                <Link href={link}>
                  <Swords className="mr-1.5 size-3.5" />
                  Accéder à l'Arène
                </Link>
              </Button>
              <Button
                asChild
                size="sm"
                variant="outline"
                className="min-h-10 rounded-xl border-achillea-purple/50 bg-achillea-purple-dark/80 px-3 text-xs font-bold text-foreground hover:border-achillea-lime/50 hover:bg-achillea-purple/25 hover:text-achillea-lime"
              >
                <a href={discordLink} target="_blank" rel="noopener noreferrer">
                  <DiscordIcon className="mr-1.5 size-3.5" />
                  Discord
                </a>
              </Button>
            </div>
          </div>
        )}

        {/* ── 2. BENTO GRID UNIFIÉ : 2 COLONNES MAJEURES ── */}
        <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-5 lg:gap-6">
          {/* ── COLONNE GAUCHE (7 cols) : SCÈNE COMPÉTITIVE & LIVE PREVIEWS ── */}
          <div className="lg:col-span-12 flex flex-col justify-between gap-4">
            <div className="flex flex-col gap-3">
              {/* En-tête de section & Sélecteur d'onglets immersif */}
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5">
                <div className="flex items-center gap-1.5">
                  <Sparkles className="size-3.5 text-achillea-lime" />
                  <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Compétition</span>
                </div>

                {/* Onglets sélecteurs de preview avec scroll horizontal fluide sur petit mobile */}
                <div className="flex items-center gap-1 overflow-x-auto max-w-full p-0.5 rounded-xl border border-achillea-purple/40 bg-background/50 text-xs">
                  <button
                    type="button"
                    onClick={() => setActivePreview("clans")}
                    className={`flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] shrink-0 rounded-lg font-bold text-xs transition-all ${
                      activePreview === "clans"
                        ? "bg-achillea-lime text-achillea-purple-deep shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Users className="size-3" />
                    Classement des clans
                  </button>
                  <button
                    type="button"
                    onClick={() => setActivePreview("leaderboard")}
                    className={`flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] shrink-0 rounded-lg font-bold text-xs transition-all ${
                      activePreview === "leaderboard"
                        ? "bg-achillea-lime text-achillea-purple-deep shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Trophy className="size-3" />
                    Classement 1v1
                  </button>
                  <button
                    type="button"
                    onClick={() => setActivePreview("tournaments")}
                    className={`flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] shrink-0 rounded-lg font-bold text-xs transition-all ${
                      activePreview === "tournaments"
                        ? "bg-achillea-lime text-achillea-purple-deep shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Award className="size-3" />
                    Tournois
                  </button>
                  <button
                    type="button"
                    onClick={() => setActivePreview("modes")}
                    className={`flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] shrink-0 rounded-lg font-bold text-xs transition-all ${
                      activePreview === "modes"
                        ? "bg-achillea-lime text-achillea-purple-deep shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Gamepad2 className="size-3" />
                    Modes
                  </button>
                </div>
              </div>

              {/* ── Contenu dynamique selon l'onglet ── */}
              {/* Onglet 1 : classement des clans */}
              {activePreview === "clans" && (
                <div className="flex flex-col gap-2.5">
                  <div className="flex items-center justify-between text-xs px-0.5">
                    <span className="text-muted-foreground">
                      {stats?.clans
                        ? `${stats.clans.toLocaleString("fr-FR")} clans compétitifs enregistrés`
                        : "Équipes et rosters"}
                    </span>
                    <Link
                      href="/achillea/clans"
                      className="font-bold text-achillea-lime hover:underline flex items-center gap-1"
                    >
                      Explorer tous les clans
                      <ArrowRight className="size-3" />
                    </Link>
                  </div>
                  <div className="grid grid-cols-1 gap-2.5 max-[599px]:[&>*:nth-child(n+3)]:hidden min-[600px]:grid-cols-2 min-[1200px]:grid-cols-4">
                    {clans && clans.length > 0 ? (
                      clans.map(c => <ClanMiniCard key={c.id} clan={c} />)
                    ) : (
                      <div className="col-span-2 p-6 text-center text-xs text-muted-foreground rounded-2xl bg-background/40 border border-achillea-purple/30">
                        Chargement des clans actifs...
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Onglet 2 : classement ELO 1v1 */}
              {activePreview === "leaderboard" && (
                <div className="flex flex-col gap-2.5">
                  <div className="flex items-center justify-between text-xs px-0.5">
                    <span className="text-muted-foreground">
                      {stats?.joueurs
                        ? `${stats.joueurs.toLocaleString("fr-FR")} joueurs classés sur l'Arène 1v1`
                        : "Ladder 1 contre 1"}
                    </span>
                    <Link
                      href="/achillea/ranked/leaderboard"
                      className="font-bold text-achillea-lime hover:underline flex items-center gap-1"
                    >
                      Voir tout le classement
                      <ArrowRight className="size-3" />
                    </Link>
                  </div>
                  <div className="grid grid-cols-1 gap-2.5 max-[599px]:[&>*:nth-child(n+3)]:hidden min-[600px]:grid-cols-2 min-[1200px]:grid-cols-4">
                    {topPlayers && topPlayers.length > 0 ? (
                      topPlayers.slice(0, 4).map(p => <RankedPlayerMiniCard key={p.userId} player={p} />)
                    ) : (
                      <div className="col-span-2 p-6 text-center text-xs text-muted-foreground rounded-2xl bg-background/40 border border-achillea-purple/30">
                        Chargement des joueurs classés...
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Onglet 3 : Tournois */}
              {activePreview === "tournaments" && (
                <div className="flex flex-col gap-2.5">
                  <div className="flex items-center justify-between text-xs px-0.5">
                    <span className="text-muted-foreground">Tournois homologués et coupes communautaires</span>
                    <Link
                      href="/achillea/tournaments"
                      className="font-bold text-achillea-lime hover:underline flex items-center gap-1"
                    >
                      Voir tous les tournois
                      <ArrowRight className="size-3" />
                    </Link>
                  </div>
                  <div className="grid grid-cols-1 gap-2.5 max-[599px]:[&>*:nth-child(n+3)]:hidden min-[600px]:grid-cols-2 min-[1200px]:grid-cols-4">
                    {tournaments && tournaments.length > 0 ? (
                      tournaments.map(t => <TournamentMiniCard key={t.id} tournament={t} />)
                    ) : (
                      <div className="col-span-2 p-6 text-center text-xs text-muted-foreground rounded-2xl bg-background/40 border border-achillea-purple/30">
                        Chargement des tournois...
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Onglet 4 : Modes & Arène */}
              {activePreview === "modes" && (
                <div className="flex flex-col gap-2.5">
                  <div className="flex items-center justify-between text-xs px-0.5">
                    <span className="text-muted-foreground">
                      {stats?.partiesClassees
                        ? `${stats.partiesClassees.toLocaleString("fr-FR")} matchs disputés`
                        : "Formats de jeu en ligne"}
                    </span>
                    <Link
                      href="/achillea/ranked"
                      className="font-bold text-achillea-lime hover:underline flex items-center gap-1"
                    >
                      Rejoindre une file
                      <ArrowRight className="size-3" />
                    </Link>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <Link
                      href="/achillea/ranked"
                      className="group/mode p-3.5 rounded-2xl bg-achillea-purple-dark/70 hover:bg-achillea-purple-hover border border-achillea-purple/30 hover:border-achillea-lime/60 transition-all duration-200 flex flex-col justify-between"
                    >
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-achillea-purple/30 text-achillea-lime border border-achillea-purple/60">
                            Mode Phare
                          </span>
                          <Swords className="size-3.5 text-achillea-lime group-hover/mode:scale-110 transition-transform" />
                        </div>
                        <h4 className="text-sm font-bold text-foreground group-hover/mode:text-achillea-lime transition-colors">
                          Match 1 contre 1
                        </h4>
                        <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed font-light">
                          Duels tactiques, montée de ligue ELO et règles compétitives.
                        </p>
                      </div>
                      <div className="pt-2 mt-2 border-t border-achillea-purple/20 flex items-center justify-between text-xs">
                        <span className="text-xs text-muted-foreground">Solo Ranking</span>
                        <span className="text-xs text-achillea-lime">Lancer →</span>
                      </div>
                    </Link>

                    <Link
                      href="/achillea/ranked"
                      className="group/mode p-3.5 rounded-2xl bg-achillea-purple-dark/70 hover:bg-achillea-purple-hover border border-achillea-purple/30 hover:border-achillea-lime/60 transition-all duration-200 flex flex-col justify-between"
                    >
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-achillea-purple/30 text-achillea-lime border border-achillea-purple/60">
                            Coop
                          </span>
                          <Users className="size-3.5 text-achillea-lime group-hover/mode:scale-110 transition-transform" />
                        </div>
                        <h4 className="text-sm font-bold text-foreground group-hover/mode:text-achillea-lime transition-colors">
                          Match 2 contre 2
                        </h4>
                        <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed font-light">
                          Jeu en équipe, synergies de jeu et classements duo.
                        </p>
                      </div>
                      <div className="pt-2 mt-2 border-t border-achillea-purple/20 flex items-center justify-between text-xs">
                        <span className="text-xs text-muted-foreground">Duo Ranking</span>
                        <span className="text-xs text-achillea-lime">Lancer →</span>
                      </div>
                    </Link>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </Card>
    </section>
  );
}
