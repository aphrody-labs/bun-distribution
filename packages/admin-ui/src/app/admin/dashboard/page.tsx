"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowUpRight,
  BookOpen,
  CircleAlert,
  Coins,
  Command,
  Cpu,
  Database,
  MessageSquare,
  Radio,
  RefreshCw,
  Server,
  Settings,
  Shield,
  TrendingUp,
  Users,
} from "lucide-react";
import { api } from "@aphrody/admin-ui/client";
import { formatBytes, formatDuration, fmtNum } from "@aphrody/admin-ui/format";
import { useBots, type BotSummary } from "@aphrody/admin-ui/components/admin/BotSelector";

type MonitoringResponse = {
  botStatus: { online: boolean; uptime: number | null };
  pid: { cpu: number; memory: number; uptime: number; rss: number };
  host: {
    cpu: { count: number; usage: number };
    memory: { total: number; free: number; used: number; usage: number };
    platform: string;
    uptime: number;
  };
  latency: { ws: number; db: number };
};

type TotalsResponse = {
  stats: {
    totalUsers: number;
    totalGuilds: number;
    totalActiveUsers: number;
    totalCommands: number;
  };
};

type LiveService = {
  id: "api" | "database" | "redis" | "backOffice";
  label: string;
  state: "ok" | "degraded" | "down" | "unknown";
  latencyMs: number | null;
  detail: string;
};

type LiveDashboardResponse = {
  services: LiveService[];
  agents: {
    activePeers: string[];
    recentActivity: number;
    activeTasks: number;
    latestActivityAt: string | null;
  };
  sampledAt: string;
  refreshAfterMs: number;
};

