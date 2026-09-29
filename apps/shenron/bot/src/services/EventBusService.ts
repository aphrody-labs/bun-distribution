import { singleton } from "tsyringe";

/**
 * Bus d'événements applicatif simple — broadcast pub/sub en mémoire.
 *
 * Sert à synchroniser le bot (commandes Discord `/config`, level-up, jail expiry,
 * etc.) avec le dashboard (live updates via SSE) sans poller toutes les 30s.
 *
 * Garanties :
 *  - In-memory, single-process : reset au restart du bot
 *  - Sync : `emit()` retourne quand tous les subscribers ont été appelés
 *  - Pas de buffer : les subscribers manquent les events émis avant leur subscribe
 */

export type EventName =
	| "setting:changed" // payload: { key, value: string | null }
	| "setting:reset" // payload: { key }
	| "levels:rewards:changed" // payload: { level, action: "upsert" | "delete" }
	| "messages:template:changed" // payload: { event, action: "set" | "reset" }
	| "cron:run" // payload: { name, ok, durationMs }
	| "audit:new" // payload: ActionLog
	| "user:level-up" // payload: { userId, oldLevel, newLevel }
	| "economy:changed" // payload: { userId, kind: "zeni"|"xp", delta }
	| "command:permissions:changed" // payload: { name, action: "upsert" | "delete" }
	| "ping"; // keepalive — payload: { t: number }

interface BusEvent<T = unknown> {
	name: EventName;
	payload: T;
	ts: number;
}

type Listener = (event: BusEvent) => void;

@singleton()
export class EventBusService {
	private listeners = new Set<Listener>();

	emit<T = unknown>(name: EventName, payload: T): void {
		const event: BusEvent<T> = { name, payload, ts: Date.now() };
		for (const l of this.listeners) {
			try {
				l(event);
			} catch {
				// un subscriber qui throw ne doit pas casser les autres
			}
		}
	}

	subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	size(): number {
		return this.listeners.size;
	}
}
