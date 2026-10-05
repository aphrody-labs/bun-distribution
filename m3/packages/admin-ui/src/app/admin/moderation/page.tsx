"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ShieldAlert,
  Lock,
  Trash2,
  RefreshCw,
  Activity,
  AlertTriangle,
  Ban,
  Hammer,
  Loader2,
  X,
  CheckCircle2,
} from "lucide-react";
import { useState } from "react";
import { api } from "@aphrody/admin-ui/client";
import { formatRelative } from "@aphrody/admin-ui/format";

// createdAt / expiresAt sont des entiers ms (timestamp_ms Drizzle → JSON → number)
// mais si Drizzle retourne un Date, JSON.stringify le sérialise en ISO string.
// On normalise tout via ts() helper.
function ts(v: string | number | null | undefined): number {
  if (!v) return 0;
  if (typeof v === "number") return v;
  const n = new Date(v).getTime();
  return Number.isFinite(n) ? n : 0;
}

interface Warn {
  id: number;
  userId: string;
  moderatorId: string;
  reason: string | null;
  active: boolean;
  createdAt: string | number;
}

interface Jail {
  id: number;
  userId: string;
  moderatorId: string;
  reason: string | null;
  expiresAt: string | number | null;
  releasedAt: string | number | null;
  previousRoles: string | null;
  createdAt: string | number;
}

interface ActionLog {
  id: number;
  action: string;
  userId: string | null;
  moderatorId: string | null;
  reason: string | null;
  meta: string | null;
  createdAt: string | number;
}

interface ModStats {
  windowMs: number;
  since: number;
  byAction: Record<string, number>;
}

const SANCTION_ACTIONS = [
  "WARN",
  "UNWARN",
  "MUTE",
  "UNMUTE",
  "JAIL",
  "UNJAIL",
  "BAN",
  "UNBAN",
  "KICK",
  "PURGE",
  "LOCK",
  "UNLOCK",
  "SLOWMODE",
  "NOTE",
  "CLEARWARNS",
  "ROLE",
  "ROLE_BULK",
];

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  WARN: { label: "Avertissement", color: "text-yellow-400" },
  UNWARN: { label: "Retrait avert.", color: "text-emerald-400" },
  MUTE: { label: "Mise en sourdine", color: "text-orange-400" },
  UNMUTE: { label: "Fin de sourdine", color: "text-emerald-400" },
  JAIL: { label: "Mise en prison", color: "text-red-400" },
  UNJAIL: { label: "Libération prison", color: "text-emerald-400" },
  BAN: { label: "Bannissement", color: "text-red-500" },
  UNBAN: { label: "Débannissement", color: "text-emerald-400" },
  KICK: { label: "Expulsion", color: "text-orange-500" },
  PURGE: { label: "Suppression messages", color: "text-purple-400" },
  LOCK: { label: "Verrouillage salon", color: "text-blue-400" },
  UNLOCK: { label: "Déverrouillage salon", color: "text-emerald-400" },
  SLOWMODE: { label: "Mode lent", color: "text-blue-400" },
  NOTE: { label: "Note interne", color: "text-zinc-400" },
  CLEARWARNS: { label: "Purge des avert.", color: "text-yellow-400" },
  ROLE: { label: "Changement de rôle", color: "text-violet-400" },
  ROLE_BULK: { label: "Rôles en masse", color: "text-violet-400" },
};

