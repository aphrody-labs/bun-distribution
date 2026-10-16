import { useEffect } from "react";

import { subscribeTable } from "@/lib/realtime";

export interface BroadcastProfileEvent {
	type: "INSERT" | "UPDATE" | "DELETE";
	new: Record<string, unknown>;
	old?: Record<string, unknown>;
}

/**
 * Suit les changements du profil d'un utilisateur.
 *
 * Adossé au service rg-realtime (SSE + LISTEN/NOTIFY) depuis la migration
 * hors Supabase — la signature est inchangée pour les appelants.
 */
export function useProfileBroadcast(
	userId: string | undefined,
	onProfileUpdate?: (event: BroadcastProfileEvent) => void
) {
	useEffect(() => {
		if (!userId) return;

		return subscribeTable({ filter: `id=eq.${userId}`, table: "profiles" }, (payload) => {
			onProfileUpdate?.({
				new: payload.new ?? {},
				old: payload.old ?? undefined,
				type: payload.eventType,
			});
		});
	}, [userId, onProfileUpdate]);
}
