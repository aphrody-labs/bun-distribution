"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAchilleaAuth, createAchilleaClient } from "@/lib/achillea";
import { signalerEchec, signalerException } from "@/lib/achillea/signaler";
import type {
  AdminOpsOverview,
  AdminUserRow,
  AdminWalletRow,
  AdminTransactionRow,
} from "@rosegriffon/achillea-types/domain/admin";
import type {
  RankedAdminDispute,
  RankedAdminSeason,
} from "@rosegriffon/achillea-types/domain/ranked";
import type { Sanction } from "@rosegriffon/achillea-types/domain/sanction";
import { UserAvatar } from "@/components/achillea/UserAvatar";
import { PlayerNotesPanel } from "@/components/achillea/PlayerNotesPanel";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Button,
  Badge,
  Skeleton,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@rosegriffon/ui";
import {
  LayoutDashboard,
  Gavel,
  Calendar,
  Users,
  ShieldAlert,
  MessageSquare,
  Wallet,
  Server,
  RefreshCw,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ExternalLink,
  ShieldCheck,
  ArrowRight,
  Search,
  ChevronLeft,
  ChevronRight,
  Plus,
  Play,
  RotateCcw,
  Power,
} from "lucide-react";

type AdminTab =
  | "overview"
  | "disputes"
  | "seasons"
  | "sanctions"
  | "notes"
  | "users"
  | "wallets"
  | "bot";

/**
 * Met en forme une durée de fonctionnement.
 *
 * L'API rend des secondes. Les afficher brutes (« 384210 ») n'apprend rien à
 * qui surveille un service ; « 4 j 10 h » se lit d'un coup d'œil.
 */
function formaterDuree(secondes: number): string {
  if (!Number.isFinite(secondes) || secondes < 0) return "—";
  const jours = Math.floor(secondes / 86_400);
  const heures = Math.floor((secondes % 86_400) / 3_600);
  const minutes = Math.floor((secondes % 3_600) / 60);
  if (jours > 0) return `${jours} j ${heures} h`;
  if (heures > 0) return `${heures} h ${minutes} min`;
  return `${minutes} min`;
}