async function getLiveDashboard(): Promise<LiveDashboardResponse> {
  const response = await fetch("/api/admin/dashboard-live", {
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Sonde live indisponible (HTTP ${response.status})`);
  return response.json() as Promise<LiveDashboardResponse>;
}

const QUICK_ACTIONS = [
  {
    href: "/admin/wiki",
    label: "Encyclopédie Dragon Ball",
    description: "Wiki, sagas, films et jeux",
    icon: BookOpen,
  },
  {
    href: "/admin/levels",
    label: "Membres & niveaux",
    description: "Progression et activité des membres",
    icon: TrendingUp,
  },
  {
    href: "/admin/moderation",
    label: "Modération",
    description: "Sanctions, rôles et sécurité",
    icon: Shield,
  },
  {
    href: "/admin/economy",
    label: "Économie",
    description: "Zénis, boutique et transactions",
    icon: Coins,
  },
  {
    href: "/admin/send",
    label: "Envoyer un message",
    description: "Diffuser une annonce via le bot",
    icon: MessageSquare,
  },
  {
    href: "/admin/settings",
    label: "Paramètres",
    description: "Configurer le comportement du bot",
    icon: Settings,
  },
];

const SERVICE_COPY: Record<LiveService["id"], { label: string; description: string }> = {
  api: {
    label: "Application du bot",
    description: "Permet au site et à Discord de communiquer.",
  },
  database: {
    label: "Données du site",
    description: "Conserve les membres, articles et réglages.",
  },
  redis: {
    label: "Mémoire rapide",
    description: "Accélère l’affichage et les recherches.",
  },
  backOffice: {
    label: "Commandes d’administration",
    description: "Permet au tableau de bord d’agir sur le bot.",
  },
};

export default function DashboardPage() {
  const bots = useBots();
  const health = useQuery({
    queryKey: ["health", "monitoring"],
    queryFn: () => api.get<MonitoringResponse>("/health/monitoring"),
    refetchInterval: 30_000,
  });
  const stats = useQuery({
    queryKey: ["stats", "totals"],
    queryFn: () => api.get<TotalsResponse>("/stats/totals"),
    refetchInterval: 60_000,
  });
  const live = useQuery({
    queryKey: ["admin", "dashboard-live"],
    queryFn: getLiveDashboard,
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
  });

  const onlineCount = bots.data?.bots.filter(bot => bot.online).length ?? 0;
  const totalCount = bots.data?.bots.length ?? 0;
  const avgPing =
    bots.data && onlineCount > 0
      ? Math.round(
          bots.data.bots.filter(bot => bot.online).reduce((sum, bot) => sum + Math.max(0, bot.wsPing), 0) /
            Math.max(1, onlineCount),
        )
      : null;
  const hasError = bots.isError || health.isError || stats.isError;
  const unavailableServices =
    live.data?.services.filter(service => service.state === "down" || service.state === "degraded") ?? [];
  const allLiveServicesHealthy = live.data?.services.length === 4 && unavailableServices.length === 0;
  const refresh = () => {
    void bots.refetch();
    void health.refetch();
    void stats.refetch();
    void live.refetch();
  };

  return (
    <div className="mx-auto max-w-[1440px] space-y-8 pb-8">
      <header className="flex flex-col gap-5 rounded-2xl border border-white/10 bg-white/[0.035] p-4 shadow-sm md:flex-row md:items-center md:justify-between md:p-6">
        <div>
          <p className="text-xs font-medium text-white/55">Administration</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white md:text-3xl">
            Bonjour, voici votre espace de pilotage
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-white/60">
            Retrouvez ici ce qui fonctionne, ce qui mérite votre attention et les actions les plus utiles.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/admin/live"
            className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-blue-500 px-4 text-sm font-medium text-white transition-colors hover:bg-blue-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300"
          >
            Voir l’activité en direct <ArrowUpRight className="h-4 w-4" />
          </Link>
          <Link
            href="/admin/console"
            className="inline-flex min-h-12 items-center gap-2 rounded-xl px-4 text-sm font-medium text-white/80 transition-colors hover:bg-white/[.08] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            <Command className="h-4 w-4" /> Ouvrir la console
          </Link>
        </div>
      </header>

      {hasError && (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-xl border border-amber-300/25 bg-amber-300/[.08] p-4 text-sm text-amber-100 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="flex items-start gap-2">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            Certains indicateurs ne répondent pas. Les valeurs manquantes ne sont pas interprétées comme des zéros.
          </p>
          <button
            type="button"
            onClick={refresh}
            className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-xl px-4 font-medium hover:bg-white/10"
          >
            <RefreshCw className="h-4 w-4" /> Réessayer
          </button>
        </div>
      )}

      <section
        aria-labelledby="live-operations-title"
        className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 md:p-6"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-blue-300">Actualisé automatiquement</p>
            <h2 id="live-operations-title" className="mt-1 text-lg font-semibold text-white">
              Est-ce que tout fonctionne ?
            </h2>
            <p className="mt-1 text-sm text-white/50">
              Nous vérifions les éléments indispensables au fonctionnement du site et du bot.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-white/45">
            <Radio className={`h-3.5 w-3.5 ${live.isFetching ? "animate-pulse text-blue-300" : ""}`} />
            {live.data
              ? `Mesuré à ${new Date(live.data.sampledAt).toLocaleTimeString("fr-FR")}`
              : "Connexion aux sondes…"}
          </div>
        </div>
        {live.isError ? (
          <p
            role="alert"
            className="mt-4 rounded-xl border border-amber-300/25 bg-amber-300/[.08] p-3 text-sm text-amber-100"
          >
            Les sondes live sont indisponibles. Les autres métriques conservent leur dernière valeur connue.
          </p>
        ) : (
          <>
            <LiveSummary
              healthy={allLiveServicesHealthy}
              unavailableCount={unavailableServices.length}
              loading={!live.data}
            />
            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {live.data?.services.map(service => <LiveServiceCard key={service.id} service={service} />) ??
                Array.from({ length: 4 }, (_, index) => (
                  <div key={index} className="h-28 animate-pulse rounded-xl bg-white/[.04]" />
                ))}
            </div>
            <AgentActivity agents={live.data?.agents} />
          </>
        )}
      </section>

      <section aria-labelledby="quick-actions-title">
        <div className="flex items-center justify-between">
          <div>
            <h2 id="quick-actions-title" className="text-lg font-semibold text-white">
              Accès rapides
            </h2>
            <p className="mt-1 text-sm text-white/50">Les opérations les plus fréquentes</p>
          </div>
          <span className="hidden text-sm text-white/45 sm:inline-flex sm:items-center sm:gap-1">
            {QUICK_ACTIONS.length} raccourcis <ArrowUpRight className="h-4 w-4" />
          </span>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {QUICK_ACTIONS.map(({ href, label, description, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="group flex min-h-24 items-center gap-4 rounded-xl border border-white/10 bg-white/[.025] p-4 transition-colors hover:bg-white/[.07] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300"
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/[.08] text-blue-300">
                <Icon className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="font-medium text-white">{label}</p>
                <p className="mt-1 text-sm leading-5 text-white/55">{description}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section aria-labelledby="system-health-title">
        <div className="mb-4 flex items-end justify-between">
          <div>
            <h2 id="system-health-title" className="text-lg font-semibold text-white">
              Votre communauté en un coup d’œil
            </h2>
            <p className="mt-1 text-sm text-white/50">Les chiffres utiles pour suivre votre serveur.</p>
          </div>
          <span className="inline-flex items-center gap-1.5 text-xs text-white/45">
            <RefreshCw className="h-3.5 w-3.5" /> Mise à jour auto
          </span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Bots en ligne" icon={<Server className="h-5 w-5" />}>
            <Metric value={onlineCount} suffix={` / ${totalCount}`} />
            <MetricHelp>
              {totalCount > 0
                ? onlineCount === totalCount
                  ? "Tous opérationnels"
                  : `${totalCount - onlineCount} hors ligne`
                : "—"}
            </MetricHelp>
          </KpiCard>
          <KpiCard label="Joueurs en base" icon={<Users className="h-5 w-5" />}>
            <Metric value={stats.data ? fmtNum(stats.data.stats.totalUsers) : "—"} />
            <MetricHelp>
              {stats.data
                ? `${fmtNum(stats.data.stats.totalActiveUsers)} actifs · ${fmtNum(stats.data.stats.totalGuilds)} serveur${stats.data.stats.totalGuilds > 1 ? "s" : ""}`
                : "—"}
            </MetricHelp>
          </KpiCard>
          <KpiCard label="Réactivité du bot" icon={<Activity className="h-5 w-5" />}>
            <Metric value={avgPing ?? "—"} suffix=" ms" />
            <MetricHelp>
              {avgPing === null
                ? "Mesure en cours"
                : avgPing < 200
                  ? "Réponse rapide"
                  : "Le bot répond plus lentement que d’habitude"}
            </MetricHelp>
          </KpiCard>
          <KpiCard label="Ressources utilisées" icon={<Cpu className="h-5 w-5" />}>
            <Metric
              value={health.data ? (formatBytes(health.data.pid.rss).split(" ")[0] ?? "—") : "—"}
              suffix={health.data ? ` ${formatBytes(health.data.pid.rss).split(" ")[1]}` : ""}
            />
            <MetricHelp>Utilisation par le bot ; un détail n’est utile qu’en cas de ralentissement.</MetricHelp>
          </KpiCard>
        </div>
      </section>

      <section aria-labelledby="bots-title">
        <h2 id="bots-title" className="text-lg font-semibold text-white">
          Bots connectés à Discord
        </h2>
        <p className="mt-1 text-sm text-white/50">Chaque carte représente un bot qui peut répondre aux membres.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {bots.isPending ? (
            Array.from({ length: 3 }, (_, index) => (
              <div key={index} className="h-28 animate-pulse rounded-xl bg-white/[.04]" />
            ))
          ) : bots.isError ? (
            <EmptyState text="Inventaire des bots indisponible." />
          ) : bots.data.bots.length ? (
            bots.data.bots.map(bot => <BotCard key={bot.id} bot={bot} />)
          ) : (
            <EmptyState text="Aucun client Gateway déclaré." />
          )}
        </div>
      </section>

      <section aria-labelledby="host-title" className="rounded-xl border border-white/10 bg-white/[.025] p-4 md:p-6">
        <h2 id="host-title" className="text-lg font-semibold text-white">
          Machine hôte
        </h2>
        {health.data ? (
          <dl className="mt-4 grid gap-x-8 sm:grid-cols-2">
            <HostMetric label="Système d’exploitation" value={health.data.host.platform} />
            <HostMetric label="Cœurs CPU" value={health.data.host.cpu.count} />
            <HostMetric
              label="Mémoire"
              value={`${formatBytes(health.data.host.memory.used)} / ${formatBytes(health.data.host.memory.total)} (${health.data.host.memory.usage} %)`}
            />
            <HostMetric label="Temps de fonctionnement" value={formatDuration(health.data.host.uptime * 1000)} />
          </dl>
        ) : (
          <p className="mt-4 text-sm text-white/50">Connexion à la machine hôte…</p>
        )}
      </section>
    </div>
  );
}

function KpiCard({ label, icon, children }: { label: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <article className="rounded-xl border border-white/10 bg-white/[.025] p-4 md:p-5">
      <div className="flex items-center gap-3 text-white/60">
        <span className="text-blue-300">{icon}</span>
        <h3 className="text-sm font-medium">{label}</h3>
      </div>
      <div className="mt-5">{children}</div>
    </article>
  );
}

function Metric({ value, suffix = "" }: { value: string | number; suffix?: string }) {
  return (
    <p className="font-mono text-3xl font-semibold tracking-tight text-white tabular-nums">
      {value}
      <span className="text-base font-normal text-white/45">{suffix}</span>
    </p>
  );
}

function MetricHelp({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 text-sm leading-5 text-white/50">{children}</p>;
}

function HostMetric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-white/10 py-3 text-sm">
      <dt className="text-white/50">{label}</dt>
      <dd className="text-right font-medium text-white/85">{value}</dd>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="rounded-xl border border-dashed border-white/10 p-5 text-sm text-white/50">{text}</p>;
}

function LiveSummary({
  healthy,
  unavailableCount,
  loading,
}: {
  healthy: boolean;
  unavailableCount: number;
  loading: boolean;
}) {
  if (loading) return <div className="mt-4 h-12 animate-pulse rounded-xl bg-white/[.04]" />;
  const message = healthy
    ? "Tout fonctionne normalement. Aucune intervention n’est nécessaire."
    : unavailableCount > 0
      ? `${unavailableCount} élément${unavailableCount > 1 ? "s demandent" : " demande"} votre attention. Consultez les cartes ci-dessous pour comprendre l’impact.`
      : "La vérification est en cours. Nous affichons les informations disponibles.";
  return (
    <p
      className={`mt-4 flex items-start gap-2 rounded-xl p-3 text-sm ${healthy ? "bg-emerald-400/10 text-emerald-100" : "bg-amber-300/[.08] text-amber-100"}`}
    >
      <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${healthy ? "bg-emerald-400" : "bg-amber-300"}`} />
      {message}
    </p>
  );
}

