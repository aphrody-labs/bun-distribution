"use client";

// Client de temps réel self-host — remplace `supabase.channel().on("postgres_changes")`.
//
// Le service rg-realtime (apps/realtime/server.ts) diffuse en SSE les
// changements des tables munies du trigger `public.rg_realtime_notify()`
// (comments, settings, profiles). Le flux est servi sur la même origine que
// l'app, via nginx (`/realtime/v1/stream`) — donc aucune requête cross-origin.

export type RealtimeEventType = "INSERT" | "UPDATE" | "DELETE";

export interface RealtimeEvent<T = Record<string, unknown>> {
	schema: string;
	table: string;
	eventType: RealtimeEventType;
	new: T | null;
	old: T | null;
	/** Charge utile trop grosse pour NOTIFY : seuls les identifiants sont fournis. */
	truncated?: boolean;
}

export interface SubscribeOptions {
	table: string;
	schema?: string;
	/** Filtre au format `postgres_changes` : `colonne=eq.valeur`. */
	filter?: string;
}

/**
 * Ouvre un flux d'événements sur une table et renvoie la fonction de
 * désabonnement. La reconnexion est prise en charge par `EventSource`.
 */
export function subscribeTable<T = Record<string, unknown>>(
	options: SubscribeOptions,
	onEvent: (event: RealtimeEvent<T>) => void
): () => void {
	if (typeof window === "undefined") return () => {};

	const params = new URLSearchParams({ table: options.table });
	if (options.schema) params.set("schema", options.schema);
	if (options.filter) params.set("filter", options.filter);

	const source = new EventSource(`/realtime/v1/stream?${params.toString()}`);
	source.onmessage = (message) => {
		try {
			onEvent(JSON.parse(message.data) as RealtimeEvent<T>);
		} catch {
			// message illisible — on ignore plutôt que de casser l'abonnement
		}
	};

	return () => source.close();
}
