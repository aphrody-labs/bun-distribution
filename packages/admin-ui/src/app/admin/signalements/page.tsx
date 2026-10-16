"use client";

/**
 * /admin/signalements — back-office des signalements utilisateurs (tickets).
 * Liste les remontées « Signaler une erreur » des membres, avec filtres par
 * statut, workflow (ouvert → en cours → résolu → fermé), note interne et
 * suppression. Lecture/écriture via /api/admin/reports (Postgres site).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bulle, Chargement, Corbeille, Drapeau } from "@shenron/ui/icones";
import Link from "next/link";
import { useState } from "react";
import { reportCategoryLabel, REPORT_STATUSES, reportStatusLabel, type ReportRow } from "../../../lib/report-types";
import { PlainField } from "../../../components/editor/PlainField";

type ReportsResponse = {
  ok: true;
  items: ReportRow[];
  counts: Record<string, number>;
};

async function fetchReports(status: string): Promise<ReportsResponse> {
  const res = await fetch(`/api/admin/reports?status=${status}`, {
    credentials: "same-origin",
  });
  if (!res.ok) throw new Error(`reports ${res.status}`);
  return res.json() as Promise<ReportsResponse>;
}

const STATUS_TONE = {
  orange: "border-dbz-orange/50 bg-dbz-orange/10 text-dbz-orange",
  blue: "border-dbz-blue-light/50 bg-dbz-blue-light/10 text-dbz-blue-light",
  green: "border-green-500/50 bg-green-500/10 text-green-400",
  muted: "border-white/20 bg-white/5 text-white/50",
};

function toneFor(status: string): string {
  const s = REPORT_STATUSES.find(x => x.key === status);
  const tone = s?.tone;
  switch (tone) {
    case "orange":
      return STATUS_TONE.orange;
    case "blue":
      return STATUS_TONE.blue;
    case "green":
      return STATUS_TONE.green;
    default:
      return STATUS_TONE.muted;
  }
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function SignalementsPage() {
  const [filter, setFilter] = useState<string>("open");
  const qc = useQueryClient();
  const key = ["admin-reports", filter];

  const q = useQuery({
    queryKey: key,
    queryFn: () => fetchReports(filter),
    refetchInterval: 60_000,
    placeholderData: prev => prev,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin-reports"] });

  const items = q.data?.items ?? [];
  const counts = q.data?.counts ?? {};

  const FILTERS = [
    { key: "open", label: "Ouverts" },
    { key: "in_progress", label: "En cours" },
    { key: "resolved", label: "Résolus" },
    { key: "closed", label: "Fermés" },
    { key: "all", label: "Tous" },
  ];

  return (
    <div className="space-y-6">
      <div className="dbz-panel px-6 py-5">
        <h1 className="flex items-center gap-3 font-saiyan text-3xl leading-tight text-dbz-yellow">
          <Drapeau className="h-7 w-7 text-dbz-orange" />
          Signalements
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/60">
          Remontées « Signaler une erreur » des membres connectés. Traite-les comme des tickets : ouvert → en cours →
          résolu. Distinct des tickets de support Discord.
        </p>
      </div>

      {/* Filtres par statut */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map(f => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-display font-semibold transition-colors ${
              filter === f.key
                ? "border-dbz-orange bg-dbz-orange text-black"
                : "border-dbz-border bg-dbz-bg/40 text-white/70 hover:bg-white/5 hover:text-white"
            }`}
          >
            {f.label}
            <span
              className={`rounded-full px-1.5 text-[11px] font-mono ${
                filter === f.key ? "bg-black/20" : "bg-white/10 text-white/60"
              }`}
            >
              {counts[f.key] ?? 0}
            </span>
          </button>
        ))}
        {q.isFetching && <Chargement className="h-4 w-4 animate-spin self-center text-white/50" />}
      </div>

      {q.isError && (
        <div className="card border-dbz-red/40">
          <p className="text-sm text-dbz-red">Impossible de charger les signalements.</p>
        </div>
      )}

      {items.length === 0 && !q.isLoading ? (
        <div className="dbz-panel py-16 text-center">
          <Drapeau className="mx-auto mb-3 h-8 w-8 text-white/20" />
          <p className="font-saiyan uppercase tracking-widest text-white/50">
            Aucun signalement {filter !== "all" ? reportStatusLabel(filter).toLowerCase() : ""}
          </p>
          <p className="mt-1 text-sm text-white/50">Les remontées des membres apparaîtront ici.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map(r => (
            <ReportCard key={r.id} report={r} onChanged={invalidate} />
          ))}
        </div>
      )}
    </div>
  );
}

function ReportCard({ report, onChanged }: { report: ReportRow; onChanged: () => void }) {
  const [note, setNote] = useState(report.adminNote ?? "");

  const patch = useMutation({
    mutationFn: (body: { status?: string; adminNote?: string }) =>
      fetch(`/api/admin/reports`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ id: report.id, ...body }),
      }).then(res => {
        if (!res.ok) throw new Error(`patch ${res.status}`);
      }),
    onSuccess: onChanged,
  });

  const remove = useMutation({
    mutationFn: () =>
      fetch(`/api/admin/reports?id=${report.id}`, {
        method: "DELETE",
        credentials: "same-origin",
      }).then(res => {
        if (!res.ok) throw new Error(`delete ${res.status}`);
      }),
    onSuccess: onChanged,
  });

  const busy = patch.isPending || remove.isPending;
  const noteDirty = note !== (report.adminNote ?? "");

  return (
    <div className="dbz-panel space-y-3 p-4">
      {/* En-tête */}
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider ${toneFor(report.status)}`}
        >
          {reportStatusLabel(report.status)}
        </span>
        <span className="rounded border border-white/15 bg-white/5 px-2 py-0.5 text-[11px] text-white/70">
          {reportCategoryLabel(report.category)}
        </span>
        <Link
          href={report.path}
          target="_blank"
          className="font-mono text-xs text-dbz-blue-light hover:underline"
          title={report.pageTitle ?? report.path}
        >
          {report.path}
        </Link>
        <span className="ml-auto text-[11px] text-white/50">{fmtDate(report.createdAt)}</span>
      </div>

      {/* Message */}
      <p className="whitespace-pre-wrap rounded-md border border-white/10 bg-dbz-bg/40 p-3 text-sm text-white/90">
        {report.message}
      </p>

      {/* Rapporteur */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-white/50">
        <span>
          Par <span className="text-white/75">{report.username ?? "?"}</span>
        </span>
        {report.discordId && <span className="font-mono">Discord ID : {report.discordId}</span>}
        {report.resolvedBy && <span>· traité par {report.resolvedBy}</span>}
      </div>

      {/* Note interne */}
      <div className="flex items-start gap-2">
        <Bulle className="mt-2 h-3.5 w-3.5 shrink-0 text-white/50" />
        <PlainField
          className="flex-1"
          value={note}
          onChange={setNote}
          minRows={1}
          maxRows={8}
          placeholder="Note interne (traitement)…"
        />
        {noteDirty && (
          <button
            type="button"
            disabled={busy}
            onClick={() => patch.mutate({ adminNote: note })}
            className="btn btn-ghost shrink-0 text-xs"
          >
            Enregistrer
          </button>
        )}
      </div>

      {/* Actions statut + suppression */}
      <div className="flex flex-wrap items-center gap-1.5 border-t border-white/10 pt-3">
        {REPORT_STATUSES.map(s => (
          <button
            key={s.key}
            type="button"
            disabled={busy || report.status === s.key}
            onClick={() => patch.mutate({ status: s.key })}
            className={`rounded border px-2.5 py-1 text-xs font-semibold transition-colors disabled:opacity-40 ${
              report.status === s.key
                ? toneFor(s.key)
                : "border-dbz-border text-white/60 hover:border-dbz-orange hover:text-white"
            }`}
          >
            {s.label}
          </button>
        ))}
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (window.confirm("Supprimer définitivement ce signalement ?")) remove.mutate();
          }}
          className="ml-auto inline-flex items-center gap-1 rounded border border-white/15 px-2.5 py-1 text-xs text-red-400 transition-colors hover:border-dbz-red hover:text-red-300 disabled:opacity-40"
        >
          <Corbeille className="h-3.5 w-3.5" /> Supprimer
        </button>
      </div>
    </div>
  );
}