export default function AchilleaAdminDashboardPage() {
  const { user, isAuthenticated, isLoading: authLoading } = useAchilleaAuth();
  const [activeTab, setActiveTab] = useState<AdminTab>("overview");

  const [ops, setOps] = useState<AdminOpsOverview | null>(null);
  const [opsError, setOpsError] = useState<string | null>(null);
  const [disputes, setDisputes] = useState<RankedAdminDispute[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  // Users tab state
  const [usersList, setUsersList] = useState<AdminUserRow[]>([]);
  const [usersPage, setUsersPage] = useState(1);
  const [userQuery, setUserQuery] = useState("");
  const [usersTotal, setUsersTotal] = useState(0);
  const [usersLoading, setUsersLoading] = useState(false);
  const [selectedUserForRole, setSelectedUserForRole] = useState<AdminUserRow | null>(null);
  const [newRole, setNewRole] = useState<number>(0);
  const [roleModalOpen, setRoleModalOpen] = useState(false);
  const [updatingRole, setUpdatingRole] = useState(false);

  // Wallets tab state
  const [walletsLoading, setWalletsLoading] = useState(false);
  const [topWallets, setTopWallets] = useState<AdminWalletRow[]>([]);
  const [recentTransactions, setRecentTransactions] = useState<AdminTransactionRow[]>([]);
  const [adjustWalletOpen, setAdjustWalletOpen] = useState(false);
  const [adjustUserId, setAdjustUserId] = useState("");
  const [adjustAmount, setAdjustAmount] = useState(100);
  const [adjustReason, setAdjustReason] = useState("");
  const [adjusting, setAdjusting] = useState(false);

  // Seasons tab state
  const [seasonsLoading, setSeasonsLoading] = useState(false);
  const [seasons, setSeasons] = useState<RankedAdminSeason[]>([]);
  const [activatingSeasonId, setActivatingSeasonId] = useState<string | null>(null);
  const [resettingSeasonId, setResettingSeasonId] = useState<string | null>(null);

  // Sanctions tab state
  const [sanctionsLoading, setSanctionsLoading] = useState(false);
  const [sanctionsList, setSanctionsList] = useState<Sanction[]>([]);
  const [revokingSanctionId, setRevokingSanctionId] = useState<string | null>(null);

  // Bot maintenance state
  const [togglingMaintenance, setTogglingMaintenance] = useState(false);

  const client = createAchilleaClient({ credentials: "include" });

  const loadData = () => {
    return Promise.all([client.admin.overview(), client.ranked.adminDisputes()])
      .then(([opsRes, dispRes]) => {
        if (opsRes.ok && opsRes.value) {
          setOps(opsRes.value);
          setOpsError(null);
        } else {
          setOpsError(signalerEchec("admin/ops/overview", opsRes));
        }
        if (dispRes.ok && dispRes.value) {
          setDisputes(dispRes.value);
        } else {
          signalerEchec("admin/lobbies/disputes", dispRes);
        }
      })
      .catch((cause) => {
        setOpsError(signalerException("admin/dashboard", cause));
      })
      .finally(() => {
        setRefreshing(false);
      });
  };

  const loadUsers = (page = usersPage, q = userQuery) => {
    return client.admin
      .users({ page, pagination: 15, q: q.trim() || undefined })
      .then((res) => {
        if (res.ok && res.value) {
          setUsersList(res.value.data);
          setUsersTotal(res.value.meta.total);
        }
      })
      .catch(() => {
        // silent fallback
      })
      .finally(() => {
        setUsersLoading(false);
      });
  };

  const loadWallets = () => {
    return client.admin
      .wallets(20)
      .then((res) => {
        if (res.ok && res.value) {
          setTopWallets(res.value.top);
          setRecentTransactions(res.value.recent);
        }
      })
      .catch(() => {
        // silent fallback
      })
      .finally(() => {
        setWalletsLoading(false);
      });
  };

  const loadSeasons = () => {
    return client.ranked
      .adminSeasons()
      .then((res) => {
        if (res.ok && res.value) {
          setSeasons(res.value);
        }
      })
      .catch(() => {
        // silent fallback
      })
      .finally(() => {
        setSeasonsLoading(false);
      });
  };

  const loadSanctions = () => {
    return client.sanctions
      .list({ pageSize: 30 })
      .then((res) => {
        if (res.ok && res.value) {
          setSanctionsList(res.value.data);
        }
      })
      .catch(() => {
        // silent fallback
      })
      .finally(() => {
        setSanctionsLoading(false);
      });
  };

  const handleSaveRole = async () => {
    if (!selectedUserForRole) return;
    setUpdatingRole(true);
    try {
      const res = await client.admin.setUserRole(selectedUserForRole.id, newRole);
      if (res.ok) {
        setUsersList((prev) =>
          prev.map((u) => (u.id === selectedUserForRole.id ? { ...u, role: newRole } : u)),
        );
        setRoleModalOpen(false);
        setSelectedUserForRole(null);
      }
    } finally {
      setUpdatingRole(false);
    }
  };

  const handleAdjustWalletSubmit = async () => {
    if (!adjustUserId.trim() || adjustAmount === 0) return;
    setAdjusting(true);
    try {
      const res = await client.admin.adjustWallet(
        adjustUserId.trim(),
        adjustAmount,
        adjustReason.trim() || undefined,
      );
      if (res.ok) {
        setAdjustWalletOpen(false);
        setAdjustUserId("");
        setAdjustAmount(100);
        setAdjustReason("");
        void loadWallets();
      }
    } finally {
      setAdjusting(false);
    }
  };

  const handleActivateSeason = async (seasonId: string) => {
    setActivatingSeasonId(seasonId);
    try {
      const res = await client.ranked.adminActivateSeason(seasonId);
      if (res.ok) {
        void loadSeasons();
      }
    } finally {
      setActivatingSeasonId(null);
    }
  };

  const handleResetLadder = async (seasonId: string) => {
    if (!confirm("Confirmer la réinitialisation du classement ranked pour cette saison ?")) return;
    setResettingSeasonId(seasonId);
    try {
      const res = await client.ranked.adminResetLadder(seasonId);
      if (res.ok) {
        void loadSeasons();
      }
    } finally {
      setResettingSeasonId(null);
    }
  };

  const handleRevokeSanction = async (sanctionId: string) => {
    if (!confirm("Confirmer la levée immédiate de cette sanction ?")) return;
    setRevokingSanctionId(sanctionId);
    try {
      const res = await client.sanctions.revoke(
        sanctionId,
        "Levée par un administrateur depuis le dashboard",
      );
      if (res.ok) {
        setSanctionsList((prev) => prev.filter((s) => s.id !== sanctionId));
      }
    } finally {
      setRevokingSanctionId(null);
    }
  };

  const handleToggleMaintenance = async () => {
    if (!ops?.bot) return;
    const nextState = !ops.bot.maintenance;
    if (
      !confirm(
        nextState
          ? "Activer le mode maintenance ? L'accès joueur sera temporairement verrouillé."
          : "Désactiver le mode maintenance et rouvrir les accès ?",
      )
    ) {
      return;
    }
    setTogglingMaintenance(true);
    try {
      const res = await client.admin.setMaintenance(nextState);
      if (res.ok) {
        setOps((prev) =>
          prev
            ? {
                ...prev,
                bot: prev.bot ? { ...prev.bot, maintenance: nextState } : undefined,
              }
            : null,
        );
      }
    } finally {
      setTogglingMaintenance(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      void loadData();
    }
  }, [isAuthenticated]);

  const [tabRequest, setTabRequest] = useState({ activeTab, isAuthenticated });
  if (tabRequest.activeTab !== activeTab || tabRequest.isAuthenticated !== isAuthenticated) {
    setTabRequest({ activeTab, isAuthenticated });
    if (isAuthenticated) {
      if (activeTab === "users" && usersList.length === 0) setUsersLoading(true);
      if (activeTab === "wallets" && topWallets.length === 0) setWalletsLoading(true);
      if (activeTab === "seasons" && seasons.length === 0) setSeasonsLoading(true);
      if (activeTab === "sanctions" && sanctionsList.length === 0) setSanctionsLoading(true);
    }
  }
  useEffect(() => {
    if (!isAuthenticated) return;
    if (activeTab === "users" && usersList.length === 0) void loadUsers();
    if (activeTab === "wallets" && topWallets.length === 0) void loadWallets();
    if (activeTab === "seasons" && seasons.length === 0) void loadSeasons();
    if (activeTab === "sanctions" && sanctionsList.length === 0) void loadSanctions();
  }, [activeTab, isAuthenticated]);

  // Garde d'accès (Modérateur+)
  if (authLoading) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-12 space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
        </div>
      </div>
    );
  }

  if (!isAuthenticated || (user?.role ?? 0) < 1) {
    return (
      <div className="max-w-md mx-auto px-4 py-20 text-center space-y-4">
        <div className="size-16 rounded-full bg-destructive/10 text-destructive flex items-center justify-center mx-auto">
          <ShieldAlert className="size-8" />
        </div>
        <h1 className="text-2xl font-bold">Accès Administrateur Restreint</h1>
        <p className="text-sm text-muted-foreground">
          Ce tableau de bord est réservé aux modérateurs et administrateurs d&apos;Achilléa.
        </p>
        <Link href="/achillea">
          <Button variant="outline" className="mt-4">
            Retour à l&apos;accueil
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">
      {/* En-tête avec raccourci vers l'admin global Rose Griffon */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/60 pb-6">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <span className="p-2 rounded-lg bg-primary/10 text-primary border border-primary/20">
              <LayoutDashboard className="size-5" />
            </span>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              Achilléa Backoffice
            </h1>
            <Badge variant="outline" className="border-primary/40 text-primary text-xs">
              {user?.role && user.role >= 3
                ? "Super-Admin"
                : user?.role && user.role >= 2
                  ? "Admin"
                  : "Modérateur"}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Supervision des compétitions, arbitrage des litiges, économie ACH et modération.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/admin"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border/80 bg-muted/40 hover:bg-muted text-xs font-semibold transition"
            title="Administration centrale Rose Griffon (Portail & Wiki)"
          >
            <span>Admin Portail RG</span>
            <ExternalLink className="size-3 text-muted-foreground" />
          </Link>

          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setRefreshing(true);
              void loadData();
            }}
            disabled={refreshing}
            className="gap-2 text-xs"
          >
            <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Actualiser
          </Button>
        </div>
      </div>

      {opsError && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {opsError} Les derniers indicateurs chargés restent affichés.
        </p>
      )}

      {/* Navigation par Onglets */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 pb-3">
        <Button
          variant={activeTab === "overview" ? "default" : "ghost"}
          size="sm"
          onClick={() => setActiveTab("overview")}
          className="gap-2 text-xs"
        >
          <LayoutDashboard className="size-3.5" />
          Vue d&apos;ensemble
        </Button>

        <Button
          variant={activeTab === "disputes" ? "default" : "ghost"}
          size="sm"
          onClick={() => setActiveTab("disputes")}
          className="gap-2 text-xs relative"
        >
          <Gavel className="size-3.5" />
          Litiges Ranked
          {disputes.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-xs bg-rose-500 text-white font-bold">
              {disputes.length}
            </span>
          )}
        </Button>

        <Button
          variant={activeTab === "sanctions" ? "default" : "ghost"}
          size="sm"
          onClick={() => setActiveTab("sanctions")}
          className="gap-2 text-xs"
        >
          <ShieldAlert className="size-3.5" />
          Sanctions
        </Button>

        <Button
          variant={activeTab === "notes" ? "default" : "ghost"}
          size="sm"
          onClick={() => setActiveTab("notes")}
          className="gap-2 text-xs"
        >
          <MessageSquare className="size-3.5" />
          Signalements
        </Button>

        <Button
          variant={activeTab === "seasons" ? "default" : "ghost"}
          size="sm"
          onClick={() => setActiveTab("seasons")}
          className="gap-2 text-xs"
        >
          <Calendar className="size-3.5" />
          Saisons Ranked
        </Button>

        <Button
          variant={activeTab === "users" ? "default" : "ghost"}
          size="sm"
          onClick={() => setActiveTab("users")}
          className="gap-2 text-xs"
        >
          <Users className="size-3.5" />
          Utilisateurs & Staff
        </Button>

        <Button
          variant={activeTab === "wallets" ? "default" : "ghost"}
          size="sm"
          onClick={() => setActiveTab("wallets")}
          className="gap-2 text-xs"
        >
          <Wallet className="size-3.5" />
          Portefeuilles ACH
        </Button>

        <Button
          variant={activeTab === "bot" ? "default" : "ghost"}
          size="sm"
          onClick={() => setActiveTab("bot")}
          className="gap-2 text-xs"
        >
          <Server className="size-3.5" />
          Santé Bot & API
        </Button>
      </div>

      {/* CONTENU ONGLET: VUE D'ENSEMBLE */}
      {activeTab === "overview" && (
        <div className="space-y-6">
          {/* KPIs Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            <Card className="bg-card/50 border-border/60">
              <CardContent className="p-4 space-y-1">
                <div className="text-xs text-muted-foreground">Membres inscrits</div>
                <div className="text-2xl font-bold">{ops?.users?.total ?? "—"}</div>
                <div className="text-xs text-muted-foreground">
                  {ops?.users?.staff ?? "—"} staff
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card/50 border-border/60">
              <CardContent className="p-4 space-y-1">
                <div className="text-xs text-muted-foreground">Litiges ouverts</div>
                <div
                  className={`text-2xl font-bold ${
                    (ops?.ranked?.contestedMatches ?? 0) > 0 ? "text-rose-400" : "text-emerald-400"
                  }`}
                >
                  {ops?.ranked?.contestedMatches ?? disputes.length}
                </div>
                <div className="text-xs text-muted-foreground">À trancher</div>
              </CardContent>
            </Card>

            <Card className="bg-card/50 border-border/60">
              <CardContent className="p-4 space-y-1">
                <div className="text-xs text-muted-foreground">Matchs en cours</div>
                <div className="text-2xl font-bold text-amber-400">
                  {ops?.ranked?.activeMatches ?? "—"}
                </div>
                <div className="text-xs text-muted-foreground">Lobbies actifs</div>
              </CardContent>
            </Card>

            <Card className="bg-card/50 border-border/60">
              <CardContent className="p-4 space-y-1">
                <div className="text-xs text-muted-foreground">Clans en attente</div>
                <div className="text-2xl font-bold">{ops?.community?.clansPending ?? "—"}</div>
                <div className="text-xs text-muted-foreground">Validation fondateurs</div>
              </CardContent>
            </Card>

            <Card className="bg-card/50 border-border/60">
              <CardContent className="p-4 space-y-1">
                <div className="text-xs text-muted-foreground">Organisations</div>
                <div className="text-2xl font-bold">{ops?.community?.orgsPending ?? "—"}</div>
                <div className="text-xs text-muted-foreground">
                  <Link
                    href="/achillea/organizations/validate"
                    className="text-primary hover:underline"
                  >
                    Voir validation
                  </Link>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card/50 border-border/60">
              <CardContent className="p-4 space-y-1">
                <div className="text-xs text-muted-foreground">Bot Uptime</div>
                <div className="text-2xl font-bold font-mono">
                  {typeof ops?.bot?.uptime === "number" ? formaterDuree(ops.bot.uptime) : "—"}
                </div>
                <div className="text-xs text-emerald-400">
                  {ops?.bot ? (ops.bot.online ? "En ligne" : "Inactif") : "Non mesuré"}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Raccourcis d'actions rapides */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-2">
            <Card className="border-border/60">
              <CardHeader className="p-5 pb-2">
                <CardTitle className="text-base flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Gavel className="size-4 text-primary" />
                    Arbitrage Ranked
                  </span>
                  <Link href="/achillea/admins/ranked-disputes">
                    <Button variant="ghost" size="sm" className="size-7 p-0">
                      <ArrowRight className="size-4" />
                    </Button>
                  </Link>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-5 pt-2 text-xs text-muted-foreground space-y-3">
                <p>
                  Visualise les captures d&apos;écran déposées par les joueurs en litige et attribue
                  la victoire ou annule le lobby sans perte de points.
                </p>
                <Link href="/achillea/admins/ranked-disputes" className="block">
                  <Button variant="outline" size="sm" className="w-full text-xs gap-1.5">
                    Ouvrir la salle des litiges
                  </Button>
                </Link>
              </CardContent>
            </Card>

            <Card className="border-border/60">
              <CardHeader className="p-5 pb-2">
                <CardTitle className="text-base flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <ShieldAlert className="size-4 text-rose-500" />
                    Sanctions & Exclusions
                  </span>
                  <Link href="/achillea/admins/sanctions">
                    <Button variant="ghost" size="sm" className="size-7 p-0">
                      <ArrowRight className="size-4" />
                    </Button>
                  </Link>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-5 pt-2 text-xs text-muted-foreground space-y-3">
                <p>
                  Gère les avertissements, exclusions temporaires de ranked et bannissements
                  définitifs des joueurs pour infraction aux règles.
                </p>
                <Link href="/achillea/admins/sanctions" className="block">
                  <Button variant="outline" size="sm" className="w-full text-xs gap-1.5">
                    Gérer les sanctions actives
                  </Button>
                </Link>
              </CardContent>
            </Card>

            <Card className="border-border/60">
              <CardHeader className="p-5 pb-2">
                <CardTitle className="text-base flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <ShieldCheck className="size-4 text-amber-500" />
                    Organisations en Attente
                  </span>
                  <Link href="/achillea/organizations/validate">
                    <Button variant="ghost" size="sm" className="size-7 p-0">
                      <ArrowRight className="size-4" />
                    </Button>
                  </Link>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-5 pt-2 text-xs text-muted-foreground space-y-3">
                <p>
                  Examine les demandes d&apos;agrément des associations, clans et collectifs tiers
                  souhaitant organiser des tournois officiels.
                </p>
                <Link href="/achillea/organizations/validate" className="block">
                  <Button variant="outline" size="sm" className="w-full text-xs gap-1.5">
                    Examiner les demandes ({ops?.community?.orgsPending ?? 0})
                  </Button>
                </Link>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* CONTENU ONGLET: LITIGES */}
      {activeTab === "disputes" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">Litiges de Matchs Classés</h2>
            <Link href="/achillea/admins/ranked-disputes">
              <Button variant="outline" size="sm" className="gap-1.5 text-xs">
                Vue plein écran dédiée
                <ExternalLink className="size-3.5" />
              </Button>
            </Link>
          </div>

          {disputes.length === 0 ? (
            <div className="p-12 text-center border border-border/60 rounded-xl bg-card/40 space-y-2">
              <CheckCircle2 className="size-8 text-emerald-400 mx-auto" />
              <div className="font-semibold text-sm">Aucun litige en cours</div>
              <p className="text-xs text-muted-foreground">
                Tous les scores de matchs classés ont été confirmés ou arbitrés.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border/60 border border-border/60 rounded-xl bg-card/40 overflow-hidden">
              {disputes.map((d) => (
                <div key={d.lobbyId} className="p-4 flex items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-rose-400 border-rose-500/30">
                        Litige #{d.lobbyId}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        Lobby {d.lobbyId} · Signalé le{" "}
                        {new Date(d.createdAt).toLocaleDateString("fr-FR")}
                      </span>
                    </div>
                    <p className="text-sm font-medium">
                      {d.player1?.displayName ?? "Joueur 1"} vs{" "}
                      {d.player2?.displayName ?? "Joueur 2"} — Score contesté
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <Link href="/achillea/admins/ranked-disputes">
                      <Button size="sm" variant="default" className="text-xs gap-1">
                        Arbitrer
                        <ArrowRight className="size-3" />
                      </Button>
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* CONTENU ONGLET: SANCTIONS */}
      {activeTab === "sanctions" && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold">Modération & Registre des Sanctions</h2>
              <p className="text-xs text-muted-foreground">
                Consigne centrale des exclusions temporaires, mutes et bannissements du réseau.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSanctionsLoading(true);
                  void loadSanctions();
                }}
                disabled={sanctionsLoading}
                className="text-xs gap-1.5"
              >
                <RefreshCw className={`size-3.5 ${sanctionsLoading ? "animate-spin" : ""}`} />
                Actualiser
              </Button>
              <Link href="/achillea/admins/sanctions">
                <Button variant="default" size="sm" className="gap-1.5 text-xs">
                  Console avancée
                  <ExternalLink className="size-3.5" />
                </Button>
              </Link>
            </div>
          </div>

          {sanctionsList.length === 0 ? (
            <div className="p-12 text-center border border-border/60 rounded-xl bg-card/40 space-y-2">
              <ShieldAlert className="size-8 text-muted-foreground mx-auto" />
              <div className="font-semibold text-sm">Aucune sanction enregistrée</div>
              <p className="text-xs text-muted-foreground">
                Le casier disciplinaire des joueurs est vierge.
              </p>
            </div>
          ) : (
            <div className="border border-border/60 rounded-xl bg-card/40 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-border/60 bg-muted/30 text-muted-foreground">
                    <th className="p-3 font-semibold">Joueur (ID)</th>
                    <th className="p-3 font-semibold">Type</th>
                    <th className="p-3 font-semibold">Motif</th>
                    <th className="p-3 font-semibold">Date d&apos;émission</th>
                    <th className="p-3 font-semibold">Expiration</th>
                    <th className="p-3 font-semibold text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {sanctionsList.map((s) => (
                    <tr key={s.id} className="hover:bg-muted/20 transition-colors">
                      <td className="p-3 font-mono text-xs">{s.userId}</td>
                      <td className="p-3">
                        <Badge
                          variant={
                            s.type === "ban" || s.type === "kick"
                              ? "destructive"
                              : s.type === "warn"
                                ? "outline"
                                : "secondary"
                          }
                          className="text-xs font-bold uppercase"
                        >
                          {s.type}
                        </Badge>
                      </td>
                      <td className="p-3 max-w-xs truncate" title={s.reason ?? "Sans motif"}>
                        {s.reason ?? "Sans motif spécifié"}
                      </td>
                      <td className="p-3 text-muted-foreground">
                        {new Date(s.createdAt).toLocaleDateString("fr-FR")}
                      </td>
                      <td className="p-3 text-muted-foreground">
                        {s.expiresAt
                          ? new Date(s.expiresAt).toLocaleDateString("fr-FR")
                          : "Permanent"}
                      </td>
                      <td className="p-3 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRevokeSanction(s.id)}
                          disabled={revokingSanctionId === s.id}
                          className="text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 h-7 px-2"
                        >
                          {revokingSanctionId === s.id ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            "Lever"
                          )}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* CONTENU ONGLET: SIGNALEMENTS & NOTES STAFF */}
      {activeTab === "notes" && <PlayerNotesPanel title="Registre global des signalements staff" />}

      {/* CONTENU ONGLET: SAISONS */}
      {activeTab === "seasons" && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold">Saisons du Ladder Ranked</h2>
              <p className="text-xs text-muted-foreground">
                Gestion des cycles de compétition, du calibrage ELO et des réinitialisations de
                points.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSeasonsLoading(true);
                void loadSeasons();
              }}
              disabled={seasonsLoading}
              className="text-xs gap-1.5 self-start"
            >
              <RefreshCw className={`size-3.5 ${seasonsLoading ? "animate-spin" : ""}`} />
              Actualiser
            </Button>
          </div>

          {seasons.length === 0 ? (
            <div className="p-12 text-center border border-border/60 rounded-xl bg-card/40 space-y-2">
              <Calendar className="size-8 text-primary mx-auto" />
              <div className="font-semibold text-sm">Aucune saison configurée</div>
              <p className="text-xs text-muted-foreground">
                Les données du classement officiel sont actuellement non segmentées.
              </p>
            </div>
          ) : (
            <div className="grid gap-4">
              {seasons.map((season) => (
                <Card key={season.id} className="border-border/60 bg-card/40">
                  <CardContent className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="space-y-1.5 min-w-0">
                      <div className="flex items-center gap-2.5">
                        <h3 className="font-bold text-base">{season.name}</h3>
                        <Badge
                          variant={season.state === "Active" ? "default" : "outline"}
                          className="text-xs font-semibold"
                        >
                          {season.state === "Active"
                            ? "En cours"
                            : season.state === "Upcoming"
                              ? "À venir"
                              : "Clôturée"}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                        <span>Début : {new Date(season.startsAt).toLocaleDateString("fr-FR")}</span>
                        {season.endsAt && (
                          <span>Fin : {new Date(season.endsAt).toLocaleDateString("fr-FR")}</span>
                        )}
                        <span>
                          Note de base : <strong>{season.config?.baseRating ?? 1000} ELO</strong>
                        </span>
                        <span>
                          Facteur K : <strong>{season.config?.kFactor ?? 32}</strong>
                        </span>
                        <span>
                          Participants : <strong>{season.playerCount ?? 0}</strong>
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {season.state !== "Active" && (
                        <Button
                          size="sm"
                          variant="default"
                          onClick={() => handleActivateSeason(season.id)}
                          disabled={activatingSeasonId === season.id}
                          className="text-xs gap-1.5"
                        >
                          {activatingSeasonId === season.id ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <Play className="size-3.5" />
                          )}
                          Activer la saison
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleResetLadder(season.id)}
                        disabled={resettingSeasonId === season.id}
                        className="text-xs gap-1.5 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
                      >
                        {resettingSeasonId === season.id ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <RotateCcw className="size-3.5" />
                        )}
                        Reset ELO
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* CONTENU ONGLET: UTILISATEURS */}
      {activeTab === "users" && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold">Gestion des Utilisateurs & Rôles</h2>
              <p className="text-xs text-muted-foreground">
                Recherche de comptes, vérification des accès et attribution des privilèges Staff.
              </p>
            </div>
          </div>

          {/* Barre de recherche et pagination */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setUsersPage(1);
                void loadUsers(1, userQuery);
              }}
              className="flex items-center gap-2 w-full sm:w-80"
            >
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Pseudo Discord ou ID..."
                  value={userQuery}
                  onChange={(e) => setUserQuery(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-border/60 bg-muted/20 focus:outline-none focus:border-primary"
                />
              </div>
              <Button type="submit" size="sm" variant="secondary" className="text-xs">
                Filtrer
              </Button>
            </form>

            <div className="flex items-center gap-2 text-xs text-muted-foreground self-end sm:self-auto">
              <span>{usersTotal} comptes</span>
              <Button
                variant="outline"
                size="sm"
                className="size-7 p-0"
                disabled={usersPage <= 1 || usersLoading}
                onClick={() => {
                  const p = usersPage - 1;
                  setUsersPage(p);
                  void loadUsers(p);
                }}
              >
                <ChevronLeft className="size-3.5" />
              </Button>
              <span className="font-mono text-xs">Page {usersPage}</span>
              <Button
                variant="outline"
                size="sm"
                className="size-7 p-0"
                disabled={usersList.length < 15 || usersLoading}
                onClick={() => {
                  const p = usersPage + 1;
                  setUsersPage(p);
                  void loadUsers(p);
                }}
              >
                <ChevronRight className="size-3.5" />
              </Button>
            </div>
          </div>

          {usersLoading ? (
            <div className="p-8 text-center text-xs text-muted-foreground">
              <Loader2 className="size-6 animate-spin mx-auto mb-2 text-primary" />
              Chargement des utilisateurs…
            </div>
          ) : usersList.length === 0 ? (
            <div className="p-12 text-center border border-border/60 rounded-xl bg-card/40 space-y-2">
              <Users className="size-8 text-muted-foreground mx-auto" />
              <div className="font-semibold text-sm">Aucun utilisateur trouvé</div>
              <p className="text-xs text-muted-foreground">
                Essaie une autre recherche par pseudo ou identifiant.
              </p>
            </div>
          ) : (
            <div className="border border-border/60 rounded-xl bg-card/40 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-border/60 bg-muted/30 text-muted-foreground">
                    <th className="p-3 font-semibold">Utilisateur</th>
                    <th className="p-3 font-semibold">ID Système</th>
                    <th className="p-3 font-semibold">Rôle</th>
                    <th className="p-3 font-semibold">Dernière activité</th>
                    <th className="p-3 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {usersList.map((u) => (
                    <tr key={u.id} className="hover:bg-muted/20 transition-colors">
                      <td className="p-3">
                        <div className="flex items-center gap-2.5">
                          <UserAvatar
                            userId={u.id}
                            avatar={u.avatar}
                            name={u.username ?? "Utilisateur"}
                            size="sm"
                          />
                          <div className="min-w-0">
                            <Link
                              href={`/achillea/users/${u.id}`}
                              className="font-bold hover:text-primary transition-colors truncate block"
                            >
                              {u.displayName || u.username || "Sans pseudo"}
                            </Link>
                            {u.username && u.displayName && (
                              <span className="text-xs text-muted-foreground block truncate">
                                @{u.username}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="p-3 font-mono text-xs text-muted-foreground">{u.id}</td>
                      <td className="p-3">
                        <Badge
                          variant={
                            u.role >= 3
                              ? "destructive"
                              : u.role >= 2
                                ? "default"
                                : u.role >= 1
                                  ? "secondary"
                                  : "outline"
                          }
                          className="text-xs font-semibold"
                        >
                          {u.role >= 3
                            ? "Super-Admin"
                            : u.role >= 2
                              ? "Admin"
                              : u.role >= 1
                                ? "Modérateur"
                                : "Membre"}
                        </Badge>
                      </td>
                      <td className="p-3 text-muted-foreground">
                        {u.lastInteract
                          ? new Date(u.lastInteract).toLocaleDateString("fr-FR")
                          : "—"}
                      </td>
                      <td className="p-3 text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSelectedUserForRole(u);
                            setNewRole(u.role);
                            setRoleModalOpen(true);
                          }}
                          className="text-xs h-7 px-2.5"
                        >
                          Modifier le rôle
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* CONTENU ONGLET: PORTEFEUILLES */}
      {activeTab === "wallets" && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold">Économie & Portefeuilles ACH</h2>
              <p className="text-xs text-muted-foreground">
                Surveillance des jetons en circulation et attribution manuelle de primes.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="default"
                size="sm"
                onClick={() => {
                  setAdjustUserId("");
                  setAdjustAmount(100);
                  setAdjustReason("");
                  setAdjustWalletOpen(true);
                }}
                className="text-xs gap-1.5"
              >
                <Plus className="size-3.5" />
                Ajuster un solde
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setWalletsLoading(true);
                  void loadWallets();
                }}
                disabled={walletsLoading}
                className="text-xs gap-1.5"
              >
                <RefreshCw className={`size-3.5 ${walletsLoading ? "animate-spin" : ""}`} />
                Actualiser
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Top soldes */}
            <Card className="border-border/60 bg-card/40">
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <Wallet className="size-4 text-amber-500" />
                  Principaux Portefeuilles ACH
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-2">
                {topWallets.length === 0 ? (
                  <div className="py-6 text-center text-xs text-muted-foreground">
                    Aucun solde actif
                  </div>
                ) : (
                  <div className="divide-y divide-border/40">
                    {topWallets.map((w) => (
                      <div
                        key={w.userId}
                        className="py-2.5 flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="font-semibold text-xs truncate">
                            {w.displayName || w.userId}
                          </div>
                          <div className="font-mono text-xs text-muted-foreground truncate">
                            {w.userId}
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="font-extrabold text-sm text-amber-400">
                            {w.balance.toLocaleString("fr-FR")} {w.currency}
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-xs h-6 px-2"
                            onClick={() => {
                              setAdjustUserId(w.userId);
                              setAdjustAmount(50);
                              setAdjustReason("Prime manuelle");
                              setAdjustWalletOpen(true);
                            }}
                          >
                            Créditer
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Transactions récentes */}
            <Card className="border-border/60 bg-card/40">
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <Calendar className="size-4 text-primary" />
                  Dernières Transactions
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-2">
                {recentTransactions.length === 0 ? (
                  <div className="py-6 text-center text-xs text-muted-foreground">
                    Aucun mouvement récent
                  </div>
                ) : (
                  <div className="divide-y divide-border/40 max-h-96 overflow-y-auto">
                    {recentTransactions.map((tx) => (
                      <div key={tx.id} className="py-2.5 space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold uppercase tracking-wider text-muted-foreground">
                            {tx.type}
                          </span>
                          <span
                            className={`font-bold ${
                              tx.amount >= 0 ? "text-emerald-400" : "text-rose-400"
                            }`}
                          >
                            {tx.amount >= 0 ? `+${tx.amount}` : tx.amount} ACH
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span className="truncate max-w-[200px]" title={tx.reason ?? ""}>
                            {tx.reason ?? "Transaction sans motif"}
                          </span>
                          <span>{new Date(tx.createdAt).toLocaleDateString("fr-FR")}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* CONTENU ONGLET: BOT & API */}
      {activeTab === "bot" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">Statut de l&apos;Infrastructure</h2>
            <Button
              variant={ops?.bot?.maintenance ? "destructive" : "outline"}
              size="sm"
              onClick={handleToggleMaintenance}
              disabled={togglingMaintenance || !ops?.bot}
              className="text-xs gap-1.5"
            >
              <Power className="size-3.5" />
              {ops?.bot?.maintenance ? "Désactiver la maintenance" : "Passer en maintenance"}
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="border-border/60 bg-card/40">
              <CardHeader className="p-5 pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Server className="size-4 text-emerald-400" />
                  API Achilléa & Base de Données
                </CardTitle>
              </CardHeader>
              <CardContent className="p-5 pt-2 text-xs space-y-2">
                <div className="flex justify-between py-1 border-b border-border/40">
                  <span className="text-muted-foreground">Statut API</span>
                  {ops ? (
                    <span className="text-emerald-400 font-semibold flex items-center gap-1">
                      <CheckCircle2 className="size-3" /> Opérationnel
                    </span>
                  ) : (
                    <span className="text-destructive font-semibold flex items-center gap-1">
                      <XCircle className="size-3" /> Injoignable
                    </span>
                  )}
                </div>
                <div className="flex justify-between py-1 border-b border-border/40">
                  <span className="text-muted-foreground">Dernière mesure</span>
                  <span className="font-mono text-xs">
                    {ops?.generatedAt ? new Date(ops.generatedAt).toLocaleTimeString("fr-FR") : "—"}
                  </span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-muted-foreground">Mode maintenance</span>
                  {!ops?.bot ? (
                    <span className="text-muted-foreground">Non mesuré</span>
                  ) : ops.bot.maintenance ? (
                    <span className="text-amber-400 font-semibold flex items-center gap-1">
                      <AlertTriangle className="size-3" /> Actif
                    </span>
                  ) : (
                    <span className="font-semibold">Inactif</span>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/60 bg-card/40">
              <CardHeader className="p-5 pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Server className="size-4 text-primary" />
                  Bot Discord Achilléa
                </CardTitle>
              </CardHeader>
              <CardContent className="p-5 pt-2 text-xs space-y-2">
                <div className="flex justify-between py-1 border-b border-border/40">
                  <span className="text-muted-foreground">Gateway Discord</span>
                  {!ops?.bot ? (
                    <span className="text-muted-foreground">Non mesuré</span>
                  ) : ops.bot.online ? (
                    <span className="text-emerald-400 font-semibold flex items-center gap-1">
                      <CheckCircle2 className="size-3" /> Connecté
                    </span>
                  ) : (
                    <span className="text-destructive font-semibold flex items-center gap-1">
                      <XCircle className="size-3" /> Déconnecté
                    </span>
                  )}
                </div>
                <div className="flex justify-between py-1 border-b border-border/40">
                  <span className="text-muted-foreground">Temps de fonctionnement</span>
                  <span className="font-mono font-semibold">
                    {typeof ops?.bot?.uptime === "number" ? formaterDuree(ops.bot.uptime) : "—"}
                  </span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-muted-foreground">Serveurs surveillés</span>
                  <span className="font-mono font-semibold">
                    {typeof ops?.bot?.guilds === "number" ? ops.bot.guilds : "—"}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Modal Modification Rôle Utilisateur */}
      <Dialog open={roleModalOpen} onOpenChange={setRoleModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Modifier les permissions</DialogTitle>
            <DialogDescription>
              Définis le niveau de rôle système pour{" "}
              <strong>{selectedUserForRole?.displayName || selectedUserForRole?.username}</strong>.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-3">
            {[
              { label: "Membre ordinaire (Rôle 0)", value: 0, desc: "Accès standard joueur" },
              { label: "Modérateur (Rôle 1)", value: 1, desc: "Accès aux litiges et signalements" },
              {
                label: "Administrateur (Rôle 2)",
                value: 2,
                desc: "Validation clans, sanctions, saisons",
              },
              { label: "Super-Admin (Rôle 3)", value: 3, desc: "Contrôle infrastructure et bot" },
            ].map((r) => (
              <button
                key={r.value}
                type="button"
                onClick={() => setNewRole(r.value)}
                className={`w-full p-3 rounded-xl border text-left transition-all ${
                  newRole === r.value
                    ? "border-primary bg-primary/10 text-on-surface"
                    : "border-border/60 bg-muted/20 text-muted-foreground hover:border-border"
                }`}
              >
                <div className="font-semibold text-xs text-on-surface">{r.label}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{r.desc}</div>
              </button>
            ))}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setRoleModalOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handleSaveRole} disabled={updatingRole}>
              {updatingRole ? "Enregistrement..." : "Appliquer le rôle"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal Ajuster Solde ACH */}
      <Dialog open={adjustWalletOpen} onOpenChange={setAdjustWalletOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Ajuster un portefeuille ACH</DialogTitle>
            <DialogDescription>
              Crédite (positif) ou débite (négatif) des jetons sur le compte d&apos;un utilisateur.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <label
                htmlFor="route-dashboard-admin-dashboard-client-tsx-1"
                className="text-xs font-semibold"
              >
                Identifiant Utilisateur (UUID)
              </label>
              <input
                id="route-dashboard-admin-dashboard-client-tsx-1"
                type="text"
                value={adjustUserId}
                onChange={(e) => setAdjustUserId(e.target.value)}
                placeholder="UUID du compte..."
                className="w-full p-2.5 rounded-xl border border-border/60 bg-muted/20 text-xs font-mono"
              />
            </div>

            <div className="space-y-1">
              <label
                htmlFor="route-dashboard-admin-dashboard-client-tsx-2"
                className="text-xs font-semibold"
              >
                Montant en ACH (ex: 150 ou -50)
              </label>
              <input
                id="route-dashboard-admin-dashboard-client-tsx-2"
                type="number"
                value={adjustAmount}
                onChange={(e) => setAdjustAmount(Number(e.target.value))}
                className="w-full p-2.5 rounded-xl border border-border/60 bg-muted/20 text-xs font-bold"
              />
            </div>

            <div className="space-y-1">
              <label
                htmlFor="route-dashboard-admin-dashboard-client-tsx-3"
                className="text-xs font-semibold"
              >
                Motif de l&apos;ajustement
              </label>
              <input
                id="route-dashboard-admin-dashboard-client-tsx-3"
                type="text"
                value={adjustReason}
                onChange={(e) => setAdjustReason(e.target.value)}
                placeholder="Ex: Prime tournoi, compensation, etc."
                className="w-full p-2.5 rounded-xl border border-border/60 bg-muted/20 text-xs"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setAdjustWalletOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handleAdjustWalletSubmit} disabled={adjusting || !adjustUserId}>
              {adjusting ? "Traitement..." : "Valider l'ajustement"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