function LiveServiceCard({ service }: { service: LiveService }) {
  const stateStyle = {
    ok: "bg-emerald-400",
    degraded: "bg-amber-300",
    down: "bg-rose-400",
    unknown: "bg-white/35",
  }[service.state];
  const icon =
    service.id === "database" || service.id === "redis" ? (
      <Database className="h-5 w-5" />
    ) : (
      <Activity className="h-5 w-5" />
    );
  const stateLabel = {
    ok: "Disponible",
    degraded: "À vérifier",
    down: "Indisponible",
    unknown: "Non mesuré",
  }[service.state];
  const copy = SERVICE_COPY[service.id];
  return (
    <article className="rounded-xl border border-white/10 bg-black/10 p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="text-blue-300">{icon}</span>
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-white/70">
          <span className={`h-2 w-2 rounded-full ${stateStyle}`} />
          {stateLabel}
        </span>
      </div>
      <h3 className="mt-4 text-sm font-medium text-white">{copy.label}</h3>
      <p className="mt-1 text-sm leading-5 text-white/50">{copy.description}</p>
      <details className="mt-3 text-xs text-white/45">
        <summary className="cursor-pointer text-white/60 hover:text-white">Voir le détail technique</summary>
        <p className="mt-2 break-words">
          {service.detail}
          {service.latencyMs === null ? "" : ` · réponse en ${service.latencyMs} ms`}
        </p>
      </details>
    </article>
  );
}

