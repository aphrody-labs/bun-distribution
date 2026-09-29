"use client";

import { useEffect, useRef, useState } from "react";

export type BotEvent = {
	name: string;
	payload?: unknown;
	ts?: number;
};

type Options = {
	max?: number;
	filter?: (e: BotEvent) => boolean;
};

/**
 * Hook React qui consomme le SSE `/api/bot-admin/events` (proxy vers bot).
 * Le proxy ajoute le Bearer token côté server, le client ne voit rien.
 * Reconnexion auto via EventSource natif.
 */
export function useLiveEvents({ max = 100, filter }: Options = {}) {
	const [events, setEvents] = useState<BotEvent[]>([]);
	const [status, setStatus] = useState<"connecting" | "open" | "closed">("connecting");
	const sourceRef = useRef<EventSource | null>(null);
	// `filter` est une lambda écrite dans le JSX de l'appelant : en dépendance
	// d'effet, elle changeait d'identité à CHAQUE rendu, donc le flux SSE était
	// fermé puis rouvert à chaque rendu — une reconnexion par event reçu, le
	// serpent qui se mord la queue. `max` ne justifie pas davantage une
	// reconnexion : c'est un simple plafond appliqué à la réception. Les deux
	// passent donc par une ref, et l'effet n'ouvre le flux qu'une seule fois.
	const filterRef = useRef(filter);
	filterRef.current = filter;
	const maxRef = useRef(max);
	maxRef.current = max;

	useEffect(() => {
		const es = new EventSource("/api/bot-admin/events");
		sourceRef.current = es;

		es.onopen = () => setStatus("open");
		es.onerror = () => setStatus("closed");
		es.onmessage = (msg) => {
			try {
				const data = JSON.parse(msg.data) as BotEvent;
				const garde = filterRef.current;
				if (garde && !garde(data)) return;
				setEvents((prev) => {
					const next = [data, ...prev];
					const plafond = Math.max(1, maxRef.current);
					if (next.length > plafond) next.length = plafond;
					return next;
				});
			} catch {
				/* malformed event, ignore */
			}
		};

		return () => {
			es.close();
			sourceRef.current = null;
		};
	}, []);

	return { events, status };
}