// Composant de confirmation modale — remplace window.confirm()
function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="card w-full max-w-sm space-y-4 border border-red-500/40">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
          <div>
            <h3 className="font-semibold text-white">{title}</h3>
            <p className="mt-1 text-sm text-zinc-400">{message}</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="ml-auto btn btn-ghost px-1 py-1"
            aria-label="Fermer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="btn btn-ghost">
            Annuler
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="btn btn-primary bg-red-600 hover:bg-red-500 border-red-500"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ModerationPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<string>("");
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  // Les trois actions de cette page sont irréversibles côté bot : sans retour
  // d'erreur, un échec (bot hors ligne, 403, sanction déjà purgée) était
  // strictement indiscernable d'un succès — le modérateur cliquait à nouveau.
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const showSuccess = (msg: string) => {
    setErrorMsg(null);
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 3000);
  };
  const showError = (action: string, err: unknown) => {
    setSuccessMsg(null);
    setErrorMsg(`${action} : ${err instanceof Error ? err.message : "erreur inconnue"}`);
  };

  const stats = useQuery({
    queryKey: ["moderation", "stats"],
    queryFn: () => api.get<ModStats>("/moderation/stats"),
    refetchInterval: 30_000,
  });
  const warns = useQuery({
    queryKey: ["moderation", "warns"],
    queryFn: () => api.get<{ rows: Warn[]; total: number }>("/moderation/warns?limit=200"),
    refetchInterval: 60_000,
  });
  const jails = useQuery({
    queryKey: ["moderation", "jails"],
    queryFn: () => api.get<{ rows: Jail[]; total: number }>("/moderation/jails"),
    refetchInterval: 60_000,
  });
  const recent = useQuery({
    queryKey: ["moderation", "recent"],
    queryFn: () =>
      api.get<{ rows: ActionLog[]; total: number }>(
        `/moderation/recent?limit=50&actions=${SANCTION_ACTIONS.join(",")}`,
      ),
    refetchInterval: 30_000,
  });

  const unwarn = useMutation({
    mutationFn: (id: number) => api.delete(`/moderation/warns/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["moderation"] });
      showSuccess("Avertissement retiré avec succès.");
    },
    onError: (err) => showError("Retrait de l'avertissement impossible", err),
  });
  const clearAllWarns = useMutation({
    mutationFn: (userId: string) => api.post(`/moderation/warns/clear/${userId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["moderation"] });
      showSuccess("Avertissements supprimés.");
    },
    onError: (err) => showError("Purge des avertissements impossible", err),
  });
  const unjail = useMutation({
    mutationFn: (userId: string) => api.delete(`/moderation/jails/${userId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["moderation"] });
      showSuccess("Membre libéré avec succès.");
    },
    onError: (err) => showError("Libération impossible", err),
  });

  const filterWarns = (warns.data?.rows ?? []).filter(
    (w) =>
      !filter ||
      w.userId.includes(filter) ||
      (w.reason ?? "").toLowerCase().includes(filter.toLowerCase()),
  );
  const filterJails = (jails.data?.rows ?? []).filter(
    (j) =>
      !filter ||
      j.userId.includes(filter) ||
      (j.reason ?? "").toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <div className="space-y-4">
      {/* En-tête */}
      <div className="card">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-5 w-5 text-brand-400" />
          <h2 className="text-lg font-semibold">Modération</h2>
          <button
            type="button"
            className="btn btn-ghost ml-auto"
            onClick={() => qc.invalidateQueries({ queryKey: ["moderation"] })}
          >
            <RefreshCw className="h-4 w-4" />
            Recharger
          </button>
        </div>
        <p className="mt-1 text-sm text-zinc-400">
          Cette page regroupe les avertissements actifs, les membres en prison et le journal des
          dernières actions des modérateurs.
        </p>
      </div>

      {/* Feedback succès */}
      {successMsg && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          {successMsg}
        </div>
      )}
      {/* Feedback erreur */}
      {errorMsg && (
        <div className="flex items-center gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-400">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {errorMsg}
        </div>
      )}

      {/* KPIs */}
      <KpisCard stats={stats.data} loading={stats.isLoading} />

      {/* Filtres */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          placeholder="Filtrer par identifiant Discord ou motif…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="input flex-1"
        />
        {filter && (
          <button type="button" className="btn btn-ghost px-2" onClick={() => setFilter("")}>
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <WarnsCard
          rows={filterWarns}
          total={warns.data?.total ?? 0}
          loading={warns.isLoading}
          onUnwarn={(id) => unwarn.mutate(id)}
          onClearAll={(userId) => clearAllWarns.mutate(userId)}
          pending={unwarn.isPending || clearAllWarns.isPending}
        />
        <JailsCard
          rows={filterJails}
          total={jails.data?.total ?? 0}
          loading={jails.isLoading}
          onUnjail={(userId) => unjail.mutate(userId)}
          pending={unjail.isPending}
        />
      </div>

      <RecentCard rows={recent.data?.rows ?? []} loading={recent.isLoading} />
    </div>
  );
}

function KpisCard({ stats, loading }: { stats: ModStats | undefined; loading: boolean }) {
  if (loading)
    return (
      <div className="flex items-center gap-2 text-zinc-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Chargement des statistiques…
      </div>
    );
  const by = stats?.byAction ?? {};
  const items: Array<{
    label: string;
    value: number;
    icon: React.ReactNode;
    color: string;
  }> = [
    {
      label: "Avert. (7 j)",
      value: by.WARN ?? 0,
      icon: <AlertTriangle className="h-4 w-4" />,
      color: "text-yellow-400",
    },
    {
      label: "Sourdines (7 j)",
      value: by.MUTE ?? 0,
      icon: <Activity className="h-4 w-4" />,
      color: "text-orange-400",
    },
    {
      label: "Prisons (7 j)",
      value: by.JAIL ?? 0,
      icon: <Lock className="h-4 w-4" />,
      color: "text-red-400",
    },
    {
      label: "Expulsions (7 j)",
      value: by.KICK ?? 0,
      icon: <Ban className="h-4 w-4" />,
      color: "text-rose-400",
    },
    {
      label: "Bannissements (7 j)",
      value: by.BAN ?? 0,
      icon: <Hammer className="h-4 w-4" />,
      color: "text-red-600",
    },
    {
      label: "Purges (7 j)",
      value: by.PURGE ?? 0,
      icon: <Trash2 className="h-4 w-4" />,
      color: "text-zinc-400",
    },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {items.map((it) => (
        <div key={it.label} className="card">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-zinc-500">
            <span className={it.color}>{it.icon}</span>
            {it.label}
          </div>
          <div className="mt-1 text-2xl font-bold text-zinc-100">{it.value}</div>
        </div>
      ))}
    </div>
  );
}

function WarnsCard({
  rows,
  total,
  loading,
  onUnwarn,
  onClearAll,
  pending,
}: {
  rows: Warn[];
  total: number;
  loading: boolean;
  onUnwarn: (id: number) => void;
  onClearAll: (userId: string) => void;
  pending: boolean;
}) {
  const [confirmUnwarn, setConfirmUnwarn] = useState<{
    id: number;
    userId: string;
  } | null>(null);
  const [confirmClear, setConfirmClear] = useState<{
    userId: string;
    count: number;
  } | null>(null);

  const byUser = new Map<string, Warn[]>();
  for (const w of rows) {
    const arr = byUser.get(w.userId) ?? [];
    arr.push(w);
    byUser.set(w.userId, arr);
  }

  return (
    <>
      {confirmUnwarn && (
        <ConfirmDialog
          title="Retirer cet avertissement ?"
          message="Cette action est irréversible. L'avertissement sera définitivement supprimé."
          confirmLabel="Retirer l'avertissement"
          onConfirm={() => {
            onUnwarn(confirmUnwarn.id);
            setConfirmUnwarn(null);
          }}
          onCancel={() => setConfirmUnwarn(null)}
        />
      )}
      {confirmClear && (
        <ConfirmDialog
          title={`Supprimer tous les avertissements ?`}
          message={`Vous allez supprimer ${confirmClear.count} avertissement${confirmClear.count > 1 ? "s" : ""} pour ce membre. Action irréversible.`}
          confirmLabel="Tout supprimer"
          onConfirm={() => {
            onClearAll(confirmClear.userId);
            setConfirmClear(null);
          }}
          onCancel={() => setConfirmClear(null)}
        />
      )}
      <div className="card">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <AlertTriangle className="h-4 w-4 text-yellow-400" />
            Avertissements actifs ({total})
          </h3>
        </div>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Chargement…
          </div>
        ) : byUser.size === 0 ? (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/20 p-4 text-center text-sm text-zinc-500">
            Aucun avertissement actif pour le moment.
          </div>
        ) : (
          <div className="max-h-[480px] space-y-2 overflow-y-auto pr-1">
            {[...byUser.entries()].map(([userId, list]) => (
              <div key={userId} className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-2">
                <div className="flex items-center justify-between">
                  <div className="text-xs">
                    <span className="badge badge-warning">{list.length} avert.</span>{" "}
                    <span className="ml-1 font-mono text-zinc-300" title={`ID Discord : ${userId}`}>
                      {userId.slice(0, 6)}…{userId.slice(-4)}
                    </span>
                    <span className="ml-1 text-zinc-500 text-[10px]">({userId})</span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost text-xs text-red-400"
                    disabled={pending}
                    onClick={() => setConfirmClear({ userId, count: list.length })}
                  >
                    <Trash2 className="h-3 w-3" /> Tout supprimer
                  </button>
                </div>
                <ul className="mt-2 space-y-1">
                  {list.map((w) => {
                    const createdMs = ts(w.createdAt);
                    return (
                      <li
                        key={w.id}
                        className="flex items-center justify-between rounded bg-zinc-950/40 px-2 py-1 text-xs"
                      >
                        <div>
                          <span className="text-zinc-500">#{w.id}</span>{" "}
                          <span
                            className="text-zinc-400"
                            title={createdMs ? new Date(createdMs).toLocaleString("fr-FR") : ""}
                          >
                            {createdMs ? formatRelative(createdMs) : "—"}
                          </span>{" "}
                          <span className="text-zinc-500">par {w.moderatorId.slice(0, 6)}…</span>
                          {w.reason && <div className="mt-0.5 text-zinc-400">{w.reason}</div>}
                          {!w.reason && (
                            <div className="mt-0.5 text-zinc-600 italic">Aucun motif précisé</div>
                          )}
                        </div>
                        <button
                          type="button"
                          className="ml-2 shrink-0 btn btn-ghost text-xs text-red-400"
                          disabled={pending}
                          onClick={() => setConfirmUnwarn({ id: w.id, userId })}
                        >
                          Retirer
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function JailsCard({
  rows,
  total,
  loading,
  onUnjail,
  pending,
}: {
  rows: Jail[];
  total: number;
  loading: boolean;
  onUnjail: (userId: string) => void;
  pending: boolean;
}) {
  const [confirmUnjail, setConfirmUnjail] = useState<string | null>(null);

  return (
    <>
      {confirmUnjail && (
        <ConfirmDialog
          title="Libérer ce membre ?"
          message="Le membre récupéra ses anciens rôles et pourra de nouveau parler sur le serveur."
          confirmLabel="Libérer le membre"
          onConfirm={() => {
            onUnjail(confirmUnjail);
            setConfirmUnjail(null);
          }}
          onCancel={() => setConfirmUnjail(null)}
        />
      )}
      <div className="card">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Lock className="h-4 w-4 text-red-400" />
            Membres en prison ({total})
          </h3>
        </div>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Chargement…
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/20 p-4 text-center text-sm text-zinc-500">
            Aucun membre en prison pour le moment.
          </div>
        ) : (
          <div className="max-h-[480px] space-y-2 overflow-y-auto pr-1">
            {rows.map((j) => {
              const createdMs = ts(j.createdAt);
              const expiresMs = j.expiresAt ? ts(j.expiresAt) : null;
              const expired = expiresMs !== null && expiresMs < Date.now();
              return (
                <div
                  key={j.id}
                  className="flex items-start justify-between rounded-lg border border-zinc-800 bg-zinc-900/40 p-2 text-xs"
                >
                  <div>
                    <div className="font-mono text-zinc-300 text-[11px]">
                      <span title={`ID Discord : ${j.userId}`}>
                        {j.userId.slice(0, 6)}…{j.userId.slice(-4)}
                      </span>
                      <span className="ml-1 text-zinc-600">({j.userId})</span>
                    </div>
                    <div className="text-zinc-400 mt-0.5">
                      Emprisonné{" "}
                      <span title={createdMs ? new Date(createdMs).toLocaleString("fr-FR") : ""}>
                        {createdMs ? formatRelative(createdMs) : "—"}
                      </span>{" "}
                      par {j.moderatorId.slice(0, 6)}…
                    </div>
                    {expiresMs ? (
                      <div className={expired ? "text-red-400 font-medium" : "text-zinc-500"}>
                        {expired ? "Peine expirée — " : "Expire "}
                        <span title={new Date(expiresMs).toLocaleString("fr-FR")}>
                          {formatRelative(expiresMs)}
                        </span>
                      </div>
                    ) : (
                      <div className="text-zinc-500">Peine indéfinie</div>
                    )}
                    <div className="text-zinc-400">
                      Motif :{" "}
                      {j.reason ?? (
                        <span className="italic text-zinc-600">Aucun motif précisé</span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="ml-2 shrink-0 btn btn-ghost text-xs"
                    disabled={pending}
                    onClick={() => setConfirmUnjail(j.userId)}
                  >
                    Libérer
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

function RecentCard({ rows, loading }: { rows: ActionLog[]; loading: boolean }) {
  return (
    <div className="card overflow-x-auto p-0">
      <div className="border-b border-zinc-800 p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Activity className="h-4 w-4 text-brand-400" />
          Actions de modération récentes ({rows.length})
        </h3>
        <p className="mt-1 text-xs text-zinc-500">
          Historique des 50 dernières sanctions prononcées sur le serveur.
        </p>
      </div>
      {loading ? (
        <div className="flex items-center gap-2 p-4 text-sm text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Chargement…
        </div>
      ) : rows.length === 0 ? (
        <div className="p-4 text-sm text-zinc-500">Aucune action de modération récente.</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-zinc-900/40 text-xs uppercase tracking-wide text-zinc-400">
            <tr>
              <th className="px-3 py-2 text-left">Date</th>
              <th className="px-3 py-2 text-left">Action</th>
              <th className="px-3 py-2 text-left">Membre</th>
              <th className="px-3 py-2 text-left">Modérateur</th>
              <th className="px-3 py-2 text-left">Motif</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800 font-mono text-xs">
            {rows.map((r) => {
              const createdMs = ts(r.createdAt);
              const actionMeta = ACTION_LABELS[r.action];
              return (
                <tr key={r.id} className="hover:bg-zinc-900/30">
                  <td
                    className="px-3 py-2 text-zinc-400"
                    title={createdMs ? new Date(createdMs).toLocaleString("fr-FR") : ""}
                  >
                    {createdMs ? formatRelative(createdMs) : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`badge ${actionMeta?.color ?? ""}`}>
                      {actionMeta?.label ?? r.action}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {r.userId ? (
                      <span title={r.userId}>
                        {r.userId.slice(0, 6)}…{r.userId.slice(-4)}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2 text-zinc-400">
                    {r.moderatorId ? (
                      <span title={r.moderatorId}>
                        {r.moderatorId.slice(0, 6)}…{r.moderatorId.slice(-4)}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2 text-zinc-400 max-w-[200px] truncate">
                    {r.reason ?? <span className="italic text-zinc-600">Aucun motif</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
