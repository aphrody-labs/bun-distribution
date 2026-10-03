"use client";

// État LIVE du bot pour la home : poll des stats publiques + personas en ligne
// toutes les 25 s (gelé quand l'onglet est masqué) + flux SSE `a2a/events` pour
// la pulsation temps réel. Tout est défensif (try/catch, fallback sur l'état SSR
// initial) : la home reflète l'état réel mais ne casse jamais si l'API hoquette.
import { useEffect, useRef, useState } from "react";
import { API_URL as API_BASE } from "@/lib/config";

export interface BotStats {
	users: number;
	totalXp: number;
	totalZeni: number;
	achievementsUnlocked: number;
	shopItems: number;
	inventoryItems: number;
}

export interface PersonaLive {
	id: string;
	name: string;
	avatar: string | null;
	avatarUrl?: string | null;
	online: boolean;
}

export interface TopMember {
	rank: number;
	discordId: string;
	username: string | null;
	avatarUrl: string | null;
	xp: number;
	level: number;
}

interface PresenceMember {
	id: string;
	username: string;
	avatarUrl: string;
	status: string;
}
export interface PresenceState {
	total: number;
	online: number;
	members: PresenceMember[];
}

interface LiveEvent {
	key: number;
	type: string;
	label: string;
}

export interface LiveState {
	stats: BotStats;
	personas: PersonaLive[];
	topMembers: TopMember[];
	presence: PresenceState;
	onlineCount: number;
	connected: boolean;
	events: LiveEvent[];
}

function labelForEvent(type: string, data: unknown): string {
	const d = (data ?? {}) as Record<string, unknown>;
	const who = (d.username as string) || (d.name as string) || "Un guerrier";
	switch (type) {
		case "level-up":
		case "levelup":
			return `${who} passe niveau ${d.level ?? ""}`.trim();
		case "achievement":
			return `${who} débloque un succès`;
		case "message-xp":
		case "xp":
			return `${who} gagne de l'XP`;
		case "fusion":
			return `Fusion accomplie`;
		default:
			// Type non mappé du bus a2a → libellé FR neutre (jamais le type brut).
			return "Activité sur le serveur";
	}
}

/** Sondage sans flux temps réel : c'est la seule source de fraîcheur. */
const PERIODE_SANS_FLUX = 25_000;
/** Avec flux : simple filet de rattrapage, le SSE fait le travail. */
const PERIODE_AVEC_FLUX = 90_000;

