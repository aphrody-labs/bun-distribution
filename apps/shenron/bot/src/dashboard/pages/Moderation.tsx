import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	ShieldAlert,
	Lock,
	Trash2,
	RefreshCw,
	Activity,
	AlertTriangle,
	Ban,
	Hammer,
} from "lucide-react";
import { useState } from "react";
import { api } from "../lib/api";
import { formatRelative } from "../lib/utils";

interface Warn {
	id: number;
	userId: string;
	moderatorId: string;
	reason: string | null;
	active: boolean;
	createdAt: number;
}

interface Jail {
	id: number;
	userId: string;
	moderatorId: string;
	reason: string | null;
	expiresAt: number | null;
	releasedAt: number | null;
	previousRoles: string | null;
	createdAt: number;
}

interface ActionLog {
	id: number;
	action: string;
	userId: string | null;
	moderatorId: string | null;
	reason: string | null;
	meta: string | null;
	createdAt: number;
}

interface ModStats {
	windowMs: number;
	since: number;
	byAction: Record<string, number>;
}

const SANCTION_ACTIONS = [
	"WARN",
	"UNWARN",
	"MUTE",
	"UNMUTE",
	"JAIL",
	"UNJAIL",
	"BAN",
	"UNBAN",
	"KICK",
	"PURGE",
	"LOCK",
	"UNLOCK",
	"SLOWMODE",
	"NOTE",
	"CLEARWARNS",
	"ROLE",
	"ROLE_BULK",
];

export function Moderation() {
	const qc = useQueryClient();
	const [filter, setFilter] = useState<string>("");

	const stats = useQuery({
		queryKey: ["moderation", "stats"],
		queryFn: () => api.get<ModStats>("/moderation/stats"),
		refetchInterval: 30_000,
	});
	const warns = useQuery({
		queryKey: ["moderation", "warns"],
		queryFn: () => api.get<{ rows: Warn[]; total: number }>("/moderation/warns?limit=200"),
		refetchInterval: 60_000,
	});
	const jails = useQuery({
		queryKey: ["moderation", "jails"],
		queryFn: () => api.get<{ rows: Jail[]; total: number }>("/moderation/jails"),
		refetchInterval: 60_000,
	});
	const recent = useQuery({
		queryKey: ["moderation", "recent"],
		queryFn: () =>
			api.get<{ rows: ActionLog[]; total: number }>(
				`/moderation/recent?limit=50&actions=${SANCTION_ACTIONS.join(",")}`
			),
		refetchInterval: 30_000,
	});

	const unwarn = useMutation({
		mutationFn: (id: number) => api.delete(`/moderation/warns/${id}`),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["moderation"] });
		},
	});
	const clearAllWarns = useMutation({
		mutationFn: (userId: string) => api.post(`/moderation/warns/clear/${userId}`),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["moderation"] });
		},
	});
	const unjail = useMutation({
		mutationFn: (userId: string) => api.delete(`/moderation/jails/${userId}`),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["moderation"] });
		},
	});

	const filterWarns = (warns.data?.rows ?? []).filter(
		(w) =>
			!filter ||
			w.userId.includes(filter) ||
			(w.reason ?? "").toLowerCase().includes(filter.toLowerCase())
	);
	const filterJails = (jails.data?.rows ?? []).filter(
		(j) =>
			!filter ||
			j.userId.includes(filter) ||
			(j.reason ?? "").toLowerCase().includes(filter.toLowerCase())
	);

	return (
		<div className="space-y-4">
			<div className="card">
				<div className="flex items-center gap-2">
					<ShieldAlert className="h-5 w-5 text-brand-400" />
					<h2 className="text-lg font-semibold">Modération</h2>
				</div>
				<p className="mt-1 text-sm text-zinc-400">
					Avertissements actifs, jails en cours, dernières actions des modérateurs. Toutes les
					opérations sont auditées dans <code>action_logs</code>.
				</p>
			</div>

			<KpisCard stats={stats.data} loading={stats.isLoading} />

			<div className="flex items-center gap-2">
				<input
					type="text"
					placeholder="Filtrer par ID utilisateur ou motif…"
					value={filter}
					onChange={(e) => setFilter(e.target.value)}
					className="input flex-1"
				/>
				<button
					type="button"
					className="btn btn-ghost"
					onClick={() => qc.invalidateQueries({ queryKey: ["moderation"] })}
				>
					<RefreshCw className="h-4 w-4" />
					Recharger
				</button>
			</div>

			<div className="grid gap-4 lg:grid-cols-2">
				<WarnsCard
					rows={filterWarns}
					total={warns.data?.total ?? 0}
					loading={warns.isLoading}
					onUnwarn={(id) => unwarn.mutate(id)}
					onClearAll={(userId) => clearAllWarns.mutate(userId)}
					pending={unwarn.isPending || clearAllWarns.isPending}
				/>
				<JailsCard
					rows={filterJails}
					total={jails.data?.total ?? 0}
					loading={jails.isLoading}
					onUnjail={(userId) => unjail.mutate(userId)}
					pending={unjail.isPending}
				/>
			</div>

			<RecentCard rows={recent.data?.rows ?? []} loading={recent.isLoading} />
		</div>
	);
}

