"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FileSearch,
  RefreshCw,
  Filter,
  Loader2,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useState } from "react";
import { api } from "@aphrody/admin-ui/client";

interface ActionLog {
  id: number;
  userId: string | null;
  moderatorId: string | null;
  action: string;
  reason: string | null;
  meta: string | null;
  createdAt: string | number;
}

const ACTION_OPTIONS = [
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
  "CLEAR",
  "SLOWMODE",
  "LOCK",
  "UNLOCK",
  "LEVEL_UP",
] as const;

// Labels lisibles pour les actions
const ACTION_LABELS: Record<string, string> = {
  WARN: "Avertissement",
  UNWARN: "Retrait d'avertissement",
  MUTE: "Mise en sourdine",
  UNMUTE: "Fin de sourdine",
  JAIL: "Mise en prison",
  UNJAIL: "Libération prison",
  BAN: "Bannissement",
  UNBAN: "Débannissement",
  KICK: "Expulsion",
  PURGE: "Suppression messages",
  CLEAR: "Nettoyage",
  SLOWMODE: "Mode lent",
  LOCK: "Verrouillage salon",
  UNLOCK: "Déverrouillage salon",
  LEVEL_UP: "Montée de niveau",
};

const ACTION_COLORS: Record<string, string> = {
  WARN: "text-amber-400",
  UNWARN: "text-emerald-400",
  MUTE: "text-orange-400",
  UNMUTE: "text-emerald-400",
  JAIL: "text-red-400",
  UNJAIL: "text-emerald-400",
  BAN: "text-red-500",
  UNBAN: "text-emerald-400",
  KICK: "text-orange-500",
  PURGE: "text-purple-400",
  CLEAR: "text-purple-400",
  SLOWMODE: "text-blue-400",
  LOCK: "text-blue-400",
  UNLOCK: "text-emerald-400",
  LEVEL_UP: "text-fuchsia-400",
};

/**
 * Visualise la table `action_logs` avec filtres serveur.
 * Distinct de `/admin/audit` qui interroge le journal d'audit Discord natif.
 */
