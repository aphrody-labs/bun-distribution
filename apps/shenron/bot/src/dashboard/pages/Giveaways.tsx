import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Gift, RefreshCw, ExternalLink, FastForward, Users } from "lucide-react";
import { useState } from "react";
import { api } from "../lib/api";

interface GiveawayRow {
	id: number;
	messageId: string;
	channelId: string;
	hostId: string;
	title: string;
	reward: string;
	description: string | null;
	winners: number;
	endsAt: string;
	ended: boolean;
	winnerIds: string | null;
	entries: number;
}

export function Giveaways() {
	const qc = useQueryClient();
	const [filter, setFilter] = useState<"all" | "active" | "ended">("active");

	const giveaways = useQuery({
		queryKey: ["giveaways", filter],
		queryFn: () =>
			api.get<{ rows: GiveawayRow[]; total: number }>(
				filter === "all" ? "/giveaways" : `/giveaways?ended=${filter === "ended"}`
			),
	});

	const forceEnd = useMutation({
		mutationFn: (id: number) => api.post(`/giveaways/${id}/end`, {}),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["giveaways"] }),
	});

	const renderWinners = (winnerIds: string | null) => {
		if (!winnerIds) return "—";
		try {
			const ids = JSON.parse(winnerIds) as string[];
			return ids.length ? ids.map((id) => `<@${id}>`).join(", ") : "Aucun";
		} catch {
			return winnerIds;
		}
	};

	return (
		<div className="space-y-4">
			<div className="card">
				<div className="flex items-center gap-2">
					<Gift className="h-5 w-5 text-brand-400" />
					<h2 className="text-lg font-semibold">Giveaways / Tirages au sort</h2>
					<button
						type="button"
						onClick={() => qc.invalidateQueries({ queryKey: ["giveaways"] })}
						className="btn btn-ghost ml-auto px-2"
						title="Rafraîchir"
					>
						<RefreshCw className="h-3 w-3" />
					</button>
				</div>
				<p className="mt-1 text-sm text-zinc-400">
					Création via slash <code>/giveaway</code>. Le ticker boucle 1×/min pour clore les tirages
					expirés. Ici tu peux forcer la clôture immédiate, voir les participants et les gagnants.
				</p>
				<div className="mt-3 flex gap-2">
					{(["active", "ended", "all"] as const).map((f) => (
						<button
							key={f}
							type="button"
							onClick={() => setFilter(f)}
							className={`btn ${filter === f ? "btn-primary" : "btn-ghost"}`}
						>
							{f === "active" ? "Actifs" : f === "ended" ? "Terminés" : "Tous"}
						</button>
					))}
					<span className="ml-auto text-xs text-zinc-500">
						{giveaways.data?.total ?? 0} giveaway(s)
					</span>
				</div>
			</div>

			{giveaways.isLoading && <div className="text-zinc-500">Chargement…</div>}
			{giveaways.data?.rows.length === 0 && (
				<div className="card text-center text-zinc-500">Aucun giveaway.</div>
			)}

			<div className="space-y-2">
				{giveaways.data?.rows.map((g) => (
					<div key={g.id} className="card">
						<div className="flex items-start gap-3">
							<span className="text-2xl">🎁</span>
							<div className="flex-1 min-w-0">
								<div className="flex items-center gap-2">
									<span className="font-semibold truncate">{g.title}</span>
									<span className="text-xs text-zinc-500">#{g.id}</span>
									{g.ended ? (
										<span className="badge badge-error">Terminé</span>
									) : (
										<span className="badge badge-success">En cours</span>
									)}
								</div>
								<p className="mt-1 text-xs text-zinc-400">
									Récompense : <strong className="text-amber-400">{g.reward}</strong> · {g.winners}{" "}
									gagnant(s) · Hôte <code>{g.hostId}</code>
								</p>
								<p className="text-xs text-zinc-400">
									{g.ended ? "Clos" : "Fin"} le{" "}
									<time dateTime={g.endsAt}>{new Date(g.endsAt).toLocaleString("fr-FR")}</time>
								</p>
								<p className="mt-1 inline-flex items-center gap-1 text-xs text-zinc-300">
									<Users className="h-3 w-3" /> {g.entries} participant(s)
								</p>
								{g.ended && (
									<p
										className="mt-2 text-sm text-emerald-300"
										dangerouslySetInnerHTML={{
											__html: `Gagnant(s) : ${renderWinners(g.winnerIds)}`,
										}}
									/>
								)}
								{g.description && (
									<p className="mt-2 line-clamp-2 text-sm text-zinc-400 whitespace-pre-wrap">
										{g.description}
									</p>
								)}
							</div>
							<div className="flex flex-col items-end gap-1">
								<a
									href={`discord://discord.com/channels/-/${g.channelId}/${g.messageId}`}
									target="_blank"
									rel="noreferrer"
									className="btn btn-ghost px-2"
									title="Voir sur Discord"
								>
									<ExternalLink className="h-3 w-3" />
								</a>
								{!g.ended && (
									<button
										type="button"
										onClick={() => {
											if (confirm(`Forcer la clôture de "${g.title}" maintenant ?`))
												forceEnd.mutate(g.id);
										}}
										disabled={forceEnd.isPending}
										className="btn btn-ghost px-2 text-amber-400"
										title="Clore immédiatement (tirage des gagnants)"
									>
										<FastForward className="h-3 w-3" />
									</button>
								)}
							</div>
						</div>
					</div>
				))}
			</div>
		</div>
	);
}
