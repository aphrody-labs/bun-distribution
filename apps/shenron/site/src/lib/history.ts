"use client";

/**
 * Historique de consultation local — « reprendre où on en était ».
 *
 * Entièrement côté navigateur (`localStorage`), et c'est un choix, pas un pis-aller :
 * le serveur n'a rien à lire, donc aucune page n'a besoin de cookies ni de
 * `headers()`. Or la moindre lecture de session dans un composant rendu par le
 * layout bascule TOUT le site en `cache-control: private, no-store` (piège déjà
 * rencontré avec la nav). Un rail « Reprendre » alimenté côté serveur aurait
 * coûté le cache CDN de l'ensemble du site pour une commodité.
 *
 * Le suivi manga historique (`dbfr_read_chapters` / `dbfr_last_read_chapter`)
 * reste intact : il porte la progression de lecture chapitre par chapitre, que
 * ce module ne remplace pas. Ici on tient un journal transverse épisodes /
 * films / chapitres, trié par dernière visite.
 */

const KEY = "dbfr_history_v1";
/** Au-delà, on oublie les plus anciennes : c'est un raccourci, pas une archive. */
const MAX = 40;

export type HistoryKind = "episode" | "movie" | "chapter" | "databook";

export interface HistoryEntry {
	kind: HistoryKind;
	/** Identifiant stable au sein du `kind` (id numérique ou slug). */
	id: string;
	title: string;
	href: string;
	image?: string | null;
	/** Libellé court affiché sous le titre (« DBZ · épisode 12 »). */
	caption?: string | null;
	/** Horodatage de la dernière visite (ms). */
	at: number;
}

const isEntry = (v: unknown): v is HistoryEntry => {
	if (!v || typeof v !== "object") return false;
	const e = v as Partial<HistoryEntry>;
	return (
		typeof e.id === "string" &&
		typeof e.title === "string" &&
		typeof e.href === "string" &&
		typeof e.at === "number" &&
		(e.kind === "episode" || e.kind === "movie" || e.kind === "chapter" || e.kind === "databook")
	);
};

/** Lecture tolérante : un stockage corrompu ne doit jamais casser une page. */
export function readHistory(): HistoryEntry[] {
	if (typeof window === "undefined") return [];
	try {
		const raw = window.localStorage.getItem(KEY);
		if (!raw) return [];
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(isEntry).toSorted((a, b) => b.at - a.at);
	} catch {
		return [];
	}
}

/**
 * Enregistre (ou remonte) une entrée. Dédoublonnage par `kind:id` — revoir un
 * épisode le remonte en tête plutôt que d'empiler un doublon.
 */
export function recordHistory(entry: Omit<HistoryEntry, "at">): void {
	if (typeof window === "undefined") return;
	try {
		const key = `${entry.kind}:${entry.id}`;
		const next = [
			{ ...entry, at: Date.now() },
			...readHistory().filter((e) => `${e.kind}:${e.id}` !== key),
		].slice(0, MAX);
		window.localStorage.setItem(KEY, JSON.stringify(next));
		// Permet aux rails déjà montés de se rafraîchir sans rechargement.
		window.dispatchEvent(new CustomEvent(HISTORY_EVENT));
	} catch {
		/* quota plein ou stockage refusé (navigation privée) : on abandonne */
	}
}

/** Retire une entrée (bouton « oublier » du rail). */
export function forgetHistory(kind: HistoryKind, id: string): void {
	if (typeof window === "undefined") return;
	try {
		const next = readHistory().filter((e) => !(e.kind === kind && e.id === id));
		window.localStorage.setItem(KEY, JSON.stringify(next));
		window.dispatchEvent(new CustomEvent(HISTORY_EVENT));
	} catch {
		/* ignore */
	}
}

function clearHistory(): void {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.removeItem(KEY);
		window.dispatchEvent(new CustomEvent(HISTORY_EVENT));
	} catch {
		/* ignore */
	}
}

/** Événement émis à chaque écriture — écouté par les rails montés. */
export const HISTORY_EVENT = "dbfr:history";
