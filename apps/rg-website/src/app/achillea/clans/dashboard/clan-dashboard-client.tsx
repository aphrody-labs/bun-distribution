"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAchilleaAuth, createAchilleaClient } from "@/lib/achillea";
import { UserAvatar } from "@/components/achillea/UserAvatar";
import type { ClanDTO, ClanMemberDTO, ClanApplicationDTO, ClanInviteDTO } from "@rosegriffon/achillea-types";
import { ClanMemberDistinction } from "@rosegriffon/achillea-types/enums/clanMemberRole";
import {
  Shield,
  Users,
  ArrowLeft,
  ShieldAlert,
  Loader2,
  Check,
  X,
  UserPlus,
  UserMinus,
  Settings,
  Mail,
  UserCheck,
  Save,
  Send,
  Bell,
} from "lucide-react";
import { signalerException } from "@/lib/achillea/signaler";

export default function ClanDashboardPage() {
  const { user, isAuthenticated, login, isLoading: authLoading } = useAchilleaAuth();
  const [clanRole, setClanRole] = useState<number | null>(null);
  const [roleLoading, setRoleLoading] = useState<boolean>(true);

  const [clan, setClan] = useState<ClanDTO | null>(null);
  const [members, setMembers] = useState<ClanMemberDTO[]>([]);
  const [applications, setApplications] = useState<ClanApplicationDTO[]>([]);
  const [invites, setInvites] = useState<ClanInviteDTO[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<"members" | "applications" | "invites" | "settings">("members");

  // Invites state
  const [inviteUserId, setInviteUserId] = useState<string>("");
  const [inviting, setInviting] = useState<boolean>(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  // Settings state
  const [bio, setBio] = useState<string>("");
  const [isRecruiting, setIsRecruiting] = useState<boolean>(true);
  const [savingSettings, setSavingSettings] = useState<boolean>(false);
  const [settingsSaved, setSettingsSaved] = useState<boolean>(false);

  const [requestIdentity1, setRequestIdentity1] = useState<readonly unknown[]>([isAuthenticated, user?.id]);
  if ([isAuthenticated, user?.id].some((value, position) => !Object.is(value, requestIdentity1[position]))) {
    setRequestIdentity1([isAuthenticated, user?.id]);
    (() => {
      if (!isAuthenticated) {
        setClanRole(null);
        setRoleLoading(false);
        return;
      }
      setRoleLoading(true);
    })();
  }
  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    let cancelled = false;

    void createAchilleaClient({ credentials: "include" })
      .clans.myRole()
      .then(result => {
        if (!cancelled) {
          setClanRole(result.ok ? result.value.role : null);
          setRoleLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setClanRole(null);
          setRoleLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, user?.id]);

  const canManageClan = clanRole !== null && clanRole >= 2;

  const [requestIdentity2, setRequestIdentity2] = useState<readonly unknown[]>([
    canManageClan,
    isAuthenticated,
    user?.clanId,
  ]);
  if (
    [canManageClan, isAuthenticated, user?.clanId].some(
      (value, position) => !Object.is(value, requestIdentity2[position]),
    )
  ) {
    setRequestIdentity2([canManageClan, isAuthenticated, user?.clanId]);
    (() => {
      if (!isAuthenticated || !canManageClan || !user?.clanId) {
        setLoading(false);
        return;
      }
      setLoading(true);
    })();
  }
  useEffect(() => {
    if (!isAuthenticated || !canManageClan || !user?.clanId) {
      return;
    }

    let cancelled = false;

    const client = createAchilleaClient({ credentials: "include" });

    // Le tableau de bord doit charger le clan de la session, jamais le premier
    // résultat de l'annuaire public (qui pouvait montrer le mauvais clan).
    client.clans
      .get(user.clanId)
      .then(async res => {
        if (cancelled) return;
        if (res.ok) {
          const myClan = res.value;
          setClan(myClan);
          setBio(myClan.clanBiography || "");
          setIsRecruiting(myClan.isRecruiting);

          const [memRes, appRes, invRes] = await Promise.all([
            client.clans.members(myClan.id),
            client.clans.applications(),
            client.clans.invites(),
          ]);

          if (cancelled) return;
          if (memRes.ok) setMembers(memRes.value);
          if (appRes.ok) setApplications(appRes.value);
          if (invRes.ok) setInvites(invRes.value);
        }
      })
      .catch(cause => {
        signalerException("clans/dashboard", cause);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [canManageClan, isAuthenticated, user?.clanId]);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clan) return;
    setSavingSettings(true);
    const client = createAchilleaClient({ credentials: "include" });
    try {
      const res = await client.clans.update(clan.id, {
        clanBiography: bio,
        isRecruiting,
      });
      if (res.ok) {
        setSettingsSaved(true);
        setTimeout(() => setSettingsSaved(false), 2000);
      }
    } finally {
      setSavingSettings(false);
    }
  };

  const handleKickMember = async (userId: string) => {
    if (!clan) return;
    const client = createAchilleaClient({ credentials: "include" });
    await client.clans.kickMember(userId, "Exclusion par un officier");
    setMembers(prev => prev.filter(m => m.user?.id !== userId));
  };

  const handleAcceptApp = async (app: ClanApplicationDTO) => {
    const client = createAchilleaClient({ credentials: "include" });
    await client.clans.acceptApplication(app);
    setApplications(prev => prev.filter(a => a.id !== app.id));
  };

  const handleRejectApp = async (app: ClanApplicationDTO) => {
    const client = createAchilleaClient({ credentials: "include" });
    await client.clans.rejectApplication(app);
    setApplications(prev => prev.filter(a => a.id !== app.id));
  };

  const handleCreateInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteUserId.trim()) return;
    setInviting(true);
    setInviteError(null);
    const client = createAchilleaClient({ credentials: "include" });
    try {
      const res = await client.clans.createInvite(inviteUserId.trim(), [ClanMemberDistinction.Player]);
      if (res.ok) {
        setInviteUserId("");
        const ref = await client.clans.invites();
        if (ref.ok) setInvites(ref.value);
      } else {
        setInviteError(res.detail || "Échec de l'envoi de l'invitation.");
      }
    } catch {
      setInviteError("Erreur réseau lors de l'invitation.");
    } finally {
      setInviting(false);
    }
  };

  const handleRevokeInvite = async (inv: ClanInviteDTO) => {
    const client = createAchilleaClient({ credentials: "include" });
    await client.clans.revokeInvite(inv);
    setInvites(prev => prev.filter(i => i.id !== inv.id));
  };

  const handleNotifyInvite = async (inv: ClanInviteDTO) => {
    const client = createAchilleaClient({ credentials: "include" });
    await client.clans.notifyInvite(inv);
  };

  /*
   * La session arrive par un aller-retour réseau (`GET /auth/me`) : tant qu'il
   * n'a pas répondu, `isAuthenticated` vaut false. Rendre le mur tout de suite
   * annonce « Connexion requise » à un visiteur DÉJÀ connecté, à CHAQUE
   * chargement — c'est ce qui donne l'impression qu'Achilléa refuse l'accès.
   * Les pages d'administration attendaient déjà, celles-ci non.
   */
  if (authLoading || roleLoading) {
    return (
      <div className="max-w-md mx-auto px-4 py-20 text-center text-sm text-muted-foreground">
        Vérification de la session…
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="max-w-md mx-auto px-4 py-20 text-center space-y-4">
        <ShieldAlert className="w-12 h-12 text-amber-500 mx-auto" />
        <h2 className="text-xl font-bold">Connexion requise</h2>
        <p className="text-sm text-muted-foreground">
          Vous devez être membre ou officier d'un clan pour accéder au tableau de bord.
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

  if (!canManageClan) {
    return (
      <div className="max-w-md mx-auto px-4 py-20 text-center space-y-4">
        <ShieldAlert className="w-12 h-12 text-amber-500 mx-auto" />
        <h2 className="text-xl font-bold">Accès réservé aux officiers</h2>
        <p className="text-sm text-muted-foreground">
          Seuls les vice-présidents et présidents de clan peuvent gérer cet espace.
        </p>
        <Link
          href="/achillea/clans"
          className="inline-flex items-center gap-2 px-6 py-2.5 bg-primary text-primary-foreground font-semibold rounded-lg hover:bg-primary/90 transition shadow-sm text-xs"
        >
          Voir l&apos;annuaire des clans
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">
      {/* Breadcrumb */}
      <div className="space-y-1 border-b border-border pb-6">
        <Link
          href="/achillea/clans"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition mb-2"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Retour aux clans
        </Link>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-lg bg-primary/10 text-primary border border-primary/20">
              <Shield className="w-5 h-5" />
            </span>
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Gestion du Clan</h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                {clan ? `${clan.name} [${clan.shortenedName}]` : "Tableau de bord de gestion"}
              </p>
            </div>
          </div>

          {clan && (
            <Link
              href={`/achillea/clans/${clan.id}`}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-border bg-card hover:bg-muted transition"
            >
              Voir la fiche publique
            </Link>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-border pb-px overflow-x-auto">
        <button
          type="button"
          onClick={() => setActiveTab("members")}
          className={`px-4 py-2 text-xs font-semibold border-b-2 transition -mb-px flex items-center gap-1.5 ${
            activeTab === "members"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          Membres ({members.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("applications")}
          className={`px-4 py-2 text-xs font-semibold border-b-2 transition -mb-px flex items-center gap-1.5 ${
            activeTab === "applications"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <UserCheck className="w-3.5 h-3.5" />
          Candidatures ({applications.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("invites")}
          className={`px-4 py-2 text-xs font-semibold border-b-2 transition -mb-px flex items-center gap-1.5 ${
            activeTab === "invites"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Mail className="w-3.5 h-3.5" />
          Invitations ({invites.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("settings")}
          className={`px-4 py-2 text-xs font-semibold border-b-2 transition -mb-px flex items-center gap-1.5 ${
            activeTab === "settings"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Settings className="w-3.5 h-3.5" />
          Paramètres
        </button>
      </div>

      {loading ? (
        <div className="py-20 text-center space-y-3">
          <Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Chargement des données du clan...</p>
        </div>
      ) : (
        <>
          {/* Members Tab */}
          {activeTab === "members" && (
            <div className="border border-border rounded-2xl bg-card overflow-hidden">
              <div className="p-4 border-b border-border bg-muted/20 flex items-center justify-between">
                <h3 className="font-bold text-xs uppercase text-muted-foreground">Effectif du clan</h3>
              </div>

              <div className="divide-y divide-border/60">
                {members.map(m => (
                  <div
                    key={m.user?.id}
                    className="p-3 px-4 flex items-center justify-between gap-4 hover:bg-muted/20 transition"
                  >
                    <div className="flex items-center gap-3">
                      <UserAvatar avatar={m.user?.avatar} name={m.user?.username || "Membre"} className="w-8 h-8" />
                      <div>
                        <div className="font-semibold text-xs text-foreground">{m.user?.username}</div>
                        <div className="text-[10px] text-muted-foreground">
                          Rejoint le {new Date(m.createdAt).toLocaleDateString("fr-FR")}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-muted text-muted-foreground">
                        {m.clanRole === 3 ? "Président" : m.clanRole === 2 ? "Vice-Président" : "Membre"}
                      </span>

                      {m.clanRole !== 3 && (
                        <button
                          type="button"
                          onClick={() => m.user?.id && handleKickMember(m.user.id)}
                          className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition"
                          title="Exclure du clan"
                        >
                          <UserMinus className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Applications Tab */}
          {activeTab === "applications" && (
            <div className="border border-border rounded-2xl bg-card overflow-hidden">
              <div className="p-4 border-b border-border bg-muted/20">
                <h3 className="font-bold text-xs uppercase text-muted-foreground">Candidatures reçues</h3>
              </div>

              {applications.length === 0 ? (
                <div className="py-12 text-center text-xs text-muted-foreground">Aucune candidature en attente.</div>
              ) : (
                <div className="divide-y divide-border/60">
                  {applications.map(app => (
                    <div
                      key={app.id}
                      className="p-4 flex items-center justify-between gap-4 hover:bg-muted/20 transition"
                    >
                      <div className="flex items-center gap-3">
                        <UserAvatar
                          avatar={app.user?.avatar}
                          displayName={app.user?.username || "Candidat"}
                          className="w-8 h-8"
                        />
                        <div>
                          <div className="font-semibold text-xs">{app.user?.username}</div>
                          <div className="text-[10px] text-muted-foreground">
                            Postulé le {new Date(app.createdAt).toLocaleDateString("fr-FR")}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleAcceptApp(app)}
                          className="inline-flex items-center gap-1 px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold transition"
                        >
                          <Check className="w-3.5 h-3.5" />
                          Accepter
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRejectApp(app)}
                          className="inline-flex items-center gap-1 px-3 py-1 border border-border hover:bg-muted text-muted-foreground rounded-lg text-xs font-semibold transition"
                        >
                          <X className="w-3.5 h-3.5" />
                          Refuser
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Invites Tab */}
          {activeTab === "invites" && (
            <div className="space-y-6">
              {/* Formulaire d'envoi d'invitation */}
              <form
                onSubmit={handleCreateInvite}
                className="border border-border rounded-2xl bg-card p-5 space-y-4 shadow-xs"
              >
                <div className="flex items-center gap-2 border-b border-border/60 pb-3">
                  <UserPlus className="w-4 h-4 text-primary" />
                  <h3 className="font-bold text-xs uppercase tracking-wider text-foreground">
                    Inviter un compétiteur dans le clan
                  </h3>
                </div>

                <div className="flex flex-col sm:flex-row gap-3">
                  <input
                    type="text"
                    value={inviteUserId}
                    onChange={e => setInviteUserId(e.target.value)}
                    placeholder="Identifiant Discord du joueur (ex: 394820194829104820)"
                    className="flex-1 px-3 py-2 text-xs bg-background border border-border rounded-xl focus:outline-hidden focus:ring-1 focus:ring-primary font-mono"
                  />
                  <button
                    type="submit"
                    disabled={inviting || !inviteUserId.trim()}
                    className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground font-bold text-xs rounded-xl hover:bg-primary/90 disabled:opacity-50 transition shadow-xs"
                  >
                    {inviting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                    Envoyer l&apos;invitation
                  </button>
                </div>

                {inviteError && (
                  <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 p-2.5 rounded-xl">
                    {inviteError}
                  </p>
                )}
              </form>

              {/* Liste des invitations émises */}
              <div className="border border-border rounded-2xl bg-card overflow-hidden shadow-xs">
                <div className="p-4 border-b border-border bg-muted/20 flex items-center justify-between">
                  <h3 className="font-bold text-xs uppercase text-muted-foreground">
                    Invitations en cours ({invites.length})
                  </h3>
                </div>

                {invites.length === 0 ? (
                  <div className="py-12 text-center text-xs text-muted-foreground">Aucune invitation en cours.</div>
                ) : (
                  <div className="divide-y divide-border/60">
                    {invites.map(inv => (
                      <div
                        key={inv.id}
                        className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-muted/20 transition"
                      >
                        <div className="flex items-center gap-3">
                          <UserAvatar
                            avatar={inv.user?.avatar}
                            displayName={inv.user?.username || "Invité"}
                            className="w-8 h-8"
                          />
                          <div>
                            <div className="font-semibold text-xs text-foreground">
                              {inv.user?.username || "Joueur"}
                            </div>
                            <div className="text-[10px] text-muted-foreground font-mono">ID: {inv.user?.id}</div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 self-end sm:self-auto">
                          <button
                            type="button"
                            onClick={() => handleNotifyInvite(inv)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-border bg-background hover:bg-muted text-xs text-muted-foreground transition"
                            title="Relancer le joueur avec une mention sur Discord"
                          >
                            <Bell className="w-3 h-3 text-amber-400" />
                            Relancer
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRevokeInvite(inv)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-rose-500/30 hover:bg-rose-500/10 text-xs text-rose-400 transition"
                          >
                            <X className="w-3 h-3" />
                            Révoquer
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Settings Tab */}
          {activeTab === "settings" && (
            <form onSubmit={handleSaveSettings} className="border border-border bg-card rounded-2xl p-6 space-y-5">
              <h3 className="font-bold text-sm">Paramètres du Clan</h3>

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label
                    htmlFor="route-dashboard-clan-dashboard-client-tsx-1"
                    className="text-xs font-semibold text-muted-foreground"
                  >
                    Biographie et présentation
                  </label>
                  <textarea
                    id="route-dashboard-clan-dashboard-client-tsx-1"
                    rows={4}
                    value={bio}
                    onChange={e => setBio(e.target.value)}
                    className="w-full p-3 text-xs bg-background border border-border rounded-xl focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <input
                    type="checkbox"
                    id="recruiting-toggle"
                    checked={isRecruiting}
                    onChange={e => setIsRecruiting(e.target.checked)}
                    className="rounded border-border"
                  />
                  <label htmlFor="recruiting-toggle" className="text-xs font-medium cursor-pointer">
                    Activer le recrutement public (apparaît comme [Recrute] sur l'annuaire)
                  </label>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
                {settingsSaved && (
                  <span className="text-xs text-emerald-400 font-semibold flex items-center gap-1">
                    <Check className="w-3.5 h-3.5" />
                    Enregistré !
                  </span>
                )}
                <button
                  type="submit"
                  disabled={savingSettings}
                  className="inline-flex items-center gap-2 px-5 py-2 bg-primary text-primary-foreground font-bold text-xs rounded-xl hover:bg-primary/90 transition shadow-sm"
                >
                  {savingSettings ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  Enregistrer les modifications
                </button>
              </div>
            </form>
          )}
        </>
      )}
    </div>
  );
}
