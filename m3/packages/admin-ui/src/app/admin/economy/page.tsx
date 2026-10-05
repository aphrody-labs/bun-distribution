"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserSelect } from "@aphrody/admin-ui/components/admin/UserSelect";
import { RoleSelect } from "@aphrody/admin-ui/components/admin/RoleSelect";
import {
  Alerte,
  Cadeau,
  Chargement,
  CocheCercle,
  Crayon,
  Croix,
  Envoyer,
  Groupe,
  Historique,
  Piece,
  Rafraichir,
  Tendance,
  Trophee,
} from "@/components/icones";
import { useState } from "react";
import { api } from "@aphrody/admin-ui/client";
import { fmtNum } from "@aphrody/admin-ui/format";
import { formatZeni } from "@/lib/zeni";

interface EconomyStats {
  zeni: {
    total: number;
    avg: number;
    max: number;
    users: number;
    rich: number;
    zero: number;
  };
  fusions: number;
  inventoryItems: number;
  shopItemsActive: number;
}
interface UserRow {
  id: string;
  zeni: number;
  xp: number;
  displayName?: string | null;
}
interface TransactionRow {
  id: number;
  userId: string | null;
  moderatorId: string | null;
  action: string;
  reason: string | null;
  meta: string | null;
  createdAt: string | number;
}

const ACTION_LABEL: Record<string, { label: string; color: string }> = {
  SHOP_PURCHASE: { label: "Achat boutique", color: "text-blue-400" },
  LEVEL_UP: { label: "Montée de niveau", color: "text-emerald-400" },
  ZENI_ADMIN_GIVE: { label: "Don administrateur", color: "text-yellow-400" },
  ZENI_ADMIN_REMOVE: { label: "Retrait administrateur", color: "text-red-400" },
  ZENI_ADMIN_SET: { label: "Définition directe", color: "text-purple-400" },
  ZENI_ADMIN_BULK: { label: "Distribution de masse", color: "text-cyan-400" },
};

