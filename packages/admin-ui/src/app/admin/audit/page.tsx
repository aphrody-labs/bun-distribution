"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@aphrody/admin-ui/client";
import { formatRelative } from "@aphrody/admin-ui/format";

interface ActionLog {
  id: number;
  action: string;
  userId: string | null;
  moderatorId: string | null;
  reason: string | null;
  meta: string | null;
  createdAt: number;
}

interface DiscordAuditEntry {
  id: string;
  user_id: string | null;
  target_id: string | null;
  action_type: number;
  reason?: string;
  changes?: { key: string; old_value?: unknown; new_value?: unknown }[];
}

interface DiscordAuditLog {
  audit_log_entries: DiscordAuditEntry[];
  users: { id: string; username: string; avatar: string | null }[];
}

const ACTION_TYPE_LABELS: Record<number, string> = {
  1: "GUILD_UPDATE",
  10: "CHANNEL_CREATE",
  11: "CHANNEL_UPDATE",
  12: "CHANNEL_DELETE",
  20: "MEMBER_KICK",
  21: "MEMBER_PRUNE",
  22: "MEMBER_BAN_ADD",
  23: "MEMBER_BAN_REMOVE",
  24: "MEMBER_UPDATE",
  25: "MEMBER_ROLE_UPDATE",
  26: "MEMBER_MOVE",
  27: "MEMBER_DISCONNECT",
  28: "BOT_ADD",
  30: "ROLE_CREATE",
  31: "ROLE_UPDATE",
  32: "ROLE_DELETE",
  40: "INVITE_CREATE",
  42: "INVITE_DELETE",
  72: "MESSAGE_DELETE",
  73: "MESSAGE_BULK_DELETE",
  74: "MESSAGE_PIN",
  75: "MESSAGE_UNPIN",
  83: "AUTO_MODERATION_RULE_CREATE",
};

export default function Audit() {
  const [source, setSource] = useState<"local" | "discord">("local");
  const [page, setPage] = useState(0);
  const limit = 50;
  const offset = page * limit;

  const local = useQuery({
    queryKey: ["audit", page],
    queryFn: () =>
      api.get<{ rows: ActionLog[]; total: number }>(`/database/action_logs?limit=${limit}&offset=${offset}`),
    enabled: source === "local",
  });

  const discord = useQuery({
    queryKey: ["audit", "discord"],
    queryFn: () => api.get<DiscordAuditLog>(`/discord/audit-logs?limit=100`),
    enabled: source === "discord",
  });

  const data = local.data;
  const isLoading = source === "local" ? local.isLoading : discord.isLoading;

  if (isLoading) return <div className="text-zinc-500">Chargement en cours…</div>;

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Journal d'audit</h2>
            <p className="mt-1 text-sm text-zinc-400">
              {source === "local"
                ? `${data?.total ?? 0} entrée${(data?.total ?? 0) > 1 ? "s" : ""} locales (action_logs SQLite, lecture seule).`
                : `${discord.data?.audit_log_entries.length ?? 0} entrées Discord (live REST /audit-logs, lecture seule).`}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setSource("local")}
              className={`btn ${source === "local" ? "btn-primary" : "btn-ghost"}`}
            >
              Local SQLite
            </button>
            <button
              type="button"
              onClick={() => setSource("discord")}
              className={`btn ${source === "discord" ? "btn-primary" : "btn-ghost"}`}
            >
              Discord live
            </button>
          </div>
        </div>
      </div>

      {source === "discord" && discord.data && (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-zinc-800 bg-zinc-900/40 text-xs uppercase tracking-wide text-zinc-400">
              <tr>
                <th className="px-3 py-2 text-left">Action</th>
                <th className="px-3 py-2 text-left">Auteur</th>
                <th className="px-3 py-2 text-left">Cible</th>
                <th className="px-3 py-2 text-left">Motif</th>
                <th className="px-3 py-2 text-left">Changements</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800 font-mono text-xs">
              {discord.data.audit_log_entries.map(e => {
                const author = discord.data!.users.find(u => u.id === e.user_id);
                return (
                  <tr key={e.id} className="hover:bg-zinc-900/30">
                    <td className="px-3 py-2">
                      <span className="badge">{ACTION_TYPE_LABELS[e.action_type] ?? `type:${e.action_type}`}</span>
                    </td>
                    <td className="px-3 py-2">{author?.username ?? e.user_id ?? "—"}</td>
                    <td className="px-3 py-2 text-zinc-400">{e.target_id ?? "—"}</td>
                    <td className="px-3 py-2 text-zinc-400">{e.reason ?? "—"}</td>
                    <td className="px-3 py-2 text-zinc-500">{e.changes?.map(c => c.key).join(", ") ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {source === "discord" && (discord.error || !discord.data) && !discord.isLoading && (
        <div className="card text-sm text-red-400">
          {discord.error
            ? `Erreur Discord : ${(discord.error as Error).message}`
            : "Permission VIEW_AUDIT_LOG manquante sur le bot."}
        </div>
      )}

      {source === "local" && (
        <>
          <div className="card overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-zinc-800 bg-zinc-900/40 text-xs uppercase tracking-wide text-zinc-400">
                <tr>
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">Action</th>
                  <th className="px-3 py-2 text-left">Utilisateur</th>
                  <th className="px-3 py-2 text-left">Modérateur</th>
                  <th className="px-3 py-2 text-left">Motif</th>
                  <th className="px-3 py-2 text-left">Métadonnées</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800 font-mono text-xs">
                {data?.rows.map(r => (
                  <tr key={r.id} className="hover:bg-zinc-900/30">
                    <td className="px-3 py-2 text-zinc-400" title={new Date(r.createdAt).toLocaleString()}>
                      {formatRelative(r.createdAt)}
                    </td>
                    <td className="px-3 py-2">
                      <span className="badge">{r.action}</span>
                    </td>
                    <td className="px-3 py-2">{r.userId ?? "—"}</td>
                    <td className="px-3 py-2">{r.moderatorId ?? "—"}</td>
                    <td className="px-3 py-2 text-zinc-400">{r.reason ?? "—"}</td>
                    <td className="max-w-xs truncate px-3 py-2 text-zinc-500" title={r.meta ?? ""}>
                      {r.meta ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-between">
            <button
              type="button"
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="btn btn-ghost"
            >
              Page précédente
            </button>
            <span className="text-sm text-zinc-400">
              Page {page + 1} sur {Math.max(1, Math.ceil((data?.total ?? 0) / limit))}
            </span>
            <button
              type="button"
              onClick={() => setPage(p => p + 1)}
              disabled={offset + limit >= (data?.total ?? 0)}
              className="btn btn-ghost"
            >
              Page suivante
            </button>
          </div>
        </>
      )}
    </div>
  );
}
