"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAchilleaAuth, createAchilleaClient } from "@/lib/achillea";
import { absoluteUrl } from "@/lib/site-url";
import { StageType, MatchFormat, ScoreReportPolicy } from "@rosegriffon/achillea-types/enums/eventEnums";
import type { SeedOrdering } from "@rosegriffon/achillea-types/domain/brackets";
import type { OrganizationDTO } from "@rosegriffon/achillea-types/domain/organization";
import { isPlacementPrizeEligible, prizeTableForTournamentSize } from "@rosegriffon/achillea-core";
import {
  Trophy,
  ArrowLeft,
  ShieldAlert,
  Loader2,
  Check,
  Sparkles,
  Calendar,
  Users,
  FileText,
  Layers,
  ChevronRight,
  ChevronLeft,
  Image as ImageIcon,
  Clock,
  SlidersHorizontal,
  Bot,
  ShieldCheck,
  AlertCircle,
} from "lucide-react";

const MATCH_FORMAT_OPTIONS = [
  { label: "BO1 (1 manche gagnante)", value: MatchFormat.BO1 },
  { label: "BO3 (2 manches gagnantes)", value: MatchFormat.BO3 },
  { label: "BO5 (3 manches gagnantes)", value: MatchFormat.BO5 },
  { label: "Aller-retour (Double Leg)", value: MatchFormat.DOUBLE_LEG },
  { label: "Format personnalisé", value: MatchFormat.CUSTOM },
];

const STAGE_TYPE_OPTIONS = [
  { label: "Élimination directe (Single Elimination)", value: StageType.single_elimination },
  { label: "Double élimination (Winners & Losers bracket)", value: StageType.double_elimination },
  { label: "Toutes rondes (Round Robin)", value: StageType.round_robin },
  { label: "Championnat officiel (Ligue)", value: StageType.league },
];

const SEED_ORDERING_OPTIONS: Array<{ label: string; value: SeedOrdering; desc: string }> = [
  {
    label: "Naturel (1 vs N, 2 vs N-1)",
    value: "natural",
    desc: "Ordre compétitif usuel selon le classement initial",
  },
  {
    label: "Inner-Outer",
    value: "inner_outer",
    desc: "Équilibre les têtes de séries dans les moitiés d'arbre",
  },
  { label: "Inversé", value: "reverse", desc: "Ordre inversé des têtes de séries" },
  {
    label: "Groupes optimisés",
    value: "groups.seed_optimized",
    desc: "Répartition équitable par poules selon les seeds",
  },
];

const SCORE_REPORT_OPTIONS = [
  {
    label: "Saisie par les joueurs (Standard)",
    value: ScoreReportPolicy.PLAYERS,
    description:
      "Les 2 joueurs déclarent et valident leur score dans le lobby du match. Le staff intervient uniquement en cas de litige.",
  },
  {
    label: "Réservé aux arbitres et staff",
    value: ScoreReportPolicy.STAFF_ONLY,
    description:
      "Seuls les organisateurs et arbitres enregistrent les résultats. Idéal pour les phases finales streamées.",
  },
];

