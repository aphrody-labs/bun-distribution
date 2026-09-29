import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileSearch, RefreshCw, Filter } from "lucide-react";
import { useState } from "react";
import { api } from "../lib/api";

interface ActionLog {
	id: number;
	userId: string | null;
	moderatorId: string | null;
	action: string;
	reason: string | null;
	meta: string | null;
	createdAt: string;
}

const ACTION_OPTIONS = [
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
	"CLEAR",
	"SLOWMODE",
	"LOCK",
	"UNLOCK",
	"LEVEL_UP",
] as const;

const ACTION_COLORS: Record<string, string> = {
	WARN: "text-amber-400",
	UNWARN: "text-emerald-400",
	MUTE: "text-orange-400",
	UNMUTE: "text-emerald-400",
	JAIL: "text-red-400",
	UNJAIL: "text-emerald-400",
	BAN: "text-red-500",
	UNBAN: "text-emerald-400",
	KICK: "text-orange-500",
	PURGE: "text-purple-400",
	CLEAR: "text-purple-400",
	SLOWMODE: "text-blue-400",
	LOCK: "text-blue-400",
	UNLOCK: "text-emerald-400",
	LEVEL_UP: "text-fuchsia-400",
};

/**
 * Page dédiée pour visualiser la table `action_logs` avec filtres serveur.
 * Distincte de `/audit` (qui interroge l'audit log Discord natif).
 */
export function AuditInternal() {
	const qc = useQueryClient();
	const [action, setAction] = useState<string>("");
	const [userId, setUserId] = useState<string>("");
	const [page, setPage] = useState<number>(0);
	const limit = 50;

	const params = new URLSearchParams({
		limit: String(limit),
		offset: String(page * limit),
	});
	if (action) params.set("action", action);
	if (userId) params.set("userId", userId);

	const logs = useQuery({
		queryKey: ["audit", "internal", action, userId, page],
		queryFn: () =>
			api.get<{
				rows: ActionLog[];
				total: number;
				limit: number;
				offset: number;
			}>(`/audit/logs?${params}`),
	});

	return (
		<div className="space-y-4">
			<div className="card">
				<div className="flex items-center gap-2">
					<FileSearch className="h-5 w-5 text-brand-400" />
					<h2 className="text-lg font-semibold">Journal interne — action_logs</h2>
					<button
						type="button"
						onClick={() => qc.invalidateQueries({ queryKey: ["audit", "internal"] })}
						className="ml-auto btn btn-ghost px-2"
						title="Rafraîchir"
					>
						<RefreshCw className="h-3 w-3" />
					</button>
				</div>
				<p className="mt-1 text-sm text-zinc-400">
					Toutes les actions modé/level/economy enregistrées par les services. Un autre journal
					(Discord native audit log) est disponible sur la page <code>/audit</code>.
				</p>
				<div className="mt-3 grid gap-2 sm:grid-cols-3">
					<div>
						<label className="block text-xs text-zinc-500">Action</label>
						<select
							className="input w-full"
							value={action}
							onChange={(e) => {
								setAction(e.target.value);
								setPage(0);
							}}
						>
							<option value="">— Toutes —</option>
							{ACTION_OPTIONS.map((a) => (
								<option key={a} value={a}>
									{a}
								</option>
							))}
						</select>
					</div>
					<div>
						<label className="block text-xs text-zinc-500">User ID</label>
						<input
							className="input w-full font-mono text-xs"
							value={userId}
							onChange={(e) => {
								setUserId(e.target.value);
								setPage(0);
							}}
							placeholder="snowflake (filtre cible)"
						/>
					</div>
					<div className="flex items-end gap-2">
						<button
							type="button"
							className="btn btn-ghost"
							onClick={() => {
								setAction("");
								setUserId("");
								setPage(0);
							}}
						>
							<Filter className="h-3 w-3" /> Réinit
						</button>
						<span className="ml-auto text-xs text-zinc-500">{logs.data?.total ?? 0} entrée(s)</span>
					</div>
				</div>
			</div>

			{logs.isLoading && <div className="text-zinc-500">Chargement…</div>}

			<div className="card p-0 overflow-hidden">
				<table className="w-full text-xs">
					<thead className="bg-zinc-900/60 text-left">
						<tr>
							<th className="px-3 py-2 font-medium">Action</th>
							<th className="px-3 py-2 font-medium">Cible</th>
							<th className="px-3 py-2 font-medium">Modérateur</th>
							<th className="px-3 py-2 font-medium">Raison</th>
							<th className="px-3 py-2 font-medium">Meta</th>
							<th className="px-3 py-2 font-medium">Date</th>
						</tr>
					</thead>
					<tbody>
						{logs.data?.rows.map((row) => (
							<tr key={row.id} className="border-t border-zinc-800 align-top">
								<td className={`px-3 py-2 font-semibold ${ACTION_COLORS[row.action] ?? ""}`}>
									{row.action}
								</td>
								<td className="px-3 py-2 font-mono">{row.userId ?? "—"}</td>
								<td className="px-3 py-2 font-mono">{row.moderatorId ?? "—"}</td>
								<td className="px-3 py-2 max-w-xs truncate" title={row.reason ?? ""}>
									{row.reason ?? "—"}
								</td>
								<td className="px-3 py-2 max-w-xs">
									{row.meta ? <MetaCell raw={row.meta} /> : "—"}
								</td>
								<td className="px-3 py-2 whitespace-nowrap text-zinc-500">
									{new Date(row.createdAt).toLocaleString("fr-FR")}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>

			<div className="flex items-center justify-center gap-2">
				<button
					type="button"
					className="btn btn-ghost"
					disabled={page === 0}
					onClick={() => setPage((p) => Math.max(0, p - 1))}
				>
					← Précédent
				</button>
				<span className="text-xs text-zinc-500">
					Page {page + 1}
					{logs.data?.total ? ` / ${Math.ceil(logs.data.total / limit)}` : ""}
				</span>
				<button
					type="button"
					className="btn btn-ghost"
					disabled={(logs.data?.rows.length ?? 0) < limit}
					onClick={() => setPage((p) => p + 1)}
				>
					Suivant →
				</button>
			</div>
		</div>
	);
}

function MetaCell({ raw }: { raw: string }) {
	const [open, setOpen] = useState(false);
	let pretty = raw;
	try {
		pretty = JSON.stringify(JSON.parse(raw), null, 2);
	} catch {
		/* keep raw */
	}
	return (
		<details open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
			<summary className="cursor-pointer text-zinc-400 hover:text-zinc-200">
				{open ? "Masquer" : `${raw.slice(0, 50)}${raw.length > 50 ? "…" : ""}`}
			</summary>
			<pre className="mt-1 max-h-48 overflow-auto rounded bg-zinc-950 p-2 text-[10px]">
				{pretty}
			</pre>
		</details>
	);
}