export default function AuditInternalPage() {
  const qc = useQueryClient();
  const [action, setAction] = useState<string>("");
  const [userId, setUserId] = useState<string>("");
  const [page, setPage] = useState<number>(0);
  const limit = 50;

  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(page * limit),
  });
  if (action) params.set("action", action);
  if (userId) params.set("userId", userId);

  const logs = useQuery({
    queryKey: ["audit", "internal", action, userId, page],
    queryFn: () =>
      api.get<{
        rows: ActionLog[];
        total: number;
        limit: number;
        offset: number;
      }>(`/audit/logs?${params}`),
  });

  return (
    <div className="space-y-4">
      {/* En-tête */}
      <div className="card">
        <div className="flex items-center gap-2">
          <FileSearch className="h-5 w-5 text-brand-400" />
          <h2 className="text-lg font-semibold">Journal des actions internes</h2>
          <button
            type="button"
            onClick={() => qc.invalidateQueries({ queryKey: ["audit", "internal"] })}
            className="ml-auto btn btn-ghost px-2"
            title="Rafraîchir"
          >
            <RefreshCw className="h-3 w-3" />
          </button>
        </div>
        <p className="mt-1 text-sm text-zinc-400">
          Toutes les actions enregistrées par le bot : modération, montées de niveau, opérations sur
          l&apos;économie. Pour le journal d&apos;audit officiel Discord, consultez la page{" "}
          <strong>Journal d&apos;audit</strong>.
        </p>
        {/* Filtres */}
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs text-zinc-500">Type d&apos;action</label>
            <select
              className="input w-full"
              value={action}
              onChange={(e) => {
                setAction(e.target.value);
                setPage(0);
              }}
            >
              <option value="">— Toutes les actions —</option>
              {ACTION_OPTIONS.map((a) => (
                <option key={a} value={a}>
                  {ACTION_LABELS[a] ?? a}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-zinc-500">
              Filtrer par membre (identifiant Discord)
            </label>
            <input
              className="input w-full font-mono text-xs"
              value={userId}
              onChange={(e) => {
                setUserId(e.target.value);
                setPage(0);
              }}
              placeholder="000000000000000000"
            />
          </div>
          <div className="flex items-end gap-2">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setAction("");
                setUserId("");
                setPage(0);
              }}
            >
              <Filter className="h-3 w-3" /> Réinitialiser
            </button>
            <span className="ml-auto text-xs text-zinc-500">
              {logs.data?.total ?? 0} entrée
              {(logs.data?.total ?? 0) !== 1 ? "s" : ""}
            </span>
          </div>
        </div>
      </div>

      {/* Chargement */}
      {logs.isLoading && (
        <div className="flex items-center gap-2 text-zinc-500 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Chargement du journal…
        </div>
      )}

      {/* Erreur */}
      {logs.isError && (
        <div className="flex items-center gap-3 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-400">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Impossible de charger le journal. Réessayez.
        </div>
      )}

      {/* Tableau */}
      <div className="card p-0 overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-zinc-900/60 text-left border-b border-zinc-800">
            <tr>
              <th className="px-3 py-2 font-medium text-zinc-400">Action</th>
              <th className="px-3 py-2 font-medium text-zinc-400">Membre</th>
              <th className="px-3 py-2 font-medium text-zinc-400">Modérateur</th>
              <th className="px-3 py-2 font-medium text-zinc-400">Motif</th>
              <th className="px-3 py-2 font-medium text-zinc-400">Données</th>
              <th className="px-3 py-2 font-medium text-zinc-400">Date</th>
            </tr>
          </thead>
          <tbody>
            {logs.data?.rows.map((row) => {
              const createdAt = row.createdAt
                ? new Date(row.createdAt).toLocaleString("fr-FR")
                : "—";
              return (
                <tr
                  key={row.id}
                  className="border-t border-zinc-800 align-top hover:bg-zinc-900/30"
                >
                  <td
                    className={`px-3 py-2 font-semibold ${ACTION_COLORS[row.action] ?? "text-zinc-400"}`}
                  >
                    {ACTION_LABELS[row.action] ?? row.action}
                  </td>
                  <td className="px-3 py-2 font-mono">
                    {row.userId ? (
                      <span title={row.userId}>
                        {row.userId.slice(0, 6)}…{row.userId.slice(-4)}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono">
                    {row.moderatorId ? (
                      <span title={row.moderatorId}>
                        {row.moderatorId.slice(0, 6)}…{row.moderatorId.slice(-4)}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2 max-w-xs truncate" title={row.reason ?? ""}>
                    {row.reason ?? <span className="italic text-zinc-600">Aucun motif</span>}
                  </td>
                  <td className="px-3 py-2 max-w-xs">
                    {row.meta ? <MetaCell raw={row.meta} /> : "—"}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-zinc-500">{createdAt}</td>
                </tr>
              );
            })}
            {logs.data?.rows.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-zinc-500">
                  {action || userId
                    ? "Aucune entrée ne correspond à ces critères."
                    : "Aucune entrée dans le journal."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-center gap-2">
        <button
          type="button"
          className="btn btn-ghost"
          disabled={page === 0}
          onClick={() => setPage((p) => Math.max(0, p - 1))}
        >
          <ChevronLeft className="h-4 w-4" />
          Précédent
        </button>
        <span className="text-xs text-zinc-500">
          Page {page + 1}
          {logs.data?.total ? ` sur ${Math.ceil(logs.data.total / limit)}` : ""}
        </span>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={(logs.data?.rows.length ?? 0) < limit}
          onClick={() => setPage((p) => p + 1)}
        >
          Suivant
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function MetaCell({ raw }: { raw: string }) {
  const [open, setOpen] = useState(false);
  let pretty = raw;
  try {
    pretty = JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    /* keep raw */
  }
  return (
    <details open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer text-zinc-400 hover:text-zinc-200">
        {open ? "Masquer" : `${raw.slice(0, 50)}${raw.length > 50 ? "…" : ""}`}
      </summary>
      <pre className="mt-1 max-h-48 overflow-auto rounded bg-zinc-950 p-2 text-[10px]">
        {pretty}
      </pre>
    </details>
  );
}
