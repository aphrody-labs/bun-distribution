"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Alerte, Bulle, Chargement, Flamme, Micro, Piece, Trophee } from "@/components/icones";
import { api } from "@aphrody/admin-ui/client";
import { formatDuration } from "@aphrody/admin-ui/format";
import { formatZeni } from "@/lib/zeni";

const METRICS = [
  { key: "xp", label: "XP", color: "text-fuchsia-300", icon: Trophee },
  { key: "zeni", label: "Zénis", color: "text-yellow-300", icon: Piece },
  { key: "voice", label: "Temps vocal", color: "text-cyan-300", icon: Micro },
  {
    key: "messages",
    label: "Messages",
    color: "text-violet-300",
    icon: Bulle,
  },
  { key: "streak", label: "Streak quête", color: "text-pink-300", icon: Flamme },
] as const;

type Metric = (typeof METRICS)[number]["key"];

// Forme réelle retournée par /api/levels/top
interface TopUser {
  id: string;
  xp: number;
  zeni: number;
  lastLevelReached: number;
  messageCount: number;
  totalVoiceMs: number;
  dailyStreak: number;
}

function formatValue(u: TopUser, metric: Metric): string {
  switch (metric) {
    case "voice":
      return formatDuration(u.totalVoiceMs);
    case "streak":
      return `${u.dailyStreak} jour${u.dailyStreak !== 1 ? "s" : ""}`;
    case "messages":
      return `${u.messageCount.toLocaleString("fr-FR")} msg`;
    case "zeni":
      return formatZeni(u.zeni);
    default:
      return `${u.xp.toLocaleString("fr-FR")} XP`;
  }
}

function LeaderboardInner() {
  const searchParams = useSearchParams();
  const metricParam = searchParams.get("metric") ?? "xp";
  const metric = (METRICS.find((m) => m.key === metricParam)?.key ?? "xp") as Metric;
  const tint = METRICS.find((m) => m.key === metric)?.color ?? "text-fuchsia-300";

  const { data, isLoading, isError } = useQuery({
    queryKey: ["leaderboard", metric],
    // Bug corrigé : l'API retourne { users: [...] } et non { top: [...] }
    queryFn: () =>
      api.get<{ metric: string; limit: number; users: TopUser[] }>(
        `/levels/top?metric=${metric}&limit=50`,
      ),
    staleTime: 30_000,
  });

  return (
    <div className="w-full max-w-5xl mx-auto space-y-4">
      <div className="dbz-panel p-4">
        <div className="flex items-center gap-3 mb-1">
          <Trophee className="h-6 w-6 text-dbz-orange" />
          <h1 className="font-saiyan text-2xl text-dbz-orange tracking-widest">CLASSEMENTS</h1>
        </div>
        <p className="text-sm text-white/60">
          Top 50 membres du serveur. Clique sur une métrique pour changer le classement.
        </p>
      </div>

      {/* Sélecteur de métrique */}
      <div className="flex flex-wrap gap-2">
        {METRICS.map((m) => {
          const Icon = m.icon;
          return (
            <Link
              key={m.key}
              href={`?metric=${m.key}`}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 border rounded-md text-xs uppercase tracking-widest transition-colors ${
                m.key === metric
                  ? `${m.color} border-current bg-current/10 font-bold`
                  : "border-dbz-border text-white/50 hover:border-white/40 hover:text-white/70"
              }`}
            >
              <Icon className="h-3 w-3" />
              {m.label}
            </Link>
          );
        })}
      </div>

      {/* État chargement */}
      {isLoading && (
        <div className="dbz-panel p-8 flex items-center justify-center gap-3 text-white/50">
          <Chargement className="h-5 w-5 animate-spin" />
          <span>Chargement du classement…</span>
        </div>
      )}

      {/* État erreur */}
      {isError && (
        <div className="dbz-panel p-6 flex items-center gap-3 text-red-400 border-red-500/40">
          <Alerte className="h-5 w-5 shrink-0" />
          <div>
            <p className="font-semibold">Impossible de charger le classement.</p>
            <p className="text-xs text-white/50 mt-0.5">
              Vérifiez que le bot est en ligne puis rechargez la page.
            </p>
          </div>
        </div>
      )}

      {/* Tableau */}
      {data && (
        <div className="dbz-panel overflow-x-auto">
          <table className="w-full min-w-[520px] text-xs">
            <thead className="border-b-2 border-dbz-border">
              <tr>
                <th className="p-3 text-right w-10 font-bold uppercase tracking-widest text-dbz-blue-light">
                  #
                </th>
                <th className="p-3 text-left font-bold uppercase tracking-widest text-dbz-blue-light">
                  Membre
                </th>
                <th className="p-3 text-right font-bold uppercase tracking-widest text-dbz-blue-light">
                  Niveau
                </th>
                <th className={`p-3 text-right font-bold uppercase tracking-widest ${tint}`}>
                  {METRICS.find((m) => m.key === metric)?.label ?? metric}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dbz-border">
              {data.users.map((u, i) => (
                <tr key={u.id} className="hover:bg-dbz-blue-light/5 transition-colors">
                  <td className="p-3 text-right font-saiyan text-dbz-blue-light">
                    {i === 0 ? (
                      <span className="text-yellow-400">1</span>
                    ) : i === 1 ? (
                      <span className="text-zinc-400">2</span>
                    ) : i === 2 ? (
                      <span className="text-amber-600">3</span>
                    ) : (
                      i + 1
                    )}
                  </td>
                  <td className="p-3">
                    {/* Affiche l'ID Discord de façon discrète — pas d'info pseudo disponible ici */}
                    <span className="font-mono text-white/80 text-[11px]">{u.id}</span>
                  </td>
                  <td className="p-3 text-right font-saiyan text-fuchsia-300">
                    {u.lastLevelReached > 0 ? u.lastLevelReached : "—"}
                  </td>
                  <td className={`p-3 text-right font-mono font-semibold ${tint}`}>
                    {formatValue(u, metric)}
                  </td>
                </tr>
              ))}
              {data.users.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-white/50">
                    Aucun joueur enregistré pour cette métrique.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {data.users.length > 0 && (
            <p className="p-3 text-[10px] text-white/50 text-right border-t border-dbz-border">
              {data.users.length} membre{data.users.length !== 1 ? "s" : ""} affichés
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function LeaderboardsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center gap-3 p-12 text-white/50">
          <Chargement className="h-5 w-5 animate-spin" />
          <span>Chargement…</span>
        </div>
      }
    >
      <LeaderboardInner />
    </Suspense>
  );
}
