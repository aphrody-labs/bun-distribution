import "server-only";
import { dbUniverse } from "@/lib/db-universe";
import { unstable_cache } from "next/cache";

/**
 * Helpers partagés entre la landing `/wiki/episodes` (statique) et la vue série
 * `/wiki/episodes/serie/[series]` (statique). Ces deux routes vivent sous le
 * layout `episodes/` (slot `@modal`) → cliquer une vignette ouvre l'aperçu en
 * modale (interception). Rendre la landing STATIQUE (plus de `searchParams`) est
 * ce qui débloque l'interception ET le cache CDN.
 */
export const SERIES_LABELS: Record<string, string> = {
	DB: "Dragon Ball",
	DBZ: "Dragon Ball Z",
	DBZ_KAI: "Dragon Ball Z Kai",
	DBZ_KAI_FINAL: "Dragon Ball Z Kai – Final Chapters",
	DBGT: "Dragon Ball GT",
	DBS: "Dragon Ball Super",
	DB_DAIMA: "Dragon Ball Daima",
};

export const SERIES_YEARS: Record<string, string> = {
	DB: "1986-1989",
	DBZ: "1989-1996",
	DBZ_KAI: "2009-2011",
	DBZ_KAI_FINAL: "2014-2015",
	DBGT: "1996-1997",
	DBS: "2015-2018",
	DB_DAIMA: "2024-2025",
};

const SERIES_ORDER = ["DB", "DBZ", "DBZ_KAI", "DBZ_KAI_FINAL", "DBGT", "DBS", "DB_DAIMA"];

/** Cartes par rail sur la landing (au-delà → carte « Tout voir »). Un rail n'en
 *  montre ~5 ; 14 suffit largement en réserve de défilement sans alourdir le DOM. */
export const RAIL_CAP = 14;

export const orderSeries = (rows: { series: string }[] | null): string[] =>
	(rows ?? [])
		.map((r) => r.series)
		.toSorted((a, b) => {
			const ia = SERIES_ORDER.indexOf(a);
			const ib = SERIES_ORDER.indexOf(b);
			return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
		});

export const yearOf = (sec: number | null) => (sec ? new Date(sec * 1000).getFullYear() : null);

// Garde `Array.isArray` (piège jsonb scalaire) — cf. lib/media.
export const hasLang = (
	players: { lang?: "vf" | "vostfr" }[] | null,
	lang: "vf" | "vostfr"
): boolean => (Array.isArray(players) ? players : []).some((p) => p.lang === lang);

export { stripSourceTags } from "@/lib/media";

// Mémoïsation des lectures Postgres : les pages sont STATIQUES (prérendu au build
// + ISR) ; ces caches gardent la charge PG basse au (re)prérendu. On throw sur
// vide pour ne pas figer un échec transitoire ; le `.catch` au point d'appel
// restaure le null.
export const getEpisodesCached = unstable_cache(
	async (series: string, limit: number, offset: number) => {
		const data = await dbUniverse.episodes(series, limit, offset);
		if (!data) throw new Error("episodes:empty");
		return data;
	},
	["episodes"],
	{ revalidate: 3600 }
);

export const getEpisodeSeriesCached = unstable_cache(
	async () => {
		const rows = await dbUniverse.episodeSeries();
		if (!rows) throw new Error("episode-series:empty");
		return rows;
	},
	["episode-series"],
	{ revalidate: 3600 }
);
