import { useEffect } from "react";

import { subscribeTable } from "@/lib/realtime";

export interface BroadcastTableEvent<T> {
	type: "INSERT" | "UPDATE" | "DELETE";
	new: T;
	old?: T;
}

export interface UseTableBroadcastOptions<T = Record<string, unknown>> {
	table: string;
	schema?: string;
	filter?: string;
	onInsert?: (data: T) => void;
	onUpdate?: (data: T) => void;
	onDelete?: (data: T) => void;
}

/**
 * Abonnement aux changements d'une table Postgres.
 *
 * Adossé au service rg-realtime (SSE + LISTEN/NOTIFY) depuis la migration
 * hors Supabase — la signature est inchangée pour les appelants.
 */
export function useTableBroadcast<T = Record<string, unknown>>({
	table,
	schema = "public",
	filter,
	onInsert,
	onUpdate,
	onDelete,
}: UseTableBroadcastOptions<T>) {
	useEffect(() => {
		return subscribeTable<T>({ filter, schema, table }, (event) => {
			switch (event.eventType) {
				case "INSERT": {
					if (event.new) onInsert?.(event.new);
					break;
				}
				case "UPDATE": {
					if (event.new) onUpdate?.(event.new);
					break;
				}
				case "DELETE": {
					if (event.old) onDelete?.(event.old);
					break;
				}
			}
		});
	}, [table, schema, filter, onInsert, onUpdate, onDelete]);
}
