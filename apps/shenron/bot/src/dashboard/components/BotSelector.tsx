import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../lib/api";

export interface BotSummary {
	id: string;
	name: string;
	username: string | null;
	avatar: string | null;
	online: boolean;
	uptime: number | null;
	wsPing: number;
	intents: number;
	guildCount: number;
	commandCount: number;
}

interface BotsResponse {
	bots: BotSummary[];
}

/**
 * Hook utilitaire — synchronise un `botId` avec le query param `?bot=` de l'URL.
 * Permet de partager un lien avec un bot pré-sélectionné.
 */
export function useBotId(defaultId = "shenron") {
	const [id, setId] = useState<string>(() => {
		if (typeof window === "undefined") return defaultId;
		return new URLSearchParams(window.location.search).get("bot") ?? defaultId;
	});

	useEffect(() => {
		const onPop = () => {
			setId(new URLSearchParams(window.location.search).get("bot") ?? defaultId);
		};
		window.addEventListener("popstate", onPop);
		return () => window.removeEventListener("popstate", onPop);
	}, [defaultId]);

	const change = (next: string) => {
		const url = new URL(window.location.href);
		url.searchParams.set("bot", next);
		window.history.replaceState({}, "", url);
		setId(next);
	};

	return [id, change] as const;
}

export function useBots() {
	return useQuery({
		queryKey: ["bots"],
		queryFn: () => api.get<BotsResponse>("/bots"),
		staleTime: 10_000,
		refetchInterval: 30_000,
	});
}

interface BotSelectorProps {
	value: string;
	onChange: (id: string) => void;
	className?: string;
}

/**
 * Tabs horizontales pour sélectionner un persona parmi les 6.
 * Affiche avatar + nom + indicateur online/offline + ping WS.
 */
export function BotSelector({ value, onChange, className }: BotSelectorProps) {
	const { data, isLoading } = useBots();

	if (isLoading) {
		return (
			<div className={`flex gap-2 ${className ?? ""}`}>
				{Array.from({ length: 6 }).map((_, i) => (
					<div
						// biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholder
						key={i}
						className="h-10 w-32 animate-pulse rounded-lg bg-zinc-900"
					/>
				))}
			</div>
		);
	}

	const bots = data?.bots ?? [];

	return (
		<div className={`flex flex-wrap gap-2 ${className ?? ""}`}>
			{bots.map((b) => {
				const active = b.id === value;
				return (
					<button
						key={b.id}
						type="button"
						onClick={() => onChange(b.id)}
						title={b.online ? `Ping ${b.wsPing} ms` : "Hors ligne"}
						className={`group flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
							active
								? "border-brand-500 bg-brand-500/10 text-brand-300"
								: "border-zinc-800 bg-zinc-950/40 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900/60"
						}`}
					>
						{b.avatar ? (
							<img
								src={b.avatar}
								alt=""
								className={`h-6 w-6 rounded-full ${b.online ? "" : "grayscale"}`}
							/>
						) : (
							<div className="h-6 w-6 rounded-full bg-zinc-800" />
						)}
						<span className="font-medium">{b.name}</span>
						<span
							className={`h-2 w-2 rounded-full ${b.online ? "bg-emerald-400" : "bg-red-500"}`}
						/>
					</button>
				);
			})}
		</div>
	);
}
