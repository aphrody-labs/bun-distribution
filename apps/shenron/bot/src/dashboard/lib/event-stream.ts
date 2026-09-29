import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

interface BusEvent {
	name: string;
	payload: unknown;
	ts?: number;
}

/**
 * Map event → query keys à invalider. Sync live bot → dashboard.
 *
 * Quand le bot émet un event (ex: `/config set` Discord modifie un setting),
 * on reçoit l'event via SSE et on invalide les queries concernées. La page
 * affichée se rafraîchit automatiquement, sans poll.
 */
const EVENT_INVALIDATIONS: Record<string, string[][]> = {
	"setting:changed": [["settings"], ["settings", "current"]],
	"setting:reset": [["settings"], ["settings", "current"]],
	"levels:rewards:changed": [["levels", "rewards"]],
	"messages:template:changed": [["messages"]],
	"cron:run": [["cron"]],
	"audit:new": [["audit"]],
	"user:level-up": [
		["levels", "distribution"],
		["bot", "users", "top"],
	],
	"economy:changed": [
		["bot", "users", "top"],
		["stats", "totals"],
	],
};

/**
 * Ouvre un EventSource sur `/api/events` et invalide les queries TanStack
 * en fonction des events reçus. À monter une fois au top-level (App.tsx).
 *
 * Reconnecte automatiquement (EventSource le fait nativement) en cas de
 * coupure réseau.
 */
export function useEventStream(enabled: boolean = true): void {
	const qc = useQueryClient();

	useEffect(() => {
		if (!enabled) return;
		if (typeof window === "undefined" || !("EventSource" in window)) return;

		const es = new EventSource("/api/events", { withCredentials: true });

		es.addEventListener("message", (msg) => {
			try {
				const event = JSON.parse(msg.data) as BusEvent;
				if (event.name === "ping" || event.name === "hello") return;
				const keys = EVENT_INVALIDATIONS[event.name];
				if (keys) {
					for (const key of keys) {
						qc.invalidateQueries({ queryKey: key });
					}
				}
			} catch {
				// ignore parse errors
			}
		});

		es.addEventListener("error", () => {
			// EventSource gère automatiquement la reconnexion (3s par défaut)
			// On ne ferme pas explicitement pour laisser ce mécanisme jouer.
		});

		return () => es.close();
	}, [enabled, qc]);
}
