"use client";

/**
 * Historique des révisions du wiki (versioning CMS). Deux modes :
 *   - global (page /admin/wiki/history) : flux de toutes les entités, filtre par
 *     type d'action, pagination ;
 *   - scopé (panneau du studio) : `table` + `rowId` fournis → historique d'une
 *     seule entité, compact.
 *
 * Chaque révision : badge d'action, entité (lien studio si applicable), auteur,
 * date relative, champs modifiés, diff avant/après dépliable et **retour arrière**
 * en un clic (POST /api/wiki-history). Lecture via /api/wiki-history.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  Clock,
  Undo2,
  Plus,
  Pencil,
  Trash2,
  Eye,
  RotateCcw,
} from "lucide-react";
import { apiAt } from "@aphrody/admin-ui/client";
import { TABLE_LABELS, colLabel } from "../../lib/db-labels";
import { isStudioTable } from "@/lib/wiki-fields";

interface Revision {
  id: string;
  tableName: string;
  rowId: string;
  action: string;
  label: string | null;
  editorName: string | null;
  createdAt: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  changedKeys: string[];
}

const client = apiAt("/api/wiki-history");

const ACTION_META: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
  create: {
    label: "Création",
    cls: "border-green-500/40 text-green-300 bg-green-500/10",
    icon: <Plus className="h-3 w-3" />,
  },
  update: {
    label: "Modification",
    cls: "border-dbz-blue-light/40 text-dbz-blue-light bg-dbz-blue-light/10",
    icon: <Pencil className="h-3 w-3" />,
  },
  delete: {
    label: "Suppression",
    cls: "border-red-500/40 text-red-300 bg-red-500/10",
    icon: <Trash2 className="h-3 w-3" />,
  },
  visibility: {
    label: "Visibilité",
    cls: "border-dbz-yellow/40 text-dbz-yellow bg-dbz-yellow/10",
    icon: <Eye className="h-3 w-3" />,
  },
  revert: {
    label: "Retour arrière",
    cls: "border-purple-400/40 text-purple-300 bg-purple-500/10",
    icon: <RotateCcw className="h-3 w-3" />,
  },
};

const ACTION_FILTERS = ["", "create", "update", "delete", "visibility", "revert"] as const;

function relTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const s = Math.round(diff / 1000);
  if (s < 60) return "à l'instant";
  const m = Math.round(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.round(h / 24);
  if (d < 30) return `il y a ${d} j`;
  return new Date(iso).toLocaleDateString("fr-FR");
}

function short(v: unknown): string {
  if (v == null || v === "") return "∅";
  const s = String(v);
  return s.length > 90 ? `${s.slice(0, 90)}…` : s;
}

export function WikiHistory({ table, rowId, compact = false }: { table?: string; rowId?: string; compact?: boolean }) {
  const qc = useQueryClient();
  const scoped = !!(table && rowId);
  const [action, setAction] = useState<string>("");
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    type: "success" | "error";
    msg: string;
  } | null>(null);
  const limit = compact ? 20 : 30;
  const offset = page * limit;

  const qs = new URLSearchParams();
  qs.set("limit", String(limit));
  qs.set("offset", String(offset));
  if (table) qs.set("table", table);
  if (rowId) qs.set("rowId", rowId);
  if (action) qs.set("action", action);

  const query = useQuery({
    queryKey: ["wiki-history", table ?? "*", rowId ?? "*", action, page],
    queryFn: () => client.get<{ rows: Revision[]; total: number }>(`?${qs.toString()}`),
  });

  const revert = useMutation({
    mutationFn: (id: string) => client.post<{ ok: boolean; mode: string }>("", { id }),
    onSuccess: res => {
      setConfirmId(null);
      const modeLabel =
        res.mode === "delete" ? "supprimée" : res.mode === "reinsert" ? "restaurée (ré-insérée)" : "restaurée";
      setToast({ type: "success", msg: `Entrée ${modeLabel}.` });
      qc.invalidateQueries({ queryKey: ["wiki-history"] });
      qc.invalidateQueries({ queryKey: ["wiki-studio"] });
      qc.invalidateQueries({ queryKey: ["db"] });
      setTimeout(() => setToast(null), 3500);
    },
    onError: (err: Error) => {
      setConfirmId(null);
      setToast({ type: "error", msg: `Échec : ${err.message}` });
      setTimeout(() => setToast(null), 4500);
    },
  });

  const rows = query.data?.rows ?? [];
  const total = query.data?.total ?? 0;

  return (
    <div className="space-y-4">
      {toast && (
        <div
          className={`fixed right-4 top-4 z-[120] flex items-center gap-2 rounded-lg border px-4 py-3 text-sm shadow-xl ${
            toast.type === "success"
              ? "border-green-500/50 bg-dbz-card text-green-300"
              : "border-red-500/50 bg-dbz-card text-red-300"
          }`}
        >
          {toast.type === "success" ? (
            <CheckCircle className="h-4 w-4 shrink-0" />
          ) : (
            <AlertTriangle className="h-4 w-4 shrink-0" />
          )}
          {toast.msg}
        </div>
      )}

      {/* Filtres par type d'action (mode global uniquement) */}
      {!scoped && (
        <div className="flex flex-wrap gap-2">
          {ACTION_FILTERS.map(a => (
            <button
              key={a || "all"}
              type="button"
              onClick={() => {
                setAction(a);
                setPage(0);
              }}
              className={`rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-wider transition-colors ${
                action === a
                  ? "border-dbz-orange bg-dbz-orange/15 text-dbz-orange"
                  : "border-dbz-border text-white/50 hover:border-dbz-orange/50 hover:text-white"
              }`}
            >
              {a ? (ACTION_META[a]?.label ?? a) : "Tout"}
            </button>
          ))}
        </div>
      )}

      {query.isLoading ? (
        <div className="card h-40 animate-pulse" />
      ) : rows.length === 0 ? (
        <div className="card py-10 text-center">
          <Clock className="mx-auto mb-2 h-6 w-6 text-white/25" />
          <p className="font-saiyan uppercase text-white/50">Aucune révision</p>
          <p className="mt-1 text-sm text-white/50">
            {scoped
              ? "Cette entité n'a pas encore d'historique d'édition."
              : "Les modifications du wiki apparaîtront ici."}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map(r => {
            const meta = ACTION_META[r.action] ?? {
              label: r.action,
              cls: "border-white/20 text-white/60 bg-white/5",
              icon: null,
            };
            const tableLabel = TABLE_LABELS[r.tableName] ?? r.tableName;
            const isOpen = expanded[r.id];
            const canStudio = isStudioTable(r.tableName) && !r.rowId.includes(":");
            const canRevert = r.action !== "revert";
            const diffKeys = r.changedKeys.length ? r.changedKeys : Object.keys({ ...r.before, ...r.after });
            return (
              <li key={r.id} className="dbz-panel overflow-hidden">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 p-3">
                  <span
                    className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${meta.cls}`}
                  >
                    {meta.icon}
                    {meta.label}
                  </span>
                  <span className="min-w-0 flex-1">
                    {canStudio ? (
                      <Link
                        href={`/admin/wiki/studio/${r.tableName}/${encodeURIComponent(r.rowId)}`}
                        className="font-semibold text-white hover:text-dbz-orange"
                      >
                        {r.label || `#${r.rowId}`}
                      </Link>
                    ) : (
                      <span className="font-semibold text-white">{r.label || `#${r.rowId}`}</span>
                    )}
                    <span className="ml-2 text-[11px] text-white/50">
                      {tableLabel} · {r.rowId}
                    </span>
                  </span>
                  <span className="text-[11px] text-white/50">
                    {r.editorName ? (
                      <span className="text-white/70">{r.editorName}</span>
                    ) : (
                      <span className="italic text-white/50">système</span>
                    )}{" "}
                    · {relTime(r.createdAt)}
                  </span>
                  {diffKeys.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setExpanded(e => ({ ...e, [r.id]: !e[r.id] }))}
                      className="inline-flex items-center gap-1 rounded border border-dbz-border px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-white/50 hover:border-dbz-orange/50 hover:text-white"
                    >
                      {diffKeys.length} champ{diffKeys.length > 1 ? "s" : ""}
                      <ChevronDown className={`h-3 w-3 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                    </button>
                  )}
                  {canRevert && (
                    <button
                      type="button"
                      onClick={() => setConfirmId(r.id)}
                      title="Revenir à l'état précédent cette révision"
                      className="inline-flex items-center gap-1 rounded border border-purple-400/30 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-purple-300 hover:border-purple-400/60 hover:bg-purple-500/10"
                    >
                      <Undo2 className="h-3 w-3" />
                      Annuler
                    </button>
                  )}
                </div>

                {isOpen && (
                  <div className="border-t border-dbz-border/40 bg-dbz-bg/40 p-3">
                    <table className="w-full text-xs">
                      <tbody className="divide-y divide-dbz-border/30">
                        {diffKeys.map(k => (
                          <tr key={k} className="align-top">
                            <td className="w-40 py-1.5 pr-3 font-mono text-[11px] text-dbz-blue-light">
                              {colLabel(k)}
                            </td>
                            <td className="py-1.5 pr-3 text-white/50 line-through decoration-red-400/40">
                              {short(r.before?.[k])}
                            </td>
                            <td className="py-1.5 text-white/85">{short(r.after?.[k])}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {confirmId === r.id && (
                  <div className="border-t border-purple-400/30 bg-purple-500/5 p-3">
                    <p className="mb-2 text-xs text-white/70">
                      Revenir à l'état <strong className="text-white">avant</strong> cette {meta.label.toLowerCase()} ?
                      Une nouvelle révision « retour arrière » sera enregistrée (rien n'est perdu).
                    </p>
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setConfirmId(null)}
                        disabled={revert.isPending}
                        className="btn btn-ghost h-8 text-xs"
                      >
                        Annuler
                      </button>
                      <button
                        type="button"
                        onClick={() => revert.mutate(r.id)}
                        disabled={revert.isPending}
                        className="btn btn-primary h-8 text-xs"
                      >
                        <Undo2 className="h-3 w-3" />
                        {revert.isPending ? "Restauration…" : "Confirmer le retour arrière"}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Pagination */}
      {total > limit && (
        <div className="flex items-center justify-between text-xs text-white/50">
          <button
            type="button"
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            className="btn btn-ghost h-8 text-xs"
          >
            ← Précédent
          </button>
          <span className="tabular-nums">
            {offset + 1}–{Math.min(offset + limit, total)} / {total}
          </span>
          <button
            type="button"
            onClick={() => setPage(p => p + 1)}
            disabled={offset + limit >= total}
            className="btn btn-ghost h-8 text-xs"
          >
            Suivant →
          </button>
        </div>
      )}
    </div>
  );
}