function AgentActivity({ agents }: { agents: LiveDashboardResponse["agents"] | undefined }) {
  return (
    <div className="mt-4 flex flex-col gap-3 rounded-xl border border-white/10 bg-black/10 p-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-blue-400/10 text-blue-300">
          <Radio className="h-5 w-5" />
        </span>
        <div>
          <h3 className="text-sm font-medium text-white">Travail automatisé</h3>
          <p className="mt-1 text-sm text-white/50">
            {agents
              ? agents.recentActivity > 0
                ? `${agents.activeTasks} tâche${agents.activeTasks > 1 ? "s" : ""} automatisée${agents.activeTasks > 1 ? "s" : ""} en cours ; les derniers échanges sont affichés à droite.`
                : "Aucune tâche automatisée n’a communiqué récemment."
              : "Vérification des automatisations en cours…"}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {agents?.activePeers.length ? (
          agents.activePeers.map(peer => (
            <span key={peer} className="rounded-lg bg-white/[.08] px-2.5 py-1 text-xs text-white/70">
              {peer}
            </span>
          ))
        ) : (
          <span className="text-sm text-white/45">Aucune activité récente</span>
        )}
      </div>
    </div>
  );
}

function BotCard({ bot }: { bot: BotSummary }) {
  return (
    <article
      className={`flex min-h-28 gap-3 rounded-xl border border-white/10 bg-white/[.025] p-4 ${bot.online ? "" : "opacity-60"}`}
      title={bot.username ?? bot.name}
    >
      {bot.avatar ? (
        <img src={bot.avatar} alt="" className={`h-12 w-12 shrink-0 rounded-full ${bot.online ? "" : "grayscale"}`} />
      ) : (
        <div className="h-12 w-12 shrink-0 rounded-full bg-white/10" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="truncate font-medium text-white">{bot.name}</h3>
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${bot.online ? "bg-emerald-400" : "bg-rose-400"}`}
            title={bot.online ? "En ligne" : "Hors ligne"}
          />
        </div>
        <p className="mt-1 text-sm text-white/50">
          {bot.online ? (
            <>
              {bot.wsPing} ms · actif depuis {bot.uptime ? formatDuration(bot.uptime) : "—"}
            </>
          ) : (
            "Hors ligne"
          )}
        </p>
        <p className="mt-2 text-sm text-white/65">
          {bot.commandCount} commande{bot.commandCount > 1 ? "s" : ""} · {bot.guildCount} serveur
          {bot.guildCount > 1 ? "s" : ""}
        </p>
      </div>
    </article>
  );
}
