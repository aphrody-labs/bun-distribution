"use client";

import { useQuery } from "@tanstack/react-query";
import { Terminal, RefreshCw } from "lucide-react";
import { useState } from "react";
import { api } from "@aphrody/admin-ui/client";

interface LogEntry {
  time?: string;
  host?: string;
  unit?: string;
  message?: string;
  raw?: string;
}

export default function Logs() {
  const [lines, setLines] = useState(100);
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["logs", lines],
    queryFn: () => api.get<{ logs: LogEntry[]; count: number }>(`/health/logs?lines=${lines}`),
    refetchInterval: 10_000,
  });

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="flex items-center gap-2">
          <Terminal className="h-5 w-5 text-brand-400" />
          <h2 className="text-lg font-semibold">Journaux du service</h2>
        </div>
        <p className="mt-1 text-sm text-zinc-400">
          Sortie de <code>journalctl -u shenron</code> en temps réel. Actualisation automatique toutes les 10 secondes.
        </p>
      </div>

      <div className="card flex items-center gap-3">
        <label className="text-sm text-zinc-400">Lignes affichées</label>
        <select className="input w-32" value={lines} onChange={e => setLines(Number(e.target.value))}>
          {[50, 100, 200, 500].map(n => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => refetch()} disabled={isFetching} className="btn btn-ghost ml-auto">
          <RefreshCw className={`h-3 w-3 ${isFetching ? "animate-spin" : ""}`} />
          Actualiser
        </button>
      </div>

      {isLoading ? (
        <div className="text-zinc-500">Chargement en cours…</div>
      ) : (
        <div className="card overflow-x-auto bg-zinc-950 p-3 font-mono text-xs">
          {data?.logs.map((log, i) => (
            <div key={i} className="whitespace-pre-wrap py-0.5">
              {log.raw ? (
                <span className="text-zinc-300">{log.raw}</span>
              ) : (
                <>
                  <span className="text-zinc-500">{log.time}</span>
                  {" — "}
                  <span className={colorize(log.message ?? "")}>{log.message}</span>
                </>
              )}
            </div>
          ))}
          {data?.logs.length === 0 && <p className="italic text-zinc-500">Aucun journal pour l'instant.</p>}
        </div>
      )}
    </div>
  );
}

function colorize(message: string): string {
  if (/\bERROR\b|\berror\b|\bFAIL\b|\bfail\b/.test(message)) return "text-red-400";
  if (/\bWARN\b|\bwarn\b/.test(message)) return "text-amber-400";
  if (/\bINFO\b|\binfo\b|✓/.test(message)) return "text-green-400";
  return "text-zinc-300";
}
