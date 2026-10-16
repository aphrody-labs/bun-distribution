"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  createAchilleaClient,
  useAchilleaAuth,
  stageTypeLabel,
  tournamentStateLabel,
  tournamentStateTone,
  badgeVariant,
  placementPrizeAp,
  isTournamentOrganizer,
} from "@/lib/achillea";

import { TournamentBracket } from "@/components/achillea/TournamentBracket";
import { TournamentScoresDialog } from "@/components/achillea/TournamentScoresDialog";
import { TournamentLifecycleActions } from "@/components/achillea/TournamentLifecycleActions";
import { TournamentEventsJournal } from "@/components/achillea/TournamentEventsJournal";
import { TournamentTopSummary } from "@/components/achillea/TournamentTopSummary";
import { EventParticipantsTable } from "@/components/achillea/EventParticipantsTable";
import { PlayerNotesPanel } from "@/components/achillea/PlayerNotesPanel";
import { Badge, Button, Skeleton } from "@rosegriffon/ui";
import type { WireTournament, WireParticipant } from "@rosegriffon/achillea-types/domain/tournament-ops";
import type { ParticipantDTO } from "@rosegriffon/achillea-types";
import { TournamentState } from "@rosegriffon/achillea-types/enums/eventEnums";
import {
  Trophy,
  ArrowLeft,
  Calendar,
  Users,
  ShieldCheck,
  ShieldAlert,
  Layers,
  AlertCircle,
  Coins,
  FileText,
  UserPlus,
  UserMinus,
  Loader2,
  Activity,
} from "lucide-react";