export default function TournamentCreationPage() {
  const router = useRouter();
  const { isAuthenticated, login, isLoading: authLoading } = useAchilleaAuth();
  const [organizations, setOrganizations] = useState<OrganizationDTO[]>([]);
  const [organizationsLoading, setOrganizationsLoading] = useState(false);
  const [organizationId, setOrganizationId] = useState<string>("");

  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1 : Format & Capacité
  const [name, setName] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [stageType, setStageType] = useState<StageType>(StageType.single_elimination);
  const [matchFormat, setMatchFormat] = useState<MatchFormat>(MatchFormat.BO3);
  const [capacity, setCapacity] = useState<number>(32);

  // Step 2 : Planning & Automatisation
  const [startDate, setStartDate] = useState<string>("");
  const [grandFinalDate, setGrandFinalDate] = useState<string>("");
  const [regOpensAt, setRegOpensAt] = useState<string>("");
  const [regClosesAt, setRegClosesAt] = useState<string>("");
  const [autoStart, setAutoStart] = useState<boolean>(false);
  const [discordRole, setDiscordRole] = useState<boolean>(false);
  const [scorePolicy, setScorePolicy] = useState<ScoreReportPolicy>(ScoreReportPolicy.PLAYERS);
  const [seedOrdering, setSeedOrdering] = useState<SeedOrdering>("natural");
  const [planningUrl, setPlanningUrl] = useState<string>("");
  const [bypassRules, setBypassRules] = useState<boolean>(false);

  // Step 3 : Visuels & Règlement
  const [logo, setLogo] = useState<string>("");
  const [affiche, setAffiche] = useState<string>("");
  const [ruleset, setRuleset] = useState<string>("");

  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const [requestIdentity1, setRequestIdentity1] = useState<readonly unknown[]>([authLoading, isAuthenticated]);
  if ([authLoading, isAuthenticated].some((value, position) => !Object.is(value, requestIdentity1[position]))) {
    setRequestIdentity1([authLoading, isAuthenticated]);
    (() => {
      if (authLoading || !isAuthenticated) return;
      setOrganizationsLoading(true);
    })();
  }
  useEffect(() => {
    if (authLoading || !isAuthenticated) return;
    let cancelled = false;

    createAchilleaClient({ credentials: "include" })
      .organizations.mine()
      .then(result => {
        if (cancelled) return;
        if (!result.ok) {
          setError("Impossible de charger vos organisations. Vérifiez vos droits d'organisateur.");
          return;
        }
        const available = (result.value.data ?? []).filter(organization => {
          const id = Number(organization.id);
          return Number.isInteger(id) && id > 0;
        });
        setOrganizations(available);
        setOrganizationId(current => current || String(available[0]?.id ?? ""));
      })
      .catch(() => setError("Impossible de charger vos organisations. Réessayez dans quelques instants."))
      .finally(() => {
        if (!cancelled) setOrganizationsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authLoading, isAuthenticated]);

  // Bonus podium preview
  const isEligibleForPrizes = isPlacementPrizeEligible(stageType);
  const prizeTable = isEligibleForPrizes ? prizeTableForTournamentSize(capacity) : null;

  const validateStep1 = () => {
    if (name.trim().length < 3) {
      setError("Le nom du tournoi doit comporter au moins 3 caractères.");
      return false;
    }
    if (name.trim().length > 50) {
      setError("Le nom du tournoi ne peut pas dépasser 50 caractères.");
      return false;
    }
    setError(null);
    return true;
  };

  const validateStep2 = () => {
    if (!startDate) {
      setError("Veuillez sélectionner une date de début pour le tournoi.");
      return false;
    }
    const starts = new Date(startDate);
    if (Number.isNaN(starts.getTime())) {
      setError("Date de début invalide.");
      return false;
    }
    if (grandFinalDate) {
      const ends = new Date(grandFinalDate);
      if (ends <= starts) {
        setError("La grande finale doit se dérouler après la date de début.");
        return false;
      }
    }
    setError(null);
    return true;
  };

  const goToNextStep = () => {
    if (step === 1 && validateStep1()) {
      setStep(2);
    } else if (step === 2 && validateStep2()) {
      setStep(3);
    }
  };

  const goToPrevStep = () => {
    setError(null);
    if (step === 3) setStep(2);
    else if (step === 2) setStep(1);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateStep1() || !validateStep2()) return;
    if (!organizationId) {
      setError("Sélectionnez une organisation avant de créer le tournoi.");
      setStep(1);
      return;
    }

    setError(null);
    setSubmitting(true);
    const client = createAchilleaClient({ credentials: "include" });

    try {
      const starts = new Date(startDate);
      const grandFinal = grandFinalDate ? new Date(grandFinalDate) : new Date(starts.getTime() + 7200000);

      const res = await client.tournaments.create({
        name: name.trim(),
        description: description.trim() || "Tournoi officiel compétitif Achilléa.",
        tournamentType: stageType,
        participantsNumber: capacity,
        matchFormat: matchFormat,
        organization: Number(organizationId),
        managers: [],
        seedOrdering: seedOrdering,
        groupStageEnabled: false,
        affiche: affiche.trim() || null,
        logo: logo.trim() || absoluteUrl("/achillea/achillea.png"),
        ruleset: ruleset.trim() || "Règlement officiel des tournois Inazuma Eleven: Victory Road.",
        planning: planningUrl.trim(),
        startsAt: starts,
        grandFinalAt: grandFinal,
        registrationOpensAt: regOpensAt ? new Date(regOpensAt) : null,
        registrationClosesAt: regClosesAt ? new Date(regClosesAt) : null,
        autoStart: autoStart,
        discordRoleEnabled: discordRole,
        scoreReportPolicy: scorePolicy,
        bypassRules: bypassRules,
      });

      if (res.ok) {
        const created = res.value as any;
        const id = created.id ?? created.tournament?.id;
        if (id) {
          router.push(`/achillea/tournaments/${id}`);
        } else {
          router.push("/achillea/tournaments");
        }
      } else {
        setError(res.detail || "Impossible de créer le tournoi. Droits administrateur ou organisateur requis.");
      }
    } catch {
      setError("Une erreur inattendue est survenue lors de la création.");
    } finally {
      setSubmitting(false);
    }
  };

  if (authLoading) {
    return (
      <div className="max-w-md mx-auto px-4 py-20 text-center text-sm text-muted-foreground flex flex-col items-center gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <p>Vérification de la session en cours…</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="max-w-md mx-auto px-4 py-20 text-center space-y-4">
        <ShieldAlert className="w-12 h-12 text-amber-500 mx-auto" />
        <h2 className="text-xl font-bold">Connexion requise</h2>
        <p className="text-sm text-muted-foreground">
          Vous devez être connecté avec un compte organisateur pour créer un tournoi.
        </p>
        <button
          type="button"
          onClick={() => login()}
          className="inline-flex items-center gap-2 px-6 py-2.5 bg-primary text-primary-foreground font-semibold rounded-lg hover:bg-primary/90 transition shadow-sm text-xs"
        >
          Se connecter
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
      {/* Breadcrumb & Header */}
      <div className="space-y-2 border-b border-border pb-6">
        <Link
          href="/achillea/tournaments"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Retour aux tournois
        </Link>
        <div className="flex items-center gap-3">
          <span className="p-2.5 rounded-xl bg-primary/10 text-primary border border-primary/20">
            <Trophy className="w-6 h-6" />
          </span>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Créer un Tournoi</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Assistant de configuration et planification de tournoi esport Inazuma Eleven.
            </p>
          </div>
        </div>
      </div>

      {/* Multi-step Wizard Indicator */}
      <div className="grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={() => setStep(1)}
          className={`flex items-center gap-2.5 p-3 rounded-xl border text-left transition ${
            step === 1
              ? "bg-primary/10 border-primary/40 text-primary font-bold shadow-sm"
              : step > 1
                ? "bg-muted/40 border-border text-foreground hover:bg-muted/70"
                : "bg-card border-border/60 text-muted-foreground opacity-60"
          }`}
        >
          <span
            className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center ${
              step > 1 ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
            }`}
          >
            {step > 1 ? <Check className="w-3.5 h-3.5" /> : "1"}
          </span>
          <div className="hidden sm:block">
            <div className="text-xs font-bold">Format & Capacité</div>
            <div className="text-xs text-muted-foreground">Arbre, places, podium</div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => {
            if (validateStep1()) setStep(2);
          }}
          className={`flex items-center gap-2.5 p-3 rounded-xl border text-left transition ${
            step === 2
              ? "bg-primary/10 border-primary/40 text-primary font-bold shadow-sm"
              : step > 2
                ? "bg-muted/40 border-border text-foreground hover:bg-muted/70"
                : "bg-card border-border/60 text-muted-foreground opacity-60"
          }`}
        >
          <span
            className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center ${
              step > 2 ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
            }`}
          >
            {step > 2 ? <Check className="w-3.5 h-3.5" /> : "2"}
          </span>
          <div className="hidden sm:block">
            <div className="text-xs font-bold">Planning & Matchs</div>
            <div className="text-xs text-muted-foreground">Dates, scores, automation</div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => {
            if (validateStep1() && validateStep2()) setStep(3);
          }}
          className={`flex items-center gap-2.5 p-3 rounded-xl border text-left transition ${
            step === 3
              ? "bg-primary/10 border-primary/40 text-primary font-bold shadow-sm"
              : "bg-card border-border/60 text-muted-foreground opacity-60"
          }`}
        >
          <span className="w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center bg-muted text-foreground">
            3
          </span>
          <div className="hidden sm:block">
            <div className="text-xs font-bold">Visuels & Règlement</div>
            <div className="text-xs text-muted-foreground">Affiche, logo, charte</div>
          </div>
        </button>
      </div>

      {/* Form Container */}
      <form onSubmit={handleSubmit} className="border border-border bg-card rounded-2xl p-6 md:p-8 space-y-6">
        {error && (
          <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs font-semibold flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* STEP 1: Format & Capacité */}
        {step === 1 && (
          <div className="space-y-6">
            <div className="space-y-1.5">
              <label
                htmlFor="route-create-tournament-create-client-tsx-1"
                className="text-xs font-bold text-foreground flex items-center gap-1.5"
              >
                <Trophy className="w-3.5 h-3.5 text-primary" />
                Nom du tournoi *
              </label>
              <input
                id="route-create-tournament-create-client-tsx-1"
                type="text"
                placeholder="Ex: Tournoi Astral - Saison 1"
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm bg-background border border-border rounded-xl placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                required
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="route-create-tournament-create-client-tsx-2"
                className="text-xs font-bold text-foreground flex items-center gap-1.5"
              >
                <FileText className="w-3.5 h-3.5 text-primary" />
                Description succincte
              </label>
              <textarea
                id="route-create-tournament-create-client-tsx-2"
                rows={3}
                placeholder="Présentez brièvement l'évènement, les lots et le contexte compétitif..."
                value={description}
                onChange={e => setDescription(e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm bg-background border border-border rounded-xl placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5 sm:col-span-2">
                <label
                  htmlFor="tournament-organization"
                  className="text-xs font-bold text-foreground flex items-center gap-1.5"
                >
                  <ShieldCheck className="w-3.5 h-3.5 text-primary" />
                  Organisation porteuse *
                </label>
                <select
                  id="tournament-organization"
                  value={organizationId}
                  onChange={event => setOrganizationId(event.target.value)}
                  disabled={organizationsLoading || organizations.length === 0}
                  className="w-full px-3.5 py-2.5 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
                >
                  <option value="">
                    {organizationsLoading ? "Chargement des organisations…" : "Sélectionner une organisation"}
                  </option>
                  {organizations.map(organization => (
                    <option key={String(organization.id)} value={String(organization.id)}>
                      {organization.name}
                    </option>
                  ))}
                </select>
                {!organizationsLoading && organizations.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Aucune organisation administrable n'est associée à votre compte.
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="route-create-tournament-create-client-tsx-3"
                  className="text-xs font-bold text-foreground flex items-center gap-1.5"
                >
                  <Layers className="w-3.5 h-3.5 text-primary" />
                  Type d'arbre / Format du tournoi *
                </label>
                <select
                  id="route-create-tournament-create-client-tsx-3"
                  value={stageType}
                  onChange={e => setStageType(e.target.value as StageType)}
                  className="w-full px-3.5 py-2.5 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  {STAGE_TYPE_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="route-create-tournament-create-client-tsx-4"
                  className="text-xs font-bold text-foreground flex items-center gap-1.5"
                >
                  <Sparkles className="w-3.5 h-3.5 text-primary" />
                  Format des matchs *
                </label>
                <select
                  id="route-create-tournament-create-client-tsx-4"
                  value={matchFormat}
                  onChange={e => setMatchFormat(e.target.value as MatchFormat)}
                  className="w-full px-3.5 py-2.5 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  {MATCH_FORMAT_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <p id="tournament-capacity-label" className="text-xs font-bold text-foreground flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-primary" />
                Capacité maximale de joueurs
              </p>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                {[8, 16, 32, 64, 128, 256].map(size => (
                  <button
                    key={size}
                    type="button"
                    aria-pressed={capacity === size}
                    onClick={() => setCapacity(size)}
                    className={`py-2 px-3 rounded-xl border text-center text-xs font-bold transition ${
                      capacity === size
                        ? "bg-primary text-primary-foreground border-primary shadow-sm"
                        : "bg-background border-border text-foreground hover:bg-muted"
                    }`}
                  >
                    {size} joueurs
                  </button>
                ))}
              </div>
            </div>

            {/* Podium Prize Preview */}
            {prizeTable && (
              <div className="p-4 rounded-xl bg-primary/5 border border-primary/20 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-bold text-primary">
                    <Sparkles className="w-4 h-4" />
                    Barème des récompenses podium classé (Achilléa Points)
                  </div>
                  <span className="text-xs font-mono font-bold text-primary">Capacité {capacity} joueurs</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="p-2.5 rounded-lg bg-background/80 border border-border text-center">
                    <div className="text-muted-foreground">1ère place (Vainqueur)</div>
                    <div className="text-base font-bold font-mono text-amber-400 mt-0.5">+{prizeTable.first} AP</div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-background/80 border border-border text-center">
                    <div className="text-muted-foreground">2ème place (Finaliste)</div>
                    <div className="text-base font-bold font-mono text-slate-300 mt-0.5">+{prizeTable.second} AP</div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-background/80 border border-border text-center">
                    <div className="text-muted-foreground">Demi-finalistes (Top 4)</div>
                    <div className="text-base font-bold font-mono text-amber-600 mt-0.5">+{prizeTable.semi} AP</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* STEP 2: Planning & Automatisation */}
        {step === 2 && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="route-create-tournament-create-client-tsx-5"
                  className="text-xs font-bold text-foreground flex items-center gap-1.5"
                >
                  <Calendar className="w-3.5 h-3.5 text-primary" />
                  Date et heure de coup d'envoi *
                </label>
                <input
                  id="route-create-tournament-create-client-tsx-5"
                  type="datetime-local"
                  value={startDate}
                  onChange={e => setStartDate(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-1 focus:ring-primary"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="route-create-tournament-create-client-tsx-6"
                  className="text-xs font-bold text-foreground flex items-center gap-1.5"
                >
                  <Clock className="w-3.5 h-3.5 text-primary" />
                  Grande Finale estimée
                </label>
                <input
                  id="route-create-tournament-create-client-tsx-6"
                  type="datetime-local"
                  value={grandFinalDate}
                  onChange={e => setGrandFinalDate(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>

            {/* Inscriptions programmées */}
            <div className="p-4 rounded-xl bg-background border border-border space-y-4">
              <div className="text-xs font-bold text-foreground flex items-center gap-2">
                <Bot className="w-4 h-4 text-primary" />
                Phases automatisées (facultatif)
              </div>
              <p className="text-xs text-muted-foreground">
                Sans dates renseignées, l'ouverture, la fermeture et le lancement s'effectuent manuellement par les
                organisateurs.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label
                    htmlFor="route-create-tournament-create-client-tsx-7"
                    className="text-xs text-muted-foreground"
                  >
                    Ouverture des inscriptions
                  </label>
                  <input
                    id="route-create-tournament-create-client-tsx-7"
                    type="datetime-local"
                    value={regOpensAt}
                    onChange={e => setRegOpensAt(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-card border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="route-create-tournament-create-client-tsx-8"
                    className="text-xs text-muted-foreground"
                  >
                    Fermeture + Génération de l'arbre
                  </label>
                  <input
                    id="route-create-tournament-create-client-tsx-8"
                    type="datetime-local"
                    value={regClosesAt}
                    onChange={e => setRegClosesAt(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-card border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-border/50">
                <span className="text-xs font-medium text-foreground">Démarrage automatique à l'heure H</span>
                <input
                  type="checkbox"
                  checked={autoStart}
                  onChange={e => setAutoStart(e.target.checked)}
                  className="w-4 h-4 accent-primary rounded cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-medium text-foreground">Rôle Discord automatique</div>
                  <div className="text-xs text-muted-foreground">Attribue un rôle Discord aux joueurs inscrits</div>
                </div>
                <input
                  type="checkbox"
                  checked={discordRole}
                  onChange={e => setDiscordRole(e.target.checked)}
                  className="w-4 h-4 accent-primary rounded cursor-pointer"
                />
              </div>
            </div>

            {/* Score reporting policy */}
            <div className="space-y-2">
              <p className="text-xs font-bold text-foreground flex items-center gap-1.5">
                <SlidersHorizontal className="w-3.5 h-3.5 text-primary" />
                Politique de saisie des scores de match
              </p>
              <div className="grid grid-cols-1 gap-2.5">
                {SCORE_REPORT_OPTIONS.map(opt => (
                  <label
                    aria-label={opt.label}
                    key={opt.value}
                    className={`p-3.5 rounded-xl border flex items-start gap-3 cursor-pointer transition ${
                      scorePolicy === opt.value
                        ? "bg-primary/10 border-primary/40 shadow-sm"
                        : "bg-background border-border hover:bg-muted/50"
                    }`}
                  >
                    <input
                      type="radio"
                      name="scorePolicy"
                      value={opt.value}
                      checked={scorePolicy === opt.value}
                      onChange={() => setScorePolicy(opt.value)}
                      className="mt-0.5 accent-primary cursor-pointer"
                    />
                    <div className="space-y-0.5">
                      <div className="text-xs font-bold text-foreground">{opt.label}</div>
                      <div className="text-xs text-muted-foreground leading-relaxed">{opt.description}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Seeding & Planning */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="route-create-tournament-create-client-tsx-11"
                  className="text-xs font-bold text-foreground"
                >
                  Ordre de placement (Seeding)
                </label>
                <select
                  id="route-create-tournament-create-client-tsx-11"
                  value={seedOrdering}
                  onChange={e => setSeedOrdering(e.target.value as SeedOrdering)}
                  className="w-full px-3.5 py-2.5 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  {SEED_ORDERING_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="route-create-tournament-create-client-tsx-12"
                  className="text-xs font-bold text-foreground"
                >
                  Feuille de match / Planning URL
                </label>
                <input
                  id="route-create-tournament-create-client-tsx-12"
                  type="url"
                  placeholder="https://docs.google.com/..."
                  value={planningUrl}
                  onChange={e => setPlanningUrl(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm bg-background border border-border rounded-xl placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>

            {/* SuperAdmin bypass */}
            <div className="p-3 rounded-xl bg-amber-500/5 border border-amber-500/20 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-amber-500" />
                <div>
                  <div className="text-xs font-bold text-foreground">Déroger aux règles de préavis</div>
                  <div className="text-xs text-muted-foreground">
                    Publication immédiate sans délai minimum de 7 jours (Admin)
                  </div>
                </div>
              </div>
              <input
                type="checkbox"
                checked={bypassRules}
                onChange={e => setBypassRules(e.target.checked)}
                className="w-4 h-4 accent-amber-500 rounded cursor-pointer"
              />
            </div>
          </div>
        )}

        {/* STEP 3: Visuels & Règlement */}
        {step === 3 && (
          <div className="space-y-6">
            <div className="space-y-3">
              <label
                htmlFor="route-create-tournament-create-client-tsx-13"
                className="text-xs font-bold text-foreground flex items-center gap-1.5"
              >
                <ImageIcon className="w-3.5 h-3.5 text-primary" />
                Logo du tournoi (Format carré recommandé)
              </label>
              <div className="flex items-center gap-4">
                {logo ? (
                  <img
                    src={logo}
                    alt="Aperçu logo"
                    className="w-16 h-16 rounded-xl object-cover bg-muted border border-border shadow-sm shrink-0"
                    onError={e => {
                      (e.target as HTMLElement).style.display = "none";
                    }}
                  />
                ) : (
                  <div className="w-16 h-16 rounded-xl bg-muted border border-border flex items-center justify-center text-muted-foreground text-xs shrink-0">
                    Logo
                  </div>
                )}
                <input
                  id="route-create-tournament-create-client-tsx-13"
                  type="url"
                  placeholder="https://.../logo.png"
                  value={logo}
                  onChange={e => setLogo(e.target.value)}
                  className="flex-1 px-3.5 py-2.5 text-sm bg-background border border-border rounded-xl placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>

            <div className="space-y-3">
              <label
                htmlFor="route-create-tournament-create-client-tsx-14"
                className="text-xs font-bold text-foreground flex items-center gap-1.5"
              >
                <ImageIcon className="w-3.5 h-3.5 text-primary" />
                Affiche / Bannière officielle
              </label>
              <div className="space-y-2">
                <input
                  id="route-create-tournament-create-client-tsx-14"
                  type="url"
                  placeholder="https://.../banniere.webp"
                  value={affiche}
                  onChange={e => setAffiche(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm bg-background border border-border rounded-xl placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
                {affiche && (
                  <div className="rounded-xl overflow-hidden border border-border max-h-48 bg-muted">
                    <img
                      src={affiche}
                      alt="Aperçu affiche"
                      className="w-full h-48 object-cover"
                      onError={e => {
                        (e.target as HTMLElement).style.display = "none";
                      }}
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="route-create-tournament-create-client-tsx-15"
                className="text-xs font-bold text-foreground flex items-center gap-1.5"
              >
                <FileText className="w-3.5 h-3.5 text-primary" />
                Règlement complet du tournoi
              </label>
              <textarea
                id="route-create-tournament-create-client-tsx-15"
                rows={6}
                placeholder="Spécifiez les restrictions d'équipes, cartes bannies, déroulement des contestations..."
                value={ruleset}
                onChange={e => setRuleset(e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm bg-background border border-border rounded-xl placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary font-mono text-xs"
              />
            </div>
          </div>
        )}

        {/* Wizard Controls */}
        <div className="pt-4 border-t border-border flex items-center justify-between gap-3">
          <div>
            {step > 1 ? (
              <button
                type="button"
                onClick={goToPrevStep}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-xl border border-border bg-background hover:bg-muted transition"
              >
                <ChevronLeft className="w-4 h-4" />
                Précédent
              </button>
            ) : (
              <Link
                href="/achillea/tournaments"
                className="px-4 py-2 text-xs font-semibold rounded-xl border border-border bg-background hover:bg-muted transition inline-block"
              >
                Annuler
              </Link>
            )}
          </div>

          <div>
            {step < 3 ? (
              <button
                type="button"
                onClick={goToNextStep}
                className="inline-flex items-center gap-1.5 px-6 py-2.5 bg-primary text-primary-foreground font-bold text-xs rounded-xl hover:bg-primary/90 transition shadow-sm"
              >
                Suivant
                <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center gap-2 px-6 py-2.5 bg-primary text-primary-foreground font-bold text-xs rounded-xl hover:bg-primary/90 transition shadow-sm disabled:opacity-50"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Créer et publier le tournoi
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
