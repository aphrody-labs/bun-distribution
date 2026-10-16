"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import Image from "next/image";
import { useAchilleaAuth, createAchilleaClient, rankImagePath, winRatePercent } from "@/lib/achillea";
import { Sparkline } from "@/components/achillea/Sparkline";
import { useRankedQueue } from "@/lib/achillea/use-ranked-queue";
import type { RankedProfile, RankedTrend, RankedChallengeLink } from "@rosegriffon/achillea-types";
import {
  Swords,
  Trophy,
  History,
  Layers,
  Search,
  Copy,
  Check,
  Sparkles,
  Loader2,
  Play,
  XCircle,
  ExternalLink,
  ShieldAlert,
} from "lucide-react";
import { signalerException } from "@/lib/achillea/signaler";

export default function RankedHubPage() {
  const { isAuthenticated, isLoading, login } = useAchilleaAuth();
  const [mode, setMode] = useState<2 | 4>(2); // 2 = 1v1, 4 = 2v2
  const [isRanked, setIsRanked] = useState<boolean>(true);
  const [profile, setProfile] = useState<RankedProfile | null>(null);
  const [trend, setTrend] = useState<RankedTrend | null>(null);
  const [loadingProfile, setLoadingProfile] = useState<boolean>(true);
  const [profileError, setProfileError] = useState<string | null>(null);

  // Matchmaking search state
  // File d'attente RÉELLE (Colyseus). L'état local qui vivait ici ne faisait
  // que simuler une recherche : aucun serveur n'était contacté.
  const {
    annuler: annulerRecherche,
    ecoulees: searchSeconds,
    erreur: erreurFile,
    etaSecondes,
    recherche: isSearching,
    rejoindre: rejoindreFile,
  } = useRankedQueue();

  // Challenge link state
  const [challengeLink, setChallengeLink] = useState<RankedChallengeLink | null>(null);
  const [creatingLink, setCreatingLink] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  const [, startTransition] = useTransition();

  // Fetch ranked profile and trend
  const [requestIdentity1, setRequestIdentity1] = useState<readonly unknown[]>([isAuthenticated, mode]);
  if ([isAuthenticated, mode].some((value, position) => !Object.is(value, requestIdentity1[position]))) {
    setRequestIdentity1([isAuthenticated, mode]);
    (() => {
      if (!isAuthenticated) {
        setLoadingProfile(false);
        return;
      }
      setLoadingProfile(true);
      setProfileError(null);
      setProfile(null);
    })();
  }
  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    let cancelled = false;

    const client = createAchilleaClient();

    Promise.all([client.ranked.me(mode), client.users.myRankedTrend({ mode, last: 20 })])
      .then(([profRes, trendRes]) => {
        if (cancelled) return;
        if (profRes.ok) {
          setProfile(profRes.value);
        } else {
          setProfileError("Votre profil classé est momentanément indisponible.");
        }
        if (trendRes.ok) {
          setTrend(trendRes.value);
        }
      })
      .catch(cause => {
        signalerException("ranked", cause);
      })
      .finally(() => {
        if (!cancelled) setLoadingProfile(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, mode]);

  // Search matchmaking counter
  const formatTimer = (totalSecs: number) => {
    const m = Math.floor(totalSecs / 60)
      .toString()
      .padStart(2, "0");
    const s = (totalSecs % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  const handleCreateChallenge = async () => {
    setCreatingLink(true);
    const client = createAchilleaClient();
    try {
      const res = await client.ranked.createChallenge({ mode, ranked: isRanked });
      if (res.ok) {
        setChallengeLink(res.value);
      }
    } finally {
      setCreatingLink(false);
    }
  };

  const handleCopy = () => {
    if (!challengeLink) return;
    const fullUrl = `${window.location.origin}/achillea/ranked/defi/${challengeLink.code}`;
    navigator.clipboard.writeText(fullUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const tierKey = profile?.tier?.key ?? "Non classé";
  const tierBadgePath = rankImagePath(tierKey, "/ranks");
  const gradientStops = profile?.tier?.gradient?.length
    ? `linear-gradient(135deg, ${profile.tier.gradient.join(", ")})`
    : "linear-gradient(135deg, #959595, #494949)";
  const winrate = profile ? winRatePercent(profile.wins, profile.gamesPlayed) : 0;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border pb-6">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <Swords className="w-5 h-5" />
            </span>
            <h1 className="text-3xl font-bold tracking-tight">Système Classé (Ranked)</h1>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Affrontez les meilleurs joueurs en 1v1 ou 2v2, grimpez les 11 paliers ELO et gagnez des Achilléa Points
            (AP).
          </p>
        </div>

        {/* Quick nav pills */}
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            href="/achillea/ranked/leaderboard"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-border bg-card hover:bg-accent transition-colors"
          >
            <Trophy className="w-3.5 h-3.5 text-amber-400" />
            Classement
          </Link>
          <Link
            href="/achillea/ranked/tiers"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-border bg-card hover:bg-accent transition-colors"
          >
            <Layers className="w-3.5 h-3.5 text-blue-400" />
            Paliers
          </Link>
          <Link
            href="/achillea/ranked/history"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-border bg-card hover:bg-accent transition-colors"
          >
            <History className="w-3.5 h-3.5 text-emerald-400" />
            Historique
          </Link>
        </div>
      </div>

      {/* Mode & Type Selectors */}
      <div className="flex flex-wrap items-center justify-center gap-4 p-2 bg-card/60 backdrop-blur-sm border border-border rounded-xl">
        <div className="flex items-center p-1 bg-muted rounded-lg">
          <button
            type="button"
            onClick={() => startTransition(() => setMode(2))}
            className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-all ${
              mode === 2
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            1 contre 1 (Solo)
          </button>
          <button
            type="button"
            onClick={() => startTransition(() => setMode(4))}
            className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-all ${
              mode === 4
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            2 contre 2 (Duo)
          </button>
        </div>

        <div className="flex items-center p-1 bg-muted rounded-lg">
          <button
            type="button"
            onClick={() => setIsRanked(true)}
            className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-all ${
              isRanked ? "bg-amber-500 text-black shadow-sm font-bold" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Classé (ELO)
          </button>
          <button
            type="button"
            onClick={() => setIsRanked(false)}
            className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-all ${
              !isRanked
                ? "bg-secondary text-secondary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Amical (Sans ELO)
          </button>
        </div>
      </div>

      {/*
       * Seul le PROFIL personnel (ELO, victoires, tendance) demande une
       * session : le classement complet et les paliers restent lisibles sans
       * compte, et le mur le dit au lieu de laisser croire que tout le mode
       * classé est fermé.
       *
       * `isLoading` d'abord : sinon le mur s'affiche le temps que
       * `GET /auth/me` réponde, y compris à un joueur déjà connecté.
       */}
      {isLoading ? (
        <div className="p-12 text-center border border-border rounded-2xl bg-card text-sm text-muted-foreground">
          Vérification de la session…
        </div>
      ) : !isAuthenticated ? (
        <div className="p-8 border border-border/80 bg-card/40 backdrop-blur-sm rounded-2xl text-center space-y-4">
          <ShieldAlert className="w-12 h-12 text-amber-400 mx-auto opacity-80" />
          <div className="space-y-1">
            <h2 className="text-xl font-bold">Connexion requise pour votre profil classé</h2>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Connectez-vous avec votre compte Discord pour enregistrer vos statistiques, grimper le classement et
              participer aux matchs compétitifs.
            </p>
            <p className="text-xs text-muted-foreground max-w-md mx-auto pt-1">
              Le{" "}
              <Link href="/achillea/ranked/leaderboard" className="font-semibold underline hover:text-foreground">
                classement complet
              </Link>{" "}
              et les{" "}
              <Link href="/achillea/ranked/tiers" className="font-semibold underline hover:text-foreground">
                paliers
              </Link>{" "}
              restent consultables sans compte.
            </p>
          </div>
          <button
            type="button"
            onClick={() => login()}
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-primary text-primary-foreground font-semibold rounded-lg hover:bg-primary/90 transition shadow-lg"
          >
            Se connecter avec Discord
          </button>
        </div>
      ) : loadingProfile ? (
        <div className="p-12 text-center border border-border rounded-2xl bg-card">
          <Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">Chargement de votre profil classé...</p>
        </div>
      ) : profileError || !profile ? (
        <div
          role="alert"
          className="p-8 border border-rose-500/30 bg-card rounded-2xl text-center text-sm text-rose-400"
        >
          {profileError ?? "Profil classé introuvable."}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Profile card */}
          <div className="md:col-span-2 border border-border bg-card rounded-2xl p-6 shadow-sm flex flex-col justify-between">
            <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6">
              {profile.tier ? (
                <div
                  className="w-28 h-28 rounded-2xl p-3 flex items-center justify-center shrink-0 shadow-lg relative overflow-hidden"
                  style={{ background: gradientStops }}
                >
                  <Image
                    src={tierBadgePath}
                    alt={tierKey}
                    width={96}
                    height={96}
                    className="object-contain drop-shadow-md"
                    priority
                  />
                </div>
              ) : (
                <div className="w-28 h-28 rounded-2xl flex items-center justify-center shrink-0 border border-border bg-muted text-sm font-semibold text-muted-foreground">
                  À jouer
                </div>
              )}

              <div className="space-y-3 text-center sm:text-left flex-1">
                <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
                  <h2 className="text-2xl font-bold tracking-tight">{tierKey}</h2>
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30">
                    {profile?.elo ?? 0} AP
                  </span>
                  <span className="px-2 py-0.5 rounded-md text-xs font-medium bg-muted text-muted-foreground">
                    {mode === 2 ? "1v1" : "2v2"}
                  </span>
                  {profile.globalRank != null && (profile.totalPlayers ?? 0) > 0 && profile.percentile != null && (
                    <span className="px-2 py-0.5 rounded-md text-xs font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
                      Top {profile.percentile}%
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div className="p-2 rounded-lg bg-background/60 border border-border">
                    <div className="text-muted-foreground">Victoires</div>
                    <div className="text-base font-bold text-emerald-400">{profile?.wins ?? 0}</div>
                  </div>
                  <div className="p-2 rounded-lg bg-background/60 border border-border">
                    <div className="text-muted-foreground">Défaites</div>
                    <div className="text-base font-bold text-rose-400">{profile?.losses ?? 0}</div>
                  </div>
                  <div className="p-2 rounded-lg bg-background/60 border border-border">
                    <div className="text-muted-foreground">Taux V</div>
                    <div className="text-base font-bold">{winrate}%</div>
                  </div>
                  <div className="p-2 rounded-lg bg-background/60 border border-border">
                    <div className="text-muted-foreground">Pic ELO</div>
                    <div className="text-base font-bold text-amber-400">{profile?.peakRating ?? 0} AP</div>
                  </div>
                </div>

                {trend?.sparkline && trend.sparkline.length > 1 && (
                  <div className="pt-2 flex items-center justify-between gap-4 border-t border-border/50 text-xs text-muted-foreground">
                    <span>Tendance récente ({trend.sparkline.length} m.)</span>
                    <Sparkline data={trend.sparkline} width={140} height={28} />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Challenge link or quick action */}
          <div className="border border-border bg-card rounded-2xl p-6 flex flex-col justify-between space-y-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-400" />
                <h3 className="font-semibold text-sm">Défi Direct</h3>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Générez un lien d'invitation pour affronter un adversaire précis sans passer par la file automatique.
              </p>
            </div>

            {challengeLink ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 p-2 bg-background border border-border rounded-lg text-xs font-mono">
                  <span className="truncate flex-1">CODE: {challengeLink.code}</span>
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="p-1.5 rounded-md hover:bg-muted transition text-muted-foreground hover:text-foreground"
                    title="Copier le lien"
                  >
                    {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-[11px] text-emerald-400 font-medium">
                  Lien généré ! Partagez-le à votre adversaire.
                </p>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleCreateChallenge}
                disabled={creatingLink}
                className="w-full py-2 px-3 text-xs font-semibold rounded-lg border border-border bg-secondary hover:bg-secondary/80 transition flex items-center justify-center gap-2"
              >
                {creatingLink ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Play className="w-3.5 h-3.5 text-amber-400" />
                )}
                Créer un lien de défi
              </button>
            )}

            <Link
              href="/achillea/ranked/match"
              className="inline-flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition pt-2 border-t border-border"
            >
              Accéder à l'écran de match en cours
              <ExternalLink className="w-3 h-3" />
            </Link>
          </div>
        </div>
      )}

      {/* Matchmaking Queue Card */}
      {isAuthenticated && (
        <div className="border border-border/80 bg-gradient-to-b from-card/80 to-card rounded-2xl p-8 text-center space-y-6 shadow-md">
          {!isSearching ? (
            <div className="space-y-4 max-w-md mx-auto">
              <div className="space-y-1">
                <h3 className="text-xl font-bold">Lancer une recherche</h3>
                <p className="text-sm text-muted-foreground">
                  Recherchez un joueur de votre niveau en {mode === 2 ? "1v1" : "2v2"} (
                  <span className="font-semibold text-foreground">{isRanked ? "Classé" : "Amical"}</span>
                  ).
                </p>
              </div>

              <button
                type="button"
                onClick={() => void rejoindreFile(mode === 4 ? "2v2" : "1v1", isRanked)}
                className="inline-flex items-center gap-2 px-8 py-3 bg-[var(--achillea-primary)] hover:bg-[var(--achillea-primary-400)] text-white font-bold text-sm rounded-xl transition shadow-lg active:scale-95"
              >
                <Search className="w-4 h-4" />
                Rechercher un adversaire
              </button>
            </div>
          ) : (
            <div className="space-y-5 max-w-md mx-auto py-2">
              <div className="relative w-20 h-20 mx-auto flex items-center justify-center">
                <span className="absolute inset-0 rounded-full bg-amber-500/20 animate-ping" />
                <span className="absolute inset-2 rounded-full border border-amber-500/40 animate-spin" />
                <Search className="w-8 h-8 text-amber-400 relative z-10" />
              </div>

              <div className="space-y-1">
                <h3 className="text-lg font-bold">Recherche d'adversaire en cours...</h3>
                <div className="text-2xl font-mono font-bold text-amber-400">{formatTimer(searchSeconds)}</div>
                <p className="text-xs text-muted-foreground">
                  {etaSecondes === null
                    ? "En attente d'une estimation du serveur…"
                    : `Attente estimée : ~${etaSecondes} s`}
                </p>
              </div>

              {erreurFile ? <p className="text-xs font-medium text-destructive">{erreurFile}</p> : null}

              <div className="flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => void annulerRecherche()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg border border-destructive/40 text-destructive hover:bg-destructive/10 transition"
                >
                  <XCircle className="w-4 h-4" />
                  Annuler la recherche
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