// Modale de confirmation
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
      <div className="card w-full max-w-sm space-y-4 border border-amber-500/40">
        <div className="flex items-start gap-3">
          <Alerte className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
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
            <Croix className="h-4 w-4" />
          </button>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="btn btn-ghost">
            Annuler
          </button>
          <button type="button" onClick={onConfirm} className="btn btn-primary">
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AdminEconomyPage() {
  const qc = useQueryClient();
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const showSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 3000);
  };

  const stats = useQuery({
    queryKey: ["economy", "stats"],
    queryFn: () => api.get<EconomyStats>("/economy/stats"),
    refetchInterval: 30_000,
  });

  const top = useQuery({
    queryKey: ["economy", "top"],
    queryFn: () => api.get<{ rows: UserRow[] }>("/economy/leaderboard?limit=20"),
  });

  const txs = useQuery({
    queryKey: ["economy", "txs"],
    queryFn: () => api.get<{ rows: TransactionRow[] }>("/economy/transactions?limit=50"),
  });

  const settings = useQuery({
    queryKey: ["settings", "all"],
    queryFn: () =>
      api.get<{ rows: { key: string; value: string }[] }>("/database/guild_settings?limit=200"),
    staleTime: 30_000,
  });
  const channels = useQuery({
    queryKey: ["discord", "channels"],
    queryFn: () =>
      api.get<{ channels: { id: string; name: string; type: number }[] }>("/discord/channels"),
    staleTime: 30_000,
  });

  const channelZeniId = settings.data?.rows.find((r) => r.key === "channel.zeni")?.value;
  const channelZeniName = channels.data?.channels.find((c) => c.id === channelZeniId)?.name;

  // /api/services/settings/set et /api/services/settings/unset sont des actions
  // enregistrées dans service-registry.ts — l'endpoint est POST /services/:service/:action
  const setSetting = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) =>
      api.post("/services/settings/set", { key, value }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
      showSuccess("Salon des récompenses mis à jour.");
    },
  });
  const unsetSetting = useMutation({
    mutationFn: (key: string) => api.post("/services/settings/unset", { key }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
      showSuccess("Salon des récompenses désactivé.");
    },
  });

  const give = useMutation({
    mutationFn: (body: {
      mode: "user" | "role" | "all";
      userId?: string;
      roleId?: string;
      amount: number;
    }) => api.post<{ ok: boolean; applied?: number }>("/economy/give", body),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["economy"] });
      showSuccess(`Distribution réussie sur ${data.applied ?? 0} membre(s).`);
    },
  });
  const setBalance = useMutation({
    mutationFn: (body: { userId: string; amount: number }) => api.post("/economy/set", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["economy"] });
      showSuccess("Solde modifié avec succès.");
    },
  });

  return (
    <div className="space-y-4">
      {/* En-tête */}
      <div className="card">
        <div className="flex items-center gap-2">
          <Piece className="h-5 w-5 text-amber-400" />
          <h2 className="text-lg font-semibold">Économie</h2>
          <button
            type="button"
            onClick={() => qc.invalidateQueries({ queryKey: ["economy"] })}
            className="btn btn-ghost ml-auto px-2"
            title="Rafraîchir les données"
          >
            <Rafraichir className="h-3 w-3" />
          </button>
        </div>
        <p className="mt-1 text-sm text-zinc-400">
          Vue d&apos;ensemble de la monnaie du serveur : circulation des zénis, classement des
          membres les plus riches, historique des transactions et opérations administratives.
        </p>
      </div>

      {/* Feedback */}
      {successMsg && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400">
          <CocheCercle className="h-4 w-4 shrink-0" />
          {successMsg}
        </div>
      )}

      {/* Salon des récompenses zeni */}
      <div className="card">
        <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-zinc-400">
          <Cadeau className="h-4 w-4" />
          Salon des notifications de récompense
        </h3>
        <p className="mb-3 text-xs text-zinc-500">
          Les notifications de zénis (quête quotidienne, drop aléatoire, victoire dans un jeu) sont
          envoyées dans ce salon. Laissez vide pour les désactiver. Les modèles de messages sont
          éditables sur la page <strong>Messages</strong>.
        </p>
        <div className="flex items-center gap-2">
          {channels.isLoading ? (
            <div className="flex items-center gap-2 text-zinc-500 text-sm">
              <Chargement className="h-4 w-4 animate-spin" />
              Chargement des salons…
            </div>
          ) : (
            <select
              className="input flex-1"
              value={channelZeniId ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) unsetSetting.mutate("channel.zeni");
                else setSetting.mutate({ key: "channel.zeni", value: v });
              }}
            >
              <option value="">— Désactivé (aucune notification) —</option>
              {channels.data?.channels
                .filter((c) => c.type === 0)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    #{c.name}
                  </option>
                ))}
            </select>
          )}
          {channelZeniName && (
            <span className="badge badge-success">Actif : #{channelZeniName}</span>
          )}
        </div>
      </div>

      {/* Stats globales */}
      {stats.isLoading ? (
        <div className="flex items-center gap-2 text-zinc-500 text-sm">
          <Chargement className="h-4 w-4 animate-spin" />
          Chargement des statistiques…
        </div>
      ) : stats.isError ? (
        <div className="flex items-center gap-2 text-sm text-red-400">
          <Alerte className="h-4 w-4" />
          Impossible de charger les statistiques. Réessayez.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            icon={Piece}
            label="Zénis en circulation"
            value={fmtNum(stats.data?.zeni.total)}
            sub={`Maximum détenu : ${fmtNum(stats.data?.zeni.max)} z`}
            color="text-amber-400"
          />
          <StatCard
            icon={Groupe}
            label="Membres enregistrés"
            value={fmtNum(stats.data?.zeni.users)}
            sub={`${stats.data?.zeni.rich ?? 0} riches · ${stats.data?.zeni.zero ?? 0} à zéro`}
            color="text-blue-400"
          />
          <StatCard
            icon={Tendance}
            label="Solde moyen"
            value={fmtNum(Math.round(stats.data?.zeni.avg ?? 0))}
            sub="Moyenne par membre actif"
            color="text-emerald-400"
          />
          <StatCard
            icon={Trophee}
            label="Objets en inventaire"
            value={fmtNum(stats.data?.inventoryItems)}
            sub={`${stats.data?.fusions ?? 0} fusions · ${stats.data?.shopItemsActive ?? 0} articles actifs`}
            color="text-purple-400"
          />
        </div>
      )}

      {/* Top zenis */}
      <div className="card">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-zinc-400">
          <Trophee className="h-4 w-4" />
          Top 20 membres les plus riches
        </h3>
        {top.isLoading && (
          <div className="flex items-center gap-2 text-zinc-500 text-sm">
            <Chargement className="h-4 w-4 animate-spin" />
            Chargement…
          </div>
        )}
        {top.isError && (
          <div className="flex items-center gap-2 text-sm text-red-400">
            <Alerte className="h-4 w-4" />
            Impossible de charger le classement. Réessayez.
          </div>
        )}
        {top.data?.rows.length === 0 && (
          <p className="text-sm text-zinc-500">Aucun membre enregistré.</p>
        )}
        <div className="space-y-1">
          {top.data?.rows.map((u, i) => (
            <div key={u.id} className="flex items-center gap-3 rounded p-2 hover:bg-zinc-800/40">
              <span className="w-8 text-right font-mono text-sm text-zinc-500">#{i + 1}</span>
              <span
                className="flex-1 truncate text-xs text-zinc-300 font-mono"
                title={`ID Discord : ${u.id}`}
              >
                {u.displayName ?? (
                  <>
                    {u.id.slice(0, 6)}…{u.id.slice(-4)}
                    <span className="ml-1 text-zinc-600 text-[10px]">({u.id})</span>
                  </>
                )}
              </span>
              <span className="font-mono text-sm font-semibold text-amber-400">
                {fmtNum(u.zeni)} z
              </span>
              <EditBalanceButton
                userId={u.id}
                current={u.zeni}
                onSave={(amount) => setBalance.mutate({ userId: u.id, amount })}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Distribution de masse */}
      <div className="card">
        <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-zinc-400">
          <Envoyer className="h-4 w-4" />
          Distribution de zénis
        </h3>
        <p className="mb-3 text-xs text-zinc-500">
          Donnez ou retirez des zénis à un membre, à tous les membres d&apos;un rôle Discord ou à
          l&apos;ensemble du serveur. Un montant négatif retire des zénis. Toutes les opérations
          sont enregistrées dans l&apos;historique.
        </p>
        <BulkGiveForm onSubmit={(body) => give.mutate(body)} pending={give.isPending} />
        {give.isError && (
          <p className="mt-2 flex items-center gap-1 text-xs text-red-400">
            <Alerte className="h-3 w-3" />
            {give.error instanceof Error ? give.error.message : String(give.error)}
          </p>
        )}
      </div>

      {/* Transactions récentes */}
      <div className="card">
        <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-zinc-400">
          <Historique className="h-4 w-4" />
          Historique des transactions
        </h3>
        <p className="mb-3 text-xs text-zinc-500">
          Les 50 dernières opérations économiques (achats, montées de niveau, dons
          administrateurs…).
        </p>
        {txs.isLoading && (
          <div className="flex items-center gap-2 text-zinc-500 text-sm">
            <Chargement className="h-4 w-4 animate-spin" />
            Chargement…
          </div>
        )}
        {txs.data?.rows.length === 0 && (
          <p className="text-zinc-500 text-sm">Aucune transaction pour le moment.</p>
        )}
        <div className="space-y-1 max-h-[500px] overflow-y-auto">
          {txs.data?.rows.map((t) => {
            const meta = ACTION_LABEL[t.action] ?? {
              label: t.action,
              color: "text-zinc-400",
            };
            const createdAt = t.createdAt ? new Date(t.createdAt).toLocaleString("fr-FR") : "—";
            return (
              <div key={t.id} className="rounded border border-zinc-800 bg-zinc-950/40 p-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className={`font-medium ${meta.color}`}>{meta.label}</span>
                  {t.userId && (
                    <span className="text-zinc-400 font-mono" title={`ID Discord : ${t.userId}`}>
                      {t.userId.slice(0, 6)}…{t.userId.slice(-4)}
                    </span>
                  )}
                  <span className="ml-auto text-zinc-500">{createdAt}</span>
                </div>
                {t.meta && <pre className="mt-1 overflow-x-auto text-zinc-500">{t.meta}</pre>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  color,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub: string;
  color: string;
}) {
  return (
    <div className="card">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-wide text-zinc-500">{label}</p>
          <p className="mt-1 font-mono text-2xl font-semibold">{value}</p>
          <p className="mt-1 text-xs text-zinc-500">{sub}</p>
        </div>
        <Icon className={`h-5 w-5 ${color}`} />
      </div>
    </div>
  );
}

function EditBalanceButton({
  userId: _userId,
  current,
  onSave,
}: {
  userId: string;
  current: number;
  onSave: (amount: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(current));
  const [confirm, setConfirm] = useState(false);
  const pendingAmount = Number.parseInt(val, 10);

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setVal(String(current));
          setEditing(true);
        }}
        className="btn btn-ghost px-1 py-0 text-xs"
        title="Modifier le solde de ce membre"
      >
        <Crayon className="h-3 w-3" />
      </button>
    );
  }

  return (
    <>
      {confirm && (
        <ConfirmDialog
          title="Modifier le solde ?"
          message={`Vous allez définir le solde de ce membre à ${formatZeni(pendingAmount)}. Cette action est enregistrée dans l'historique.`}
          confirmLabel="Définir le solde"
          onConfirm={() => {
            onSave(pendingAmount);
            setEditing(false);
            setConfirm(false);
          }}
          onCancel={() => setConfirm(false)}
        />
      )}
      <div className="flex items-center gap-1">
        <input
          type="number"
          min={0}
          value={val}
          onChange={(e) => setVal(e.target.value)}
          className="input w-24 px-1 py-0 text-xs"
        />
        <button
          type="button"
          onClick={() => {
            if (!Number.isFinite(pendingAmount) || pendingAmount < 0) return;
            setConfirm(true);
          }}
          className="btn btn-primary px-1 py-0 text-xs"
          title="Valider"
        >
          <CocheCercle className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="btn btn-ghost px-1 py-0 text-xs"
          title="Annuler"
        >
          <Croix className="h-3 w-3" />
        </button>
      </div>
    </>
  );
}

function BulkGiveForm({
  onSubmit,
  pending,
}: {
  onSubmit: (body: {
    mode: "user" | "role" | "all";
    userId?: string;
    roleId?: string;
    amount: number;
  }) => void;
  pending: boolean;
}) {
  const [mode, setMode] = useState<"user" | "role" | "all">("user");
  const [userId, setUserId] = useState("");
  const [roleId, setRoleId] = useState("");
  const [amount, setAmount] = useState("100");
  const [confirm, setConfirm] = useState<null | {
    mode: "user" | "role" | "all";
    userId: string;
    roleId: string;
    amount: number;
  }>(null);

  const handleClick = () => {
    const n = Number.parseInt(amount, 10);
    if (!Number.isFinite(n) || n === 0) return;
    setConfirm({ mode, userId, roleId, amount: n });
  };

  const confirmMsg =
    confirm === null
      ? ""
      : confirm.mode === "all"
        ? `Vous allez distribuer ${formatZeni(confirm.amount)} à TOUS les membres enregistrés. Cette opération peut toucher plusieurs centaines de membres.`
        : confirm.mode === "role"
          ? `Vous allez distribuer ${formatZeni(confirm.amount)} à tous les membres possédant le rôle Discord ${confirm.roleId}.`
          : `Vous allez donner ${formatZeni(confirm.amount)} au membre ${confirm.userId}.`;

  return (
    <>
      {confirm && (
        <ConfirmDialog
          title="Confirmer la distribution ?"
          message={confirmMsg}
          confirmLabel={`Distribuer ${formatZeni(confirm.amount)}`}
          onConfirm={() => {
            onSubmit({
              mode: confirm.mode,
              userId: confirm.userId,
              roleId: confirm.roleId,
              amount: confirm.amount,
            });
            setConfirm(null);
          }}
          onCancel={() => setConfirm(null)}
        />
      )}
      <div className="space-y-3">
        <div className="flex gap-2">
          {(["user", "role", "all"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`btn ${mode === m ? "btn-primary" : "btn-ghost"}`}
            >
              {m === "user" ? "1 membre" : m === "role" ? "Par rôle" : "Tout le serveur"}
            </button>
          ))}
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          {mode === "user" && (
            <div>
              <label className="mb-1 block text-xs text-zinc-400">
                Identifiant Discord du membre
              </label>
              <UserSelect value={userId} onChange={setUserId} />
            </div>
          )}
          {mode === "role" && (
            <div>
              <label className="mb-1 block text-xs text-zinc-400">
                Identifiant Discord du rôle
              </label>
              <RoleSelect value={roleId} onChange={setRoleId} />
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs text-zinc-400">Montant (négatif = retrait)</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="ex. 500 ou -200"
              className="input w-full"
            />
          </div>
          <div className="flex items-end">
            <button
              type="button"
              onClick={handleClick}
              disabled={pending || !amount}
              className="btn btn-primary w-full"
            >
              <Envoyer className="h-3 w-3" />
              {pending ? "Distribution en cours…" : "Distribuer les zénis"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
