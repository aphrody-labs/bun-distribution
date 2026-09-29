/**
 * Helpers d'assets/URL **client-safe** (aucune dépendance server-only).
 *
 * Isolés de `shenron.ts` / `db-universe.ts` (désormais server-only car ils
 * tapent Neon via Drizzle) : ces fonctions sont importées par des Client
 * Components (jeu 2048, carte profil, admin DB). Les y laisser ferait fuiter
 * `postgres`/`drizzle` dans le bundle client.
 */
import { API_URL, ASSET_BASE } from "@/lib/config";

/**
 * Normalise un chemin d'asset DB (`./assets/...` ou `assets/...`) en URL
 * absolue servie par le bot. Les URL http(s) déjà absolues sont renvoyées
 * telles quelles.
 */
export function assetUrl(path: string | null | undefined): string {
	const value = path?.trim();
	if (!value) return "";
	if (/^https?:\/\//i.test(value)) return value;
	// Un chemin qui commence par « / » (et non « ./ ») est DÉJÀ une URL de ce
	// site — `/wiki/taopaipai.poster.webp`, servi par `public/`. Le préfixer de
	// l'hôte du bot produisait `https://bot.dragonballfr.com/wiki/…`, hors des
	// `remotePatterns` de `next.config.ts` (qui n'ouvrent que `/db/**` et
	// `/assets/**`) : `next/image` lève à la construction du src, et c'est la
	// PAGE ENTIÈRE qui tombe sur sa frontière d'erreur. L'accueil ne le montrait
	// qu'un tirage sur deux, les clips de fond étant piochés au hasard.
	// Vérifié en base avant d'ouvrir ce cas : aucune des 16 colonnes d'image du
	// schéma `bot` ne contient de valeur commençant par « / ».
	if (value.startsWith("/")) return value;
	const clean = value.replace(/^\.?\/*/, "");
	// Tous les assets — y compris `assets/wiki/*` uploadés à l'admin — sont servis
	// par le bot. NE PAS réécrire `assets/wiki/` → `/wiki/` (même origine) : le
	// dossier `public/` de Next est indexé au build, donc une image uploadée au
	// runtime y est masquée par la route catch-all `/wiki/[...slug]` (→ HTML, d'où
	// la vignette cassée). Le bot sert le même fichier (`../site/public/wiki/...`)
	// via `/assets/wiki/...` sans collision de route.
	return `${ASSET_BASE}/${clean}`;
}

/**
 * Playlist maître du proxy HLS, TOUJOURS sur l'hôte du bot.
 *
 * Le proxy vit sur le bot parce que les flux résolus sont liés à l'IP qui les a
 * résolus. Les pages l'appelaient via `assetUrl("/api/hls/…")` — mais un chemin
 * qui commence par « / » est rendu tel quel (cf. ci-dessus), donc relatif au
 * SITE : `dragonballfr.com/api/hls/154/master.m3u8` répondait 404 (mesuré le
 * 2026-09-13), pendant que le même chemin sur le bot servait la playlist.
 *
 * @param id    identifiant du proxy : `<id épisode>` ou `movie-<id film>`
 * @param lang  variante audio ; `vostfr` = audio japonais
 */
export function hlsMasterUrl(id: string | number, lang?: "vf" | "vostfr"): string {
	return `${API_URL}/api/hls/${id}/master.m3u8${lang ? `?lang=${lang}` : ""}`;
}

/**
 * URL de la carte profil PNG générée par le canvas du bot (8 thèmes).
 */
export function getProfileCardUrl(discordId: string, theme?: string): string {
	const q = theme ? `?theme=${encodeURIComponent(theme)}` : "";
	return `${API_URL}/api/public/profile/${encodeURIComponent(discordId)}/card.png${q}`;
}

/**
 * Browser-only : s'abonne aux events SSE temps réel du bot (level-up,
 * achievement, fusion, message-xp). Retourne un cleanup pour fermer la
 * connexion. À appeler depuis un Client Component (`useEffect`).
 */
function subscribeBotEvents(
	onEvent: (event: { type: string; data: unknown }) => void,
	opts?: { types?: string[] }
): () => void {
	if (typeof window === "undefined") {
		throw new Error("subscribeBotEvents() must be called from a Client Component");
	}
	const url = `${API_URL}/api/a2a/events${
		opts?.types?.length ? `?types=${opts.types.join(",")}` : ""
	}`;
	const es = new EventSource(url);
	es.onmessage = (e) => {
		try {
			onEvent(JSON.parse(e.data));
		} catch {
			/* ignore malformed */
		}
	};
	return () => es.close();
}