function KpisCard({ stats, loading }: { stats: ModStats | undefined; loading: boolean }) {
	if (loading) return <div className="text-zinc-500">Chargement des KPIs…</div>;
	const by = stats?.byAction ?? {};
	const items: Array<{ label: string; value: number; icon: React.ReactNode; color: string }> = [
		{
			label: "Warns (7j)",
			value: by.WARN ?? 0,
			icon: <AlertTriangle className="h-4 w-4" />,
			color: "text-yellow-400",
		},
		{
			label: "Mutes (7j)",
			value: by.MUTE ?? 0,
			icon: <Activity className="h-4 w-4" />,
			color: "text-orange-400",
		},
		{
			label: "Jails (7j)",
			value: by.JAIL ?? 0,
			icon: <Lock className="h-4 w-4" />,
			color: "text-red-400",
		},
		{
			label: "Kicks (7j)",
			value: by.KICK ?? 0,
			icon: <Ban className="h-4 w-4" />,
			color: "text-rose-400",
		},
		{
			label: "Bans (7j)",
			value: by.BAN ?? 0,
			icon: <Hammer className="h-4 w-4" />,
			color: "text-red-600",
		},
		{
			label: "Purges (7j)",
			value: by.PURGE ?? 0,
			icon: <Trash2 className="h-4 w-4" />,
			color: "text-zinc-400",
		},
	];
	return (
		<div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
			{items.map((it) => (
				<div key={it.label} className="card">
					<div className={`flex items-center gap-2 text-xs uppercase tracking-wide text-zinc-500`}>
						<span className={it.color}>{it.icon}</span>
						{it.label}
					</div>
					<div className="mt-1 text-2xl font-bold text-zinc-100">{it.value}</div>
				</div>
			))}
		</div>
	);
}

