import { useQuery } from "@tanstack/react-query";
import { TrendingUp, Trophy, Zap, MessageSquare } from "lucide-react";
import { api } from "../lib/api";
import { formatZeni } from "~/lib/zeni";

interface User {
	id: string;
	xp: number;
	zeni: number;
	last_level_reached: number;
	message_count: number;
	total_voice_ms: number;
}

export function Stats() {
	const totals = useQuery({
		queryKey: ["stats", "totals"],
		queryFn: () => api.get<any>("/stats/totals"),
	});
	const top = useQuery({
		queryKey: ["bot", "users", "top"],
		queryFn: () => api.get<{ users: User[] }>("/bot/users?limit=20&offset=0"),
	});

	const maxXp = top.data?.users[0]?.xp ?? 1;

	return (
		<div className="space-y-4">
			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
				<MiniStat
					icon={<MessageSquare className="h-4 w-4" />}
					title="Total joueurs"
					value={totals.data?.stats.totalUsers ?? "—"}
				/>
				<MiniStat
					icon={<TrendingUp className="h-4 w-4" />}
					title="Joueurs actifs"
					value={totals.data?.stats.totalActiveUsers ?? "—"}
				/>
				<MiniStat
					icon={<Trophy className="h-4 w-4" />}
					title="Top XP"
					value={top.data?.users[0]?.xp ?? "—"}
				/>
				<MiniStat
					icon={<Zap className="h-4 w-4" />}
					title="Total commandes"
					value={totals.data?.stats.totalCommands ?? "—"}
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
										style={{ width: `${(u.xp / maxXp) * 100}%` }}
									/>
								</div>
							</div>
							<span className="w-24 text-right font-mono text-xs">
								{u.xp.toLocaleString("fr-FR")} XP
							</span>
							<span className="w-20 text-right font-mono text-xs text-amber-400">
								{formatZeni(u.zeni)}
							</span>
							<span className="w-16 text-right font-mono text-xs text-zinc-500">
								niveau {u.last_level_reached}
							</span>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}

function MiniStat({
	icon,
	title,
	value,
}: {
	icon: React.ReactNode;
	title: string;
	value: number | string;
}) {
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
