"use client";

import { useQuery } from "@tanstack/react-query";
import { Bulle, Eclair, Tendance, Trophee } from "@shenron/ui/icones";
import { api } from "@aphrody/admin-ui/client";
import { fmtNum } from "@aphrody/admin-ui/format";
import { formatZeni } from "@/lib/zeni";

interface User {
  id: string;
  xp: number;
  zeni: number;
  lastLevelReached: number;
}

/** Enveloppe de `/stats/totals` — chaque total peut manquer si le bot répond partiellement. */
interface TotalsResponse {
  stats?: {
    totalUsers?: number;
    totalActiveUsers?: number;
    totalCommands?: number;
  };
}

export default function StatsPage() {
  const totals = useQuery({
    queryKey: ["stats", "totals"],
    queryFn: () => api.get<TotalsResponse>("/stats/totals"),
  });
  const top = useQuery({
    queryKey: ["bot", "users", "top"],
    queryFn: () => api.get<{ users: User[] }>("/levels/top?metric=xp&limit=20"),
  });

  // Diviseur des barres : jamais 0 (le premier joueur peut être à 0 XP sur un
  // serveur neuf → largeur NaN et barres invisibles).
  const maxXp = Math.max(1, top.data?.users[0]?.xp ?? 0);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MiniStat
          icon={<Bulle className="h-4 w-4" />}
          title="Total joueurs"
          value={fmtNum(totals.data?.stats?.totalUsers)}
        />
        <MiniStat
          icon={<Tendance className="h-4 w-4" />}
          title="Joueurs actifs"
          value={fmtNum(totals.data?.stats?.totalActiveUsers)}
        />
        <MiniStat icon={<Trophee className="h-4 w-4" />} title="Top XP" value={fmtNum(top.data?.users[0]?.xp)} />
        <MiniStat
          icon={<Eclair className="h-4 w-4" />}
          title="Total commandes"
          value={fmtNum(totals.data?.stats?.totalCommands)}
        />
      </div>

      <div className="card">
        <h2 className="mb-4 text-lg font-semibold">Classement — top 20 par XP</h2>
        <div className="space-y-2">
          {top.data?.users.map((u, i) => (
            <div key={u.id} className="flex items-center gap-3">
              <span className="w-8 text-right font-mono text-xs text-zinc-500">#{i + 1}</span>
              <code className="w-32 truncate text-xs">{u.id}</code>
              <div className="relative flex-1">
                <div className="h-6 rounded bg-zinc-800">
                  <div
                    className="h-full rounded bg-gradient-to-r from-brand-600 to-brand-400 transition-all"
                    style={{ width: `${((u.xp ?? 0) / maxXp) * 100}%` }}
                  />
                </div>
              </div>
              <span className="w-24 text-right font-mono text-xs">{(u.xp ?? 0).toLocaleString("fr-FR")} XP</span>
              <span className="w-20 text-right font-mono text-xs text-amber-400">{formatZeni(u.zeni ?? 0)}</span>
              <span className="w-16 text-right font-mono text-xs text-zinc-500">niveau {u.lastLevelReached ?? 0}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MiniStat({ icon, title, value }: { icon: React.ReactNode; title: string; value: string }) {
  return (
    <div className="card">
      <div className="mb-2 flex items-center gap-2 text-zinc-400">
        {icon}
        <h3 className="text-xs font-medium uppercase tracking-wide">{title}</h3>
      </div>
      <p className="text-3xl font-bold text-brand-400">{value}</p>
    </div>
  );
}
