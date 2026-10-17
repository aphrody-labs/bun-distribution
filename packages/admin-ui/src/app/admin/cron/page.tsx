"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Play, Clock, Save, Pencil, CheckCircle, XCircle, AlertCircle } from "lucide-react";
import { useState } from "react";
import { api } from "@aphrody/admin-ui/client";
import { formatDuration, formatRelative } from "@aphrody/admin-ui/format";

interface CronJob {
  name: string;
  description: string | null;
  intervalMs: number;
  lastRunAt: number | null;
  lastDurationMs: number | null;
  runCount: number;
  lastError: string | null;
  nextRunAt: number | null;
}

function humanInterval(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `toutes les ${s} secondes`;
  const m = Math.round(s / 60);
  if (m < 60) return `toutes les ${m} minute${m > 1 ? "s" : ""}`;
  const h = Math.round(m / 60);
  return `toutes les ${h} heure${h > 1 ? "s" : ""}`;
}

function formatMs(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} s`;
}

function JobStatus({ job }: { job: CronJob }) {
  if (job.lastError) {
    return (
      <span className="inline-flex items-center gap-1 text-red-400 text-xs font-medium">
        <XCircle className="h-3.5 w-3.5" />
        Erreur
      </span>
    );
  }
  if (job.lastRunAt) {
    return (
      <span className="inline-flex items-center gap-1 text-green-400 text-xs font-medium">
        <CheckCircle className="h-3.5 w-3.5" />
        OK
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-zinc-400 text-xs font-medium">
      <AlertCircle className="h-3.5 w-3.5" />
      Jamais lancé
    </span>
  );
}

export default function CronPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["cron"],
    queryFn: () => api.get<{ jobs: CronJob[] }>("/cron"),
    refetchInterval: 5_000,
  });

  const trigger = useMutation({
    mutationFn: (name: string) => api.post(`/cron/${name}/trigger`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cron"] }),
  });

  const updateInterval = useMutation({
    mutationFn: ({ name, intervalMs }: { name: string; intervalMs: number }) =>
      api.post(`/cron/${name}/interval`, { intervalMs }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cron"] }),
  });

  function handleTrigger(job: CronJob) {
    if (
      !confirm(
        `Déclencher la tâche « ${job.name} » maintenant ?\n\nCela l'exécute immédiatement, en dehors de son cycle normal.`,
      )
    )
      return;
    trigger.mutate(job.name);
  }

  if (isLoading) return <div className="text-zinc-500 text-sm">Chargement des tâches…</div>;

  return (
    <div className="space-y-4">
      <div className="dbz-panel p-4">
        <h2 className="text-lg font-saiyan text-dbz-orange uppercase">Tâches automatiques</h2>
        <p className="mt-2 text-sm text-zinc-300">
          Ce sont les actions que le bot répète en boucle toutes les N secondes/minutes : il s'en charge seul, sans
          intervention humaine. Exemples : vérifier les expirations de sanctions, nettoyer les données obsolètes,
          envoyer un tick vocal XP.
        </p>
        <p className="mt-1 text-xs text-dbz-blue-light">
          Rafraîchissement automatique toutes les 5 secondes · {data?.jobs.length ?? 0} tâche
          {(data?.jobs.length ?? 0) > 1 ? "s" : ""} enregistrée
          {(data?.jobs.length ?? 0) > 1 ? "s" : ""}
        </p>
      </div>

      {data?.jobs.length === 0 && (
        <div className="dbz-panel p-8 text-center text-zinc-500 text-sm">Aucune tâche automatique enregistrée.</div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {data?.jobs.map(job => (
          <div
            key={job.name}
            className={`dbz-panel p-4 border-l-4 ${
              job.lastError ? "border-red-500" : job.lastRunAt ? "border-green-500" : "border-zinc-600"
            }`}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-mono text-sm font-semibold text-dbz-orange">{job.name}</h3>
                  <JobStatus job={job} />
                </div>
                {job.description && <p className="text-xs text-zinc-300">{job.description}</p>}
                <p className="text-xs text-dbz-blue-light mt-0.5">{humanInterval(job.intervalMs)}</p>
              </div>
              <button
                type="button"
                onClick={() => handleTrigger(job)}
                disabled={trigger.isPending}
                className="dbz-button !text-xs !px-3 !py-1.5 shrink-0"
                title="Déclencher maintenant (hors cycle)"
              >
                <Play className="h-3 w-3 inline-block mr-1" />
                Lancer
              </button>
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <div>
                <dt className="text-zinc-500 mb-0.5">Cadence</dt>
                <dd className="font-medium text-zinc-200">
                  <IntervalEditor
                    job={job}
                    onSave={intervalMs => updateInterval.mutate({ name: job.name, intervalMs })}
                    saving={updateInterval.isPending}
                  />
                </dd>
              </div>
              <div>
                <dt className="text-zinc-500 mb-0.5">Nombre d'exécutions</dt>
                <dd className="font-medium text-zinc-200">{job.runCount.toLocaleString("fr-FR")}</dd>
              </div>
              <div>
                <dt className="text-zinc-500 mb-0.5">Dernière exécution</dt>
                <dd className="font-medium text-zinc-200">
                  {formatRelative(job.lastRunAt)}
                  {job.lastDurationMs !== null && (
                    <span className="text-zinc-500 ml-1">({formatMs(job.lastDurationMs)})</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-zinc-500 mb-0.5">Prochaine exécution</dt>
                <dd className="flex items-center gap-1 font-medium text-zinc-200">
                  <Clock className="h-3 w-3 text-dbz-blue-light" />
                  {formatRelative(job.nextRunAt)}
                </dd>
              </div>
            </dl>

            {job.lastError && (
              <div className="mt-3 rounded border border-red-800 bg-red-900/20 p-2 text-xs text-red-300">
                <span className="font-semibold">Dernière erreur :</span> {job.lastError}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function IntervalEditor({
  job,
  onSave,
  saving,
}: {
  job: CronJob;
  onSave: (intervalMs: number) => void;
  saving: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(Math.round(job.intervalMs / 1000)));

  if (!editing) {
    return (
      <span className="inline-flex items-center gap-1">
        {formatDuration(job.intervalMs)}
        <button
          type="button"
          onClick={() => {
            setValue(String(Math.round(job.intervalMs / 1000)));
            setEditing(true);
          }}
          className="text-zinc-500 hover:text-dbz-orange transition-colors px-1"
          title="Modifier la cadence"
        >
          <Pencil className="h-3 w-3" />
        </button>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="number"
        min={1}
        value={value}
        onChange={e => setValue(e.target.value)}
        className="w-20 bg-dbz-bg border border-dbz-border px-1 py-0 text-xs rounded"
        aria-label="Intervalle en secondes"
      />
      <span className="text-zinc-500">s</span>
      <button
        type="button"
        onClick={() => {
          const sec = Number.parseInt(value, 10);
          if (!Number.isFinite(sec) || sec < 1) return;
          onSave(sec * 1000);
          setEditing(false);
        }}
        disabled={saving}
        className="text-green-400 hover:text-green-300 px-1"
        title="Enregistrer"
      >
        <Save className="h-3 w-3" />
      </button>
      <button
        type="button"
        onClick={() => setEditing(false)}
        className="text-zinc-500 hover:text-zinc-300 px-1"
        title="Annuler"
      >
        ✕
      </button>
    </span>
  );
}
