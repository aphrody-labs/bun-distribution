import { useQuery } from "@tanstack/react-query";
import { Activity, Cpu, Server, Users } from "lucide-react";
import { api } from "../lib/api";
import { formatBytes, formatDuration } from "../lib/utils";
import { useBots, type BotSummary } from "../components/BotSelector";

export function Overview() {
	const bots = useBots();
	const health = useQuery({
		queryKey: ["health", "monitoring"],
		queryFn: () => api.get<any>("/health/monitoring"),
		refetchInterval: 30_000,
	});
	const stats = useQuery({
		queryKey: ["stats", "totals"],
		queryFn: () => api.get<any>("/stats/totals"),
		refetchInterval: 60_000,
	});

	const onlineCount = bots.data?.bots.filter((b) => b.online).length ?? 0;
	const totalCount = bots.data?.bots.length ?? 0;
	const avgPing =
		bots.data && onlineCount > 0
			? Math.round(
					bots.data.bots.filter((b) => b.online).reduce((s, b) => s + Math.max(0, b.wsPing), 0) /
						Math.max(1, onlineCount)
				)
			: null;

	return (
		<div className="space-y-6">
			{/* Vue d'ensemble — résumé du système multi-bot */}
			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
				<KPICard title="Bots en ligne" icon={<Server className="h-4 w-4" />}>
					<p className="text-3xl font-bold text-brand-400">
						{onlineCount}
						<span className="text-sm text-zinc-500"> / {totalCount}</span>
					</p>
					<p className="mt-2 text-xs text-zinc-400">
						{totalCount > 0
							? `${onlineCount === totalCount ? "Tous opérationnels" : `${totalCount - onlineCount} hors ligne`}`
							: "—"}
					</p>
				</KPICard>

				<KPICard title="Joueurs en base" icon={<Users className="h-4 w-4" />}>
					<p className="text-3xl font-bold text-brand-400">{stats.data?.stats.totalUsers ?? "—"}</p>
					<p className="mt-2 text-xs text-zinc-400">
						{stats.data?.stats.totalActiveUsers ?? "—"} actifs ·{" "}
						{stats.data?.stats.totalGuilds ?? "—"} serveur
						{(stats.data?.stats.totalGuilds ?? 0) > 1 ? "s" : ""}
					</p>
				</KPICard>

				<KPICard title="Latence moyenne" icon={<Activity className="h-4 w-4" />}>
					<p className="text-3xl font-bold">
						{avgPing !== null ? avgPing : "—"}
						<span className="text-sm text-zinc-500"> ms</span>
					</p>
					<p className="mt-2 text-xs text-zinc-400">
						WS Discord · base {health.data?.latency.db ?? "—"} ms
					</p>
				</KPICard>

				<KPICard title="Mémoire process" icon={<Cpu className="h-4 w-4" />}>
					<p className="text-3xl font-bold">
						{health.data ? formatBytes(health.data.pid.rss).split(" ")[0] : "—"}
						<span className="text-sm text-zinc-500">
							{" "}
							{health.data ? formatBytes(health.data.pid.rss).split(" ")[1] : ""}
						</span>
					</p>
					<p className="mt-2 text-xs text-zinc-400">
						CPU {health.data?.pid.cpu ?? "—"} % · machine {health.data?.host.cpu.usage ?? "—"} %
					</p>
				</KPICard>
			</div>

			{/* Grid des 6 personas */}
			<div>
				<h2 className="mb-3 text-lg font-semibold">Personas</h2>
				<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
					{bots.data?.bots.map((b) => <BotCard key={b.id} bot={b} />) ?? (
						<div className="text-zinc-500">Chargement…</div>
					)}
				</div>
			</div>

			{/* Machine hôte */}
			<div className="card">
				<h2 className="mb-4 text-lg font-semibold">Machine hôte</h2>
				{health.data ? (
					<dl className="grid gap-2 text-sm sm:grid-cols-2">
						<div className="flex justify-between border-b border-zinc-900 py-1">
							<dt className="text-zinc-400">Système</dt>
							<dd>{health.data.host.platform}</dd>
						</div>
						<div className="flex justify-between border-b border-zinc-900 py-1">
							<dt className="text-zinc-400">Cœurs CPU</dt>
							<dd>{health.data.host.cpu.count}</dd>
						</div>
						<div className="flex justify-between border-b border-zinc-900 py-1">
							<dt className="text-zinc-400">Mémoire</dt>
							<dd>
								{formatBytes(health.data.host.memory.used)} /{" "}
								{formatBytes(health.data.host.memory.total)}{" "}
								<span className="text-zinc-500">({health.data.host.memory.usage} %)</span>
							</dd>
						</div>
						<div className="flex justify-between border-b border-zinc-900 py-1">
							<dt className="text-zinc-400">Uptime machine</dt>
							<dd>{formatDuration(health.data.host.uptime * 1000)}</dd>
						</div>
					</dl>
				) : (
					<p className="text-zinc-500">…</p>
				)}
			</div>
		</div>
	);
}

function KPICard({
	title,
	icon,
	children,
}: {
	title: string;
	icon: React.ReactNode;
	children: React.ReactNode;
}) {
	return (
		<div className="card">
			<div className="mb-3 flex items-center gap-2 text-zinc-400">
				{icon}
				<h3 className="text-sm font-medium">{title}</h3>
			</div>
			{children}
		</div>
	);
}

function BotCard({ bot }: { bot: BotSummary }) {
	return (
		<div
			className={`card flex gap-3 ${bot.online ? "" : "opacity-60"}`}
			title={bot.username ?? bot.name}
		>
			{bot.avatar ? (
				<img
					src={bot.avatar}
					alt=""
					className={`h-12 w-12 shrink-0 rounded-full ${bot.online ? "" : "grayscale"}`}
				/>
			) : (
				<div className="h-12 w-12 shrink-0 rounded-full bg-zinc-800" />
			)}
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<h3 className="truncate font-semibold">{bot.name}</h3>
					<span
						className={`h-2 w-2 shrink-0 rounded-full ${bot.online ? "bg-emerald-400" : "bg-red-500"}`}
					/>
				</div>
				<p className="mt-0.5 text-xs text-zinc-500">
					{bot.online ? (
						<>
							{bot.wsPing} ms · uptime {bot.uptime ? formatDuration(bot.uptime) : "—"}
						</>
					) : (
						"Hors ligne"
					)}
				</p>
				<p className="mt-1 text-xs text-zinc-400">
					{bot.commandCount} commande{bot.commandCount > 1 ? "s" : ""}
					{" · "}
					{bot.guildCount} serveur{bot.guildCount > 1 ? "s" : ""}
				</p>
			</div>
		</div>
	);
}
