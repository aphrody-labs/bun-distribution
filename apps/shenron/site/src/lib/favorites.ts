"use client";

/**
 * Favoris — local d'abord, synchronisés en base pour les comptes connectés.
 *
 * « Local d'abord » n'est pas un raccourci : un visiteur anonyme doit pouvoir
 * mettre en favori sans créer de compte, et la lecture ne doit JAMAIS passer par
 * le serveur au rendu — une page qui lit la session bascule tout le site en
 * `no-store` (piège déjà rencontré avec la nav). Les boutons sont donc des îlots
 * clients, et le stockage de référence est `localStorage`.
 *
 * Pour un compte connecté, `/api/favorites` conserve la même liste dans
 * `public.user_preferences.prefs.favorites` (jsonb libre, aucune migration).
 * À la connexion, les deux côtés sont FUSIONNÉS et non écrasés : mettre en
 * favori depuis son téléphone puis se connecter sur l'ordinateur ne doit rien
 * effacer.
 */

const KEY = "dbfr_favorites_v1";
export const FAVORITES_EVENT = "dbfr:favorites";

export type FavoriteKind =
	| "episode"
	| "movie"
	| "chapter"
	| "databook"
	| "character"
	| "saga"
	| "game";

export interface Favorite {
	kind: FavoriteKind;
	id: string;
	title: string;
	href: string;
	image?: string | null;
	caption?: string | null;
	at: number;
}

const favKey = (kind: FavoriteKind, id: string) => `${kind}:${id}`;

const isFavorite = (v: unknown): v is Favorite => {
	if (!v || typeof v !== "object") return false;
	const f = v as Partial<Favorite>;
	return (
		typeof f.id === "string" &&
		typeof f.title === "string" &&
		typeof f.href === "string" &&
		typeof f.at === "number" &&
		typeof f.kind === "string"
	);
};

export function readFavorites(): Favorite[] {
	if (typeof window === "undefined") return [];
	try {
		const raw = window.localStorage.getItem(KEY);
		if (!raw) return [];
		const parsed: unknown = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.filter(isFavorite).toSorted((a, b) => b.at - a.at) : [];
	} catch {
		return [];
	}
}

function write(list: Favorite[]): void {
	try {
		window.localStorage.setItem(KEY, JSON.stringify(list));
		window.dispatchEvent(new CustomEvent(FAVORITES_EVENT));
	} catch {
		/* quota / navigation privée */
	}
	void push(list);
}

export function isFavorited(kind: FavoriteKind, id: string): boolean {
	const k = favKey(kind, id);
	return readFavorites().some((f) => favKey(f.kind, f.id) === k);
}

/** Bascule et renvoie le nouvel état. */
export function toggleFavorite(entry: Omit<Favorite, "at">): boolean {
	const k = favKey(entry.kind, entry.id);
	const current = readFavorites();
	const exists = current.some((f) => favKey(f.kind, f.id) === k);
	write(
		exists
			? current.filter((f) => favKey(f.kind, f.id) !== k)
			: [{ ...entry, at: Date.now() }, ...current]
	);
	return !exists;
}

// ── Synchronisation serveur ────────────────────────────────────────────────

/** Anti-rafale : plusieurs bascules rapprochées n'écrivent qu'une fois. */
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let synced = false;

async function push(list: Favorite[]): Promise<void> {
	if (typeof window === "undefined" || !synced) return;
	if (pushTimer) clearTimeout(pushTimer);
	pushTimer = setTimeout(() => {
		void fetch("/api/favorites", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			credentials: "include",
			body: JSON.stringify({ favorites: list }),
			// La synchro est un confort : son échec ne doit rien interrompre.
			keepalive: true,
		}).catch(() => {});
	}, 800);
}

/**
 * Fusionne les favoris du serveur avec ceux du navigateur. À appeler une fois
 * par session, quand on sait l'utilisateur connecté. En cas de doublon, la
 * version la plus récente gagne.
 */
export async function syncFavorites(): Promise<void> {
	if (typeof window === "undefined" || synced) return;
	synced = true;
	try {
		const res = await fetch("/api/favorites", { credentials: "include" });
		if (!res.ok) return;
		const data = (await res.json()) as { favorites?: unknown };
		const remote = Array.isArray(data.favorites) ? data.favorites.filter(isFavorite) : [];
		const byKey = new Map<string, Favorite>();
		for (const f of [...remote, ...readFavorites()]) {
			const k = favKey(f.kind, f.id);
			const prev = byKey.get(k);
			if (!prev || f.at > prev.at) byKey.set(k, f);
		}
		const merged = [...byKey.values()].toSorted((a, b) => b.at - a.at);
		window.localStorage.setItem(KEY, JSON.stringify(merged));
		window.dispatchEvent(new CustomEvent(FAVORITES_EVENT));
		void push(merged);
	} catch {
		/* hors ligne : on garde le local */
	}
}