function WarnsCard({
	rows,
	total,
	loading,
	onUnwarn,
	onClearAll,
	pending,
}: {
	rows: Warn[];
	total: number;
	loading: boolean;
	onUnwarn: (id: number) => void;
	onClearAll: (userId: string) => void;
	pending: boolean;
}) {
	// Groupe par userId pour afficher le compte par membre
	const byUser = new Map<string, Warn[]>();
	for (const w of rows) {
		const arr = byUser.get(w.userId) ?? [];
		arr.push(w);
		byUser.set(w.userId, arr);
	}

	return (
		<div className="card">
			<div className="mb-3 flex items-center justify-between">
				<h3 className="flex items-center gap-2 text-sm font-semibold">
					<AlertTriangle className="h-4 w-4 text-yellow-400" />
					Warns actifs ({total})
				</h3>
			</div>
			{loading ? (
				<div className="text-sm text-zinc-500">Chargement…</div>
			) : byUser.size === 0 ? (
				<div className="text-sm text-zinc-500">Aucun warn actif.</div>
			) : (
				<div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
					{[...byUser.entries()].map(([userId, list]) => (
						<div key={userId} className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-2">
							<div className="flex items-center justify-between">
								<div className="font-mono text-xs text-zinc-300">
									<span className="badge badge-warning">{list.length}</span>{" "}
									<span className="text-zinc-400">user</span> {userId}
								</div>
								<button
									type="button"
									className="btn btn-ghost text-xs"
									disabled={pending}
									onClick={() => {
										if (confirm(`Purger les ${list.length} warn(s) de ${userId} ?`))
											onClearAll(userId);
									}}
								>
									<Trash2 className="h-3 w-3" /> tout purger
								</button>
							</div>
							<ul className="mt-2 space-y-1">
								{list.map((w) => (
									<li
										key={w.id}
										className="flex items-center justify-between rounded bg-zinc-950/40 px-2 py-1 text-xs"
									>
										<div>
											<span className="text-zinc-500">#{w.id}</span>{" "}
											<span
												className="text-zinc-400"
												title={new Date(w.createdAt).toLocaleString()}
											>
												{formatRelative(w.createdAt)}
											</span>{" "}
											<span className="text-zinc-500">par {w.moderatorId.slice(0, 6)}…</span>
											<div className="text-zinc-400">{w.reason ?? "—"}</div>
										</div>
										<button
											type="button"
											className="btn btn-ghost text-xs"
											disabled={pending}
											onClick={() => onUnwarn(w.id)}
										>
											retirer
										</button>
									</li>
								))}
							</ul>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

function JailsCard({
	rows,
	total,
	loading,
	onUnjail,
	pending,
}: {
	rows: Jail[];
	total: number;
	loading: boolean;
	onUnjail: (userId: string) => void;
	pending: boolean;
}) {
	return (
		<div className="card">
			<div className="mb-3 flex items-center justify-between">
				<h3 className="flex items-center gap-2 text-sm font-semibold">
					<Lock className="h-4 w-4 text-red-400" />
					Jails actifs ({total})
				</h3>
			</div>
			{loading ? (
				<div className="text-sm text-zinc-500">Chargement…</div>
			) : rows.length === 0 ? (
				<div className="text-sm text-zinc-500">Aucun jail actif.</div>
			) : (
				<div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
					{rows.map((j) => {
						const expired = j.expiresAt && j.expiresAt < Date.now();
						return (
							<div
								key={j.id}
								className="flex items-start justify-between rounded-lg border border-zinc-800 bg-zinc-900/40 p-2 text-xs"
							>
								<div>
									<div className="font-mono text-zinc-300">user {j.userId}</div>
									<div className="text-zinc-400">
										Depuis{" "}
										<span title={new Date(j.createdAt).toLocaleString()}>
											{formatRelative(j.createdAt)}
										</span>{" "}
										par {j.moderatorId.slice(0, 6)}…
									</div>
									{j.expiresAt && (
										<div className={expired ? "text-red-400" : "text-zinc-500"}>
											Expire {expired ? "(dépassé)" : ""}{" "}
											<span title={new Date(j.expiresAt).toLocaleString()}>
												{formatRelative(j.expiresAt)}
											</span>
										</div>
									)}
									{!j.expiresAt && <div className="text-zinc-500">Indéfini</div>}
									<div className="text-zinc-400">Motif : {j.reason ?? "—"}</div>
								</div>
								<button
									type="button"
									className="btn btn-ghost"
									disabled={pending}
									onClick={() => {
										if (confirm(`Libérer ${j.userId} ?`)) onUnjail(j.userId);
									}}
								>
									libérer
								</button>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}

function RecentCard({ rows, loading }: { rows: ActionLog[]; loading: boolean }) {
	return (
		<div className="card overflow-x-auto p-0">
			<div className="border-b border-zinc-800 p-4">
				<h3 className="flex items-center gap-2 text-sm font-semibold">
					<Activity className="h-4 w-4 text-brand-400" />
					Actions de modération récentes ({rows.length})
				</h3>
			</div>
			{loading ? (
				<div className="p-4 text-sm text-zinc-500">Chargement…</div>
			) : rows.length === 0 ? (
				<div className="p-4 text-sm text-zinc-500">Aucune action récente.</div>
			) : (
				<table className="w-full text-sm">
					<thead className="bg-zinc-900/40 text-xs uppercase tracking-wide text-zinc-400">
						<tr>
							<th className="px-3 py-2 text-left">Date</th>
							<th className="px-3 py-2 text-left">Action</th>
							<th className="px-3 py-2 text-left">Utilisateur</th>
							<th className="px-3 py-2 text-left">Modérateur</th>
							<th className="px-3 py-2 text-left">Motif</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-zinc-800 font-mono text-xs">
						{rows.map((r) => (
							<tr key={r.id} className="hover:bg-zinc-900/30">
								<td
									className="px-3 py-2 text-zinc-400"
									title={new Date(r.createdAt).toLocaleString()}
								>
									{formatRelative(r.createdAt)}
								</td>
								<td className="px-3 py-2">
									<span className="badge">{r.action}</span>
								</td>
								<td className="px-3 py-2">{r.userId ?? "—"}</td>
								<td className="px-3 py-2 text-zinc-400">{r.moderatorId ?? "—"}</td>
								<td className="px-3 py-2 text-zinc-400">{r.reason ?? "—"}</td>
							</tr>
						))}
					</tbody>
				</table>
			)}
		</div>
	);
}
