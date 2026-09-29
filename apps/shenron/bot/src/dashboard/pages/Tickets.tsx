import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, Ticket as TicketIcon, RefreshCw, ExternalLink } from "lucide-react";
import { useState } from "react";
import { api } from "../lib/api";

interface TicketRow {
	id: number;
	channelId: string;
	ownerId: string;
	kind: "report" | "achat" | "shop" | "abus";
	context: string | null;
	closed: boolean;
	closedAt: string | null;
	closedBy: string | null;
	createdAt: string;
}

const KIND_LABEL: Record<TicketRow["kind"], { emoji: string; label: string; color: string }> = {
	report: { emoji: "🚨", label: "Signaler", color: "text-red-400" },
	achat: { emoji: "🛒", label: "Achat", color: "text-blue-400" },
	shop: { emoji: "🏪", label: "Shop", color: "text-amber-400" },
	abus: { emoji: "⚠️", label: "Abus de perm", color: "text-orange-400" },
};

export function Tickets() {
	const qc = useQueryClient();
	const [filter, setFilter] = useState<"all" | "open" | "closed">("open");

	const tickets = useQuery({
		queryKey: ["tickets", filter],
		queryFn: () =>
			api.get<{ rows: TicketRow[]; total: number }>(
				filter === "all" ? "/tickets" : `/tickets?closed=${filter === "closed"}`
			),
	});

	const close = useMutation({
		mutationFn: (channelId: string) => api.post(`/tickets/${channelId}/close`),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["tickets"] }),
	});

	return (
		<div className="space-y-4">
			<div className="card">
				<div className="flex items-center gap-2">
					<TicketIcon className="h-5 w-5 text-brand-400" />
					<h2 className="text-lg font-semibold">Tickets</h2>
					<button
						type="button"
						onClick={() => qc.invalidateQueries({ queryKey: ["tickets"] })}
						className="btn btn-ghost ml-auto px-2"
						title="Rafraîchir"
					>
						<RefreshCw className="h-3 w-3" />
					</button>
				</div>
				<div className="mt-3 flex gap-2">
					{(["open", "closed", "all"] as const).map((f) => (
						<button
							key={f}
							type="button"
							onClick={() => setFilter(f)}
							className={`btn ${filter === f ? "btn-primary" : "btn-ghost"}`}
						>
							{f === "open" ? "Ouverts" : f === "closed" ? "Fermés" : "Tous"}
						</button>
					))}
					<span className="ml-auto text-xs text-zinc-500">
						{tickets.data?.total ?? 0} ticket(s)
					</span>
				</div>
			</div>

			{tickets.isLoading && <div className="text-zinc-500">Chargement…</div>}
			{tickets.data?.rows.length === 0 && (
				<div className="card text-center text-zinc-500">Aucun ticket.</div>
			)}

			<div className="space-y-2">
				{tickets.data?.rows.map((t) => {
					const meta = KIND_LABEL[t.kind];
					return (
						<div key={t.id} className="card">
							<div className="flex items-center gap-3">
								<span className={`text-2xl ${meta.color}`}>{meta.emoji}</span>
								<div className="flex-1 min-w-0">
									<div className="flex items-center gap-2">
										<span className="font-semibold">{meta.label}</span>
										<span className="text-xs text-zinc-500">#{t.id}</span>
										{t.closed ? (
											<span className="badge badge-error">Fermé</span>
										) : (
											<span className="badge badge-success">Ouvert</span>
										)}
									</div>
									<p className="mt-1 text-xs text-zinc-400">
										Owner : <code>{t.ownerId}</code> · Créé{" "}
										<time dateTime={t.createdAt}>
											{new Date(t.createdAt).toLocaleString("fr-FR")}
										</time>
										{t.closed && t.closedAt && (
											<>
												{" · "}Fermé{" "}
												<time dateTime={t.closedAt}>
													{new Date(t.closedAt).toLocaleString("fr-FR")}
												</time>{" "}
												par <code>{t.closedBy ?? "?"}</code>
											</>
										)}
									</p>
									{t.context && (
										<p className="mt-2 line-clamp-3 text-sm text-zinc-300 whitespace-pre-wrap">
											{t.context}
										</p>
									)}
								</div>
								<div className="flex flex-col items-end gap-1">
									<a
										href={`discord://discord.com/channels/@me/${t.channelId}`}
										target="_blank"
										rel="noreferrer"
										className="btn btn-ghost px-2"
										title="Ouvrir dans Discord"
									>
										<ExternalLink className="h-3 w-3" />
									</a>
									{!t.closed && (
										<button
											type="button"
											onClick={() => close.mutate(t.channelId)}
											disabled={close.isPending}
											className="btn btn-ghost px-2 text-red-400"
											title="Fermer le ticket"
										>
											<Lock className="h-3 w-3" />
										</button>
									)}
								</div>
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}