export default function TournamentDetailPage({ id }: { id: string }) {
  const tournamentId = parseInt(id, 10);

  const { user, isAuthenticated, login } = useAchilleaAuth();

  const [tournament, setTournament] = useState<WireTournament | null>(null);
  const [participants, setParticipants] = useState<WireParticipant[]>([]);
  const [bracketData, setBracketData] = useState<unknown>(null);
  const [loading, setLoading] = useState<boolean>(!Number.isNaN(tournamentId));
  const [error, setError] = useState<string | null>(
    Number.isNaN(tournamentId) ? "Identifiant de tournoi invalide." : null,
  );
  const [activeTab, setActiveTab] = useState<
    "overview" | "bracket" | "participants" | "summary" | "events" | "organizers" | "notes"
  >("overview");
  const tabListRef = useRef<HTMLDivElement>(null);

  const [selectedMatchId, setSelectedMatchId] = useState<number | null>(null);
  const [isRegistering, setIsRegistering] = useState<boolean>(false);

  const loadTournament = () => {
    if (isNaN(tournamentId)) return;
    const client = createAchilleaClient();
    return client.tournaments
      .get(tournamentId)
      .then(res => {
        if (res.ok && res.value) {
          setTournament(res.value[0]);
          setParticipants(res.value[1] ?? []);
          setBracketData(res.value[2] ?? null);
        } else {
          setError("Tournoi introuvable ou indisponible.");
        }
      })
      .catch(() => {
        setError("Erreur de communication avec le serveur.");
      })
      .finally(() => {
        setLoading(false);
      });
  };

  const [requestIdentity1, setRequestIdentity1] = useState<readonly unknown[]>([tournamentId]);
  if ([tournamentId].some((value, position) => !Object.is(value, requestIdentity1[position]))) {
    setRequestIdentity1([tournamentId]);
    (() => {
      if (isNaN(tournamentId)) {
        setError("Identifiant de tournoi invalide.");
        setLoading(false);
        return;
      }
      setLoading(true);
    })();
  }
  useEffect(() => {
    if (isNaN(tournamentId)) {
      return;
    }

    void loadTournament();
  }, [tournamentId]);

  const isUserRegistered = Boolean(user && participants.some(p => p.user?.id === user.id));

  const isOrganizer = Boolean(tournament && isTournamentOrganizer(user, tournament as any));

  const handleToggleRegister = async () => {
    if (!isAuthenticated) {
      login();
      return;
    }
    if (!tournament) return;

    setIsRegistering(true);
    const client = createAchilleaClient({ credentials: "include" });

    try {
      if (isUserRegistered) {
        await client.tournaments.unregister(tournament.id);
        setParticipants(prev => prev.filter(p => p.user?.id !== user?.id));
      } else {
        await client.tournaments.participate(tournament.id);
        void loadTournament();
      }
    } finally {
      setIsRegistering(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-12 space-y-6">
        <Skeleton className="h-8 w-48 rounded-lg" />
        <Skeleton className="h-64 w-full rounded-2xl" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Skeleton className="h-48 md:col-span-2 rounded-2xl" />
          <Skeleton className="h-48 rounded-2xl" />
        </div>
      </div>
    );
  }

  if (error || !tournament) {
    return (
      <div className="max-w-md mx-auto px-4 py-20 text-center space-y-4">
        <AlertCircle className="w-12 h-12 text-rose-500 mx-auto" />
        <h2 className="text-xl font-bold">{error ?? "Tournoi introuvable"}</h2>
        <Button asChild variant="outline">
          <Link href="/achillea/tournaments">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Retour aux tournois
          </Link>
        </Button>
      </div>
    );
  }

  const tone = tournamentStateTone(tournament.internalState);
  const variant = badgeVariant(tone);
  const stateLabel = tournamentStateLabel(tournament.internalState);
  const formatLabel = stageTypeLabel(tournament.tournamentType);

  const startDate = new Date(tournament.startsAt).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  // `participantsNumber` est `null` tant que le format n'est pas figé : le
  // barème de podium n'a alors pas de sens, on le calcule sur 0.
  const nbParticipants = tournament.participantsNumber ?? 0;
  const firstPrize = placementPrizeAp(nbParticipants, 1);
  const secondPrize = placementPrizeAp(nbParticipants, 2);
  const semiPrize = placementPrizeAp(nbParticipants, 3);
  const tabs: { id: typeof activeTab; label: string; icon: typeof FileText }[] = [
    { id: "overview", label: "Présentation & Règles", icon: FileText },
    { id: "bracket", label: "Arbre du tournoi", icon: Layers },
    { id: "participants", label: `Participants (${participants.length})`, icon: Users },
    { id: "summary", label: "Podium & Résultats", icon: Trophy },
    { id: "events", label: "Journal d'arbitrage", icon: Activity },
    { id: "organizers", label: "Organisateurs", icon: ShieldCheck },
    ...(isOrganizer ? [{ id: "notes" as const, label: "Notes Staff", icon: ShieldAlert }] : []),
  ];
  const selectTab = (tabId: typeof activeTab, focus = false) => {
    setActiveTab(tabId);
    if (focus)
      requestAnimationFrame(() =>
        tabListRef.current?.querySelector<HTMLButtonElement>(`#tournament-tab-${tabId}`)?.focus(),
      );
  };
  const onTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const index = tabs.findIndex(tab => tab.id === activeTab);
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    selectTab(tabs[next].id, true);
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">
      {/* Top breadcrumb */}
      <div className="space-y-1">
        <Link
          href="/achillea/tournaments"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition mb-2"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Retour aux tournois
        </Link>
      </div>

      {/* Tournament Hero Card */}
      <div className="relative border border-border bg-card rounded-3xl overflow-hidden shadow-sm">
        {/* Banner background if available */}
        {tournament.affiche && (
          <div className="relative w-full h-48 md:h-64 overflow-hidden">
            <Image
              src={tournament.affiche}
              alt={tournament.name}
              fill
              unoptimized
              className="object-cover brightness-75"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-card via-card/40 to-transparent" />
          </div>
        )}

        <div className={`p-6 md:p-8 ${tournament.affiche ? "-mt-16 relative z-10" : ""}`}>
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div className="flex items-center gap-5">
              <div className="relative w-20 h-20 rounded-2xl overflow-hidden bg-muted shrink-0 border-2 border-border shadow-md">
                {tournament.logo ? (
                  <Image src={tournament.logo} alt={tournament.name} fill unoptimized className="object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                    <Trophy className="w-8 h-8 text-amber-400" />
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">{tournament.name}</h1>
                  <Badge variant={variant} className="text-xs">
                    {stateLabel}
                  </Badge>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {typeof tournament.organization === "object" && tournament.organization !== null
                      ? tournament.organization.name
                      : "Achilléa Esport"}
                  </span>
                  <span>·</span>
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5 text-primary" />
                    {startDate}
                  </span>
                </div>
              </div>
            </div>

            {/* Register action button */}
            {tournament.internalState === TournamentState.PREREGISTERING && (
              <button
                type="button"
                onClick={handleToggleRegister}
                disabled={isRegistering}
                className={`inline-flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold text-xs transition shadow-sm self-stretch sm:self-auto justify-center ${
                  isUserRegistered
                    ? "bg-rose-600/10 hover:bg-rose-600/20 text-rose-400 border border-rose-600/30"
                    : "bg-primary text-primary-foreground hover:bg-primary/90"
                }`}
              >
                {isRegistering ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : isUserRegistered ? (
                  <>
                    <UserMinus className="w-4 h-4" />
                    Se désinscrire
                  </>
                ) : !isAuthenticated ? (
                  /*
                   * La fiche du tournoi est publique : format, inscrits et arbre
                   * de rencontres s'affichent sans session. Seule l'INSCRIPTION
                   * en demande une — le bouton le dit au lieu de rediriger un
                   * visiteur vers Discord sans prévenir.
                   */
                  <>
                    <UserPlus className="w-4 h-4" />
                    Se connecter pour s'inscrire
                  </>
                ) : (
                  <>
                    <UserPlus className="w-4 h-4" />
                    S'inscrire au tournoi
                  </>
                )}
              </button>
            )}
          </div>

          {/* Metadata strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6 pt-6 border-t border-border/60 text-xs">
            <div className="p-3 rounded-xl bg-background/60 border border-border">
              <div className="text-muted-foreground">Format</div>
              <div className="font-bold text-foreground mt-0.5">{formatLabel}</div>
            </div>
            <div className="p-3 rounded-xl bg-background/60 border border-border">
              <div className="text-muted-foreground">Places</div>
              <div className="font-bold text-foreground mt-0.5">
                {participants.length} / {tournament.participantsNumber}
              </div>
            </div>
            <div className="p-3 rounded-xl bg-background/60 border border-border">
              <div className="text-muted-foreground">Cashprize 1er</div>
              <div className="font-bold text-amber-400 mt-0.5">{firstPrize} AP</div>
            </div>
            <div className="p-3 rounded-xl bg-background/60 border border-border">
              <div className="text-muted-foreground">Jeu officiel</div>
              <div className="font-bold text-foreground mt-0.5">IE: Victory Road</div>
            </div>
          </div>
        </div>
      </div>

      {/* Panneau Organisateur / Arbitre */}
      {isOrganizer && <TournamentLifecycleActions tournament={tournament} onUpdated={() => void loadTournament()} />}

      {/* Tabs Navigation */}
      <div
        ref={tabListRef}
        role="tablist"
        aria-label="Sections du tournoi"
        className="flex items-center gap-2 border-b border-border pb-px overflow-x-auto"
      >
        {tabs.map(({ id: tabId, label, icon: Icon }) => (
          <button
            key={tabId}
            id={`tournament-tab-${tabId}`}
            type="button"
            role="tab"
            aria-selected={activeTab === tabId}
            aria-controls={`tournament-panel-${tabId}`}
            tabIndex={activeTab === tabId ? 0 : -1}
            onClick={() => selectTab(tabId)}
            onKeyDown={onTabKeyDown}
            className={`min-h-11 shrink-0 px-4 py-2 text-lg font-semibold border-b-2 transition -mb-px flex items-center gap-2 rounded-t-lg focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-[-3px] focus-visible:outline-amber-300 ${activeTab === tabId ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            <Icon aria-hidden="true" className="w-5 h-5" />
            {label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`tournament-panel-${activeTab}`}
        aria-labelledby={`tournament-tab-${activeTab}`}
        tabIndex={0}
        className="focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-amber-300 rounded-lg"
      >
        {/* Tab 1: Overview */}
        {activeTab === "overview" && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-2 border border-border bg-card rounded-2xl p-6 space-y-4">
              <h3 className="font-bold text-base">Règlement et Informations</h3>
              <div className="text-xs text-muted-foreground leading-relaxed whitespace-pre-line">
                {tournament.description ||
                  "Bienvenue dans ce tournoi officiel de la scène Achilléa. Les matchs se déroulent en salon privé sous la surveillance des arbitres officiels."}
              </div>

              <div className="pt-4 border-t border-border/60 space-y-2">
                <h4 className="font-bold text-xs text-foreground">Déroulement des rencontres :</h4>
                <ul className="list-disc list-inside text-xs text-muted-foreground space-y-1">
                  <li>Format des matchs : {formatLabel}.</li>
                  <li>Saisie des scores via l'interface Achilléa à la fin du match.</li>
                  <li>En cas de déconnexion, capture d'écran obligatoire pour arbitrage.</li>
                </ul>
              </div>
            </div>

            <div className="border border-border bg-card rounded-2xl p-6 space-y-4">
              <h3 className="font-bold text-base flex items-center gap-2">
                <Coins className="w-4 h-4 text-amber-400" />
                Récompenses (AP)
              </h3>
              <div className="space-y-2.5 text-xs">
                <div className="flex items-center justify-between p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
                  <span className="font-bold text-amber-400">1ère Place</span>
                  <span className="font-mono font-bold text-foreground">+{firstPrize} AP</span>
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-400/10 border border-slate-400/20">
                  <span className="font-bold text-slate-300">2ème Place</span>
                  <span className="font-mono font-bold text-foreground">+{secondPrize} AP</span>
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-lg bg-amber-700/10 border border-amber-700/20">
                  <span className="font-bold text-amber-600">Demi-finalistes</span>
                  <span className="font-mono font-bold text-foreground">+{semiPrize} AP</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Bracket */}
        {activeTab === "bracket" && (
          <TournamentBracket
            bracketData={bracketData}
            participants={participants}
            maxSlots={tournament.participantsNumber ?? 16}
            isOngoing={tournament.internalState === TournamentState.ONGOING}
            canReportScore={isOrganizer || Boolean(isUserRegistered)}
            onSelectMatch={mId => setSelectedMatchId(mId)}
          />
        )}

        {/* Tab 3: Participants */}
        {activeTab === "participants" && (
          <EventParticipantsTable
            eventId={tournament.id}
            eventName={tournament.name}
            participantsCount={tournament.participantsNumber ?? 16}
            internalState={tournament.internalState}
            participants={participants as unknown as ParticipantDTO[]}
            canManage={isOrganizer}
            onReload={loadTournament}
          />
        )}

        {/* Tab 4: Podium & Summary */}
        {activeTab === "summary" && (
          <TournamentTopSummary
            tournamentId={tournament.id}
            isFinished={tournament.internalState === TournamentState.FINISHED}
          />
        )}

        {/* Tab 5: Events Journal */}
        {activeTab === "events" && <TournamentEventsJournal tournamentId={tournament.id} />}

        {/* Tab 6: Organizers */}
        {activeTab === "organizers" && (
          <div className="border border-border bg-card rounded-2xl p-6 space-y-4">
            <h3 className="font-bold text-sm">Staff & Arbitres du tournoi</h3>
            <div className="p-4 rounded-xl bg-background/60 border border-border flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary font-bold">
                A
              </div>
              <div>
                <div className="font-bold text-xs">
                  {typeof tournament.organization === "object" && tournament.organization !== null
                    ? tournament.organization.name
                    : "Achilléa Esport"}
                </div>
                <div className="text-xs text-muted-foreground">Organisateur principal</div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 7: Notes Staff & Litiges (Organizers only) */}
        {activeTab === "notes" && isOrganizer && (
          <PlayerNotesPanel
            tournamentId={tournament.id}
            candidates={participants.map(p => ({
              id: String(p.user?.id ?? p.id),
              label: p.user?.username ?? `Joueur #${p.id}`,
              avatar: p.user?.avatar,
            }))}
            title={`Registre des signalements — Tournoi #${tournament.id}`}
          />
        )}
      </div>

      {/* Modal Dialog de Saisie & Validation des Scores */}
      {selectedMatchId !== null && (
        <TournamentScoresDialog
          matchId={selectedMatchId}
          tournamentId={tournament.id}
          isOrganizer={isOrganizer}
          onClose={() => setSelectedMatchId(null)}
          onScoreUpdated={() => void loadTournament()}
        />
      )}
    </div>
  );
}
