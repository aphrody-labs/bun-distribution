import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { api } from "../lib/api";

interface Role {
	id: string;
	name: string;
	color: number;
	hexColor: string;
	position: number;
	managed: boolean;
	/** Rôle de boost serveur (Nitro). `managed` mais porté par des humains. */
	premiumSubscriber?: boolean;
}

interface Props {
	botId?: string;
	value: string;
	onChange: (roleId: string) => void;
	placeholder?: string;
	className?: string;
	disabled?: boolean;
}

/**
 * Sélecteur de rôle spécifique à un bot (persona).
 * Utilise /api/bots/:id/guild/roles
 */
export function RolePicker({
	botId = "shenron",
	value,
	onChange,
	placeholder = "— Sélectionner un rôle —",
	className,
	disabled,
}: Props) {
	const { data, isLoading, error } = useQuery({
		queryKey: ["bots", botId, "roles"],
		queryFn: () => api.get<{ roles: Role[] }>(`/bots/${botId}/guild/roles`),
		staleTime: 60_000,
	});

	const roles = useMemo(() => {
		return data?.roles ?? [];
	}, [data]);

	const selected = roles.find((r) => r.id === value);

	return (
		<div className={`flex items-center gap-2 ${className ?? ""}`}>
			{selected && (
				<span
					className="h-3 w-3 shrink-0 rounded-full border border-zinc-700"
					style={{ backgroundColor: selected.hexColor }}
					aria-hidden
				/>
			)}
			<select
				className="input flex-1"
				value={value}
				onChange={(e) => onChange(e.target.value)}
				disabled={disabled || isLoading}
			>
				<option value="">{isLoading ? "Chargement..." : error ? "Erreur" : placeholder}</option>
				{roles.map((r) => (
					<option key={r.id} value={r.id}>
						{r.name}
						{r.premiumSubscriber ? " · boost (non attribuable par le bot)" : ""}
						{r.color !== 0 ? ` · ${r.hexColor}` : ""}
					</option>
				))}
			</select>
		</div>
	);
}