export function useLiveBotState(initial: {
	stats: BotStats;
	personas: PersonaLive[];
	topMembers?: TopMember[];
	presence?: PresenceState;
}): LiveState {
	const [stats, setStats] = useState<BotStats>(initial.stats);
	const [personas, setPersonas] = useState<PersonaLive[]>(initial.personas);
	const [topMembers, setTopMembers] = useState<TopMember[]>(initial.topMembers ?? []);
	const [presence, setPresence] = useState<PresenceState>(
		initial.presence ?? { total: 0, online: 0, members: [] }
	);
	const [connected, setConnected] = useState(false);
	const [events, setEvents] = useState<LiveEvent[]>([]);
	// Pas d'horodatage de sondage exposé ici. Le tenir en état forçait un rendu
	// complet de l'accueil (près de mille lignes de JSX, quatre grilles, le
	// best-of) à chaque sondage, même quand l'API renvoyait exactement les mêmes
	// chiffres ; le passer en référence et le renvoyer quand même ne faisait que
	// publier une valeur figée, lue pendant le rendu, que personne n'affichait.
	// Les valeurs qui, elles, changent l'écran ont chacune leur état.
	const evKey = useRef(0);
	/** Réarme le sondage à une nouvelle cadence, sans le redémarrer entièrement. */
	const cadenceRef = useRef<((ms: number) => void) | null>(null);

	// ── Poll stats + personas ───────────────────────────────────────────────
	useEffect(() => {
		let alive = true;
		const ac = new AbortController();

		// Un sondage plus lent ne doit pas doubler le précédent ni, en arrivant
		// après, écraser des chiffres plus récents : un seul vol à la fois, et
		// chaque source échoue seule (une API en erreur ne fige pas les autres).
		let inFlight = false;
		const get = (path: string) =>
			fetch(`${API_BASE}${path}`, {
				signal: AbortSignal.any([ac.signal, AbortSignal.timeout(10_000)]),
				cache: "no-store",
			}).then((r) =>
				r.ok ? r.json() : null
			);
		async function pull() {
			if (typeof document !== "undefined" && document.hidden) return;
			if (inFlight) return;
			inFlight = true;
			try {
				const [s, p, lb, pr] = (
					await Promise.allSettled([
						get("/api/public/stats"),
						get("/api/public/personas"),
						get("/api/public/leaderboard?enrich=1&limit=12"),
						get("/api/public/presence"),
					])
				).map((r) => (r.status === "fulfilled" ? r.value : null));
				if (!alive) return;
				if (s && typeof s.users === "number") setStats((prev) => ({ ...prev, ...s }));
				// Liste vide valide = plus aucune persona en ligne : on l'applique.
				if (Array.isArray(p?.personas)) setPersonas(p.personas);
				if (Array.isArray(lb?.leaderboard)) setTopMembers(lb.leaderboard);
				if (pr && typeof pr.online === "number") setPresence(pr);
			} finally {
				inFlight = false;
			}
		}

		// Cadence adaptée à ce que le flux temps réel apporte déjà.
		//
		// Le SSE pousse les changements dès qu'ils surviennent : continuer à
		// tirer quatre requêtes toutes les 25 s par-dessus, c'est 576 requêtes
		// par heure et par onglet ouvert vers l'API du bot, pour redemander ce
		// qu'on vient de recevoir. Le sondage garde alors un rôle de filet — il
		// rattrape ce qu'un événement manqué aurait laissé passer — mais à une
		// cadence de filet.
		let id: ReturnType<typeof setInterval> | null = null;
		const armer = (ms: number) => {
			if (id) clearInterval(id);
			id = setInterval(pull, ms);
		};
		cadenceRef.current = armer;
		armer(PERIODE_SANS_FLUX);

		const onVis = () => {
			if (!document.hidden) pull();
		};
		document.addEventListener("visibilitychange", onVis);
		pull();
		return () => {
			alive = false;
			ac.abort();
			if (id) clearInterval(id);
			cadenceRef.current = null;
			document.removeEventListener("visibilitychange", onVis);
		};
	}, []);

	// Le flux se connecte et se coupe au fil de la navigation : la cadence suit.
	useEffect(() => {
		cadenceRef.current?.(connected ? PERIODE_AVEC_FLUX : PERIODE_SANS_FLUX);
	}, [connected]);

	// ── SSE temps réel (a2a/events public) ──────────────────────────────────
	useEffect(() => {
		if (typeof window === "undefined" || !("EventSource" in window)) return;
		let es: EventSource | null = null;
		let retry: ReturnType<typeof setTimeout> | null = null;

		const connect = () => {
			try {
				es = new EventSource(`${API_BASE}/api/a2a/events`);
			} catch {
				return;
			}
			es.onopen = () => setConnected(true);
			es.onmessage = (e) => {
				let type = "event";
				let data: unknown = null;
				try {
					const parsed = JSON.parse(e.data);
					type = parsed.type ?? parsed.event ?? "event";
					data = parsed.data ?? parsed;
				} catch {
					/* keep-alive / message brut */
				}
				if (type === "ping" || type === "keep-alive") return;
				evKey.current += 1;
				const ev: LiveEvent = {
					key: evKey.current,
					type,
					label: labelForEvent(type, data),
				};
				setEvents((prev) => [ev, ...prev].slice(0, 6));
			};
			es.onerror = () => {
				setConnected(false);
				es?.close();
				// Un flux qui tombe peut notifier plusieurs erreurs d'affilée : sans
				// cette annulation, chacune armait sa propre reconnexion et on
				// ouvrait autant de `EventSource` concurrents vers le bot.
				if (retry) clearTimeout(retry);
				retry = setTimeout(connect, 8_000);
			};
		};
		connect();
		return () => {
			es?.close();
			if (retry) clearTimeout(retry);
		};
	}, []);

	const onlineCount = personas.reduce((n, p) => n + (p.online ? 1 : 0), 0);
	return {
		stats,
		personas,
		topMembers,
		presence,
		onlineCount,
		connected,
		events,
	};
}
