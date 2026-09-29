/**
 * Bannières de pages & séries — types + défauts **client-safe**.
 *
 * Aucune dépendance server-only : importé par l'éditeur admin (`/admin/banners`)
 * et par `lib/banner-config.ts` (lecture/écriture PG). Les valeurs sont des URL
 * absolues (`https://bot…/db/…`) ou des chemins d'asset (`./assets/wiki/…`)
 * résolus via `resolveBannerUrl`.
 */
import { API_URL as API } from "@/lib/config";
import { assetUrl } from "@/lib/assets";

/** Clés des heros de pages (landing / index). */
export const PAGE_HERO_KEYS = [
	"episodes",
	"films",
	"chronologie",
	"personnages",
	"sagas",
	"arcs",
	"races",
	"transformations",
	"techniques",
	"jeux",
	"manga",
	"databooks",
	"combats",
	"dragons",
	"lieux",
	"musiques",
	"objets",
	"puissances",
	"tournois",
	"voix",
	"news",
	"tools",
	"romans",
	"staff",
] as const;

export type PageHeroKey = (typeof PAGE_HERO_KEYS)[number];

/** Libellés FR pour l'admin. */
export const PAGE_HERO_LABELS: Record<PageHeroKey, string> = {
	episodes: "Épisodes (landing)",
	films: "Films (landing)",
	chronologie: "Chronologie",
	personnages: "Personnages / planètes",
	sagas: "Sagas & arcs",
	arcs: "Arcs (redirigé → sagas)",
	races: "Races",
	transformations: "Transformations",
	techniques: "Techniques",
	jeux: "Jeux vidéo",
	manga: "Manga (repli sans cover)",
	databooks: "Databooks (repli sans cover)",
	combats: "Combats légendaires",
	dragons: "Dragons et vœux",
	lieux: "Lieux et sanctuaires",
	musiques: "Musiques et génériques",
	objets: "Objets et technologies",
	puissances: "Niveaux de puissance",
	tournois: "Tournois",
	voix: "Casting vocal",
	news: "Actualités / news wiki",
	tools: "Outils communautaires",
	romans: "Romans & Light Novels",
	staff: "Autour de Dragon Ball (Staff & Toriyama)",
};

/** Séries anime / films ayant une bannière dédiée. */
export const SERIES_BANNER_KEYS = [
	"DB",
	"DBZ",
	"DBZ_KAI",
	"DBZ_KAI_FINAL",
	"DBGT",
	"DBS",
	"DBS_MANGA",
	"DBS_MOVIE",
	"DB_DAIMA",
	"DB_MOVIE",
	"DBZ_MOVIE",
	"DBZ_OVA",
	"DBZ_SPECIAL",
	"DBGT_SPECIAL",
	"DB_DAIMA_MOVIE",
] as const;

export type SeriesBannerKey = (typeof SERIES_BANNER_KEYS)[number];

export const SERIES_BANNER_LABELS: Record<SeriesBannerKey, string> = {
	DB: "Dragon Ball",
	DBZ: "Dragon Ball Z",
	DBZ_KAI: "Dragon Ball Z Kai",
	DBZ_KAI_FINAL: "DBZ Kai – Final Chapters",
	DBGT: "Dragon Ball GT",
	DBS: "Dragon Ball Super",
	DBS_MANGA: "DBS Manga",
	DBS_MOVIE: "DBS Films",
	DB_DAIMA: "Dragon Ball Daima",
	DB_MOVIE: "Films DB",
	DBZ_MOVIE: "Films DBZ",
	DBZ_OVA: "OVA DBZ",
	DBZ_SPECIAL: "Spéciaux DBZ",
	DBGT_SPECIAL: "Spéciaux GT",
	DB_DAIMA_MOVIE: "Films Daima",
};

const FALLBACK = "/banners/banner-03.png";
const HD_DB_GOKU_SHENRON = "/banners/banner-17.jpg"; // DB Enfant + Shenron (3216x1072)
const HD_DBZ_WARRIORS = "/banners/banner-03.png"; // Z Warriors (3216x1072)
const HD_DBZ_CELL_ERA = "/banners/banner-04.jpg"; // 5 Super Saiyans (3216x1072)
const HD_DBZ_NAMEK = "/banners/banner-06.jpg"; // Goku SSJ vs Frieza (3216x1072)
const HD_DBZ_BUU = "/banners/banner-12.jpg"; // Goku SSJ3 (3216x1072)
const HD_DBGT = "/banners/banner-07.jpg"; // Goku & Vegeta SSJ4 (3216x1072)
const HD_DBS_UI = "/banners/banner-02.jpg"; // Ultra Instinct (3216x1072)
const HD_FILMS = "/banners/banner-09.png"; // Gogeta vs Janemba (3216x1072)
const HD_GAMES = "/banners/banner-15.jpg"; // Vegito SSB (3216x1072)
const HD_TRANSFO = "/banners/banner-19.png"; // Goku & Gohan SSJ3 (3216x1072)
const HD_NEWS = "/banners/banner-10.jpg"; // Goku SSG vs Beerus (3216x1072)
const TOEI_DAIMA = `${API}/db/toei/189-DB-DAIMA-HP-Header-1920x595.png`;

export interface PageBannersConfig {
	/** Hero / billboard par page (clé → URL ou chemin asset). */
	pages: Record<PageHeroKey, string>;
	/** Bannière par code série (`DB`, `DBZ`, …). */
	series: Record<string, string>;
	/** Repli si série inconnue. */
	fallback: string;
}

/** Défauts = mapping haute définition 3216x1072 canonique Dragon Ball. */
export const DEFAULT_PAGE_BANNERS: PageBannersConfig = {
	pages: {
		episodes: HD_DBZ_WARRIORS,
		films: HD_FILMS,
		chronologie: HD_DBZ_WARRIORS,
		personnages: HD_DBZ_WARRIORS,
		sagas: HD_DBZ_CELL_ERA,
		arcs: HD_DBZ_CELL_ERA,
		races: HD_DBZ_WARRIORS,
		transformations: HD_TRANSFO,
		techniques: HD_DBZ_NAMEK,
		jeux: HD_GAMES,
		manga: HD_DB_GOKU_SHENRON,
		databooks: "/banners/banner-14.jpg",
		// Correspondances éditoriales : bannières HD déjà livrées par le site,
		// sans image de fan ni génération artificielle.
		combats: HD_DBZ_NAMEK,
		dragons: HD_DB_GOKU_SHENRON,
		lieux: HD_DB_GOKU_SHENRON,
		musiques: HD_DBZ_WARRIORS,
		objets: HD_DB_GOKU_SHENRON,
		puissances: HD_DBZ_NAMEK,
		tournois: HD_DBZ_WARRIORS,
		voix: HD_DBZ_WARRIORS,
		news: HD_NEWS,
		tools: HD_GAMES,
		romans: "/banners/banner-14.jpg",
		staff: HD_DB_GOKU_SHENRON,
	},
	series: {
		DB: HD_DB_GOKU_SHENRON,
		DBZ: HD_DBZ_WARRIORS,
		DBZ_KAI: HD_DBZ_NAMEK,
		DBZ_KAI_FINAL: HD_DBZ_BUU,
		DBGT: HD_DBGT,
		DBS: HD_DBS_UI,
		DBS_MANGA: HD_TRANSFO,
		DBS_MOVIE: HD_GAMES,
		DB_DAIMA: TOEI_DAIMA,
		DB_MOVIE: "/banners/banner-05.jpg",
		DBZ_MOVIE: HD_FILMS,
		DBZ_OVA: "/banners/banner-01.jpg",
		DBZ_SPECIAL: "/banners/banner-08.jpg",
		DBGT_SPECIAL: HD_DBGT,
		DB_DAIMA_MOVIE: TOEI_DAIMA,
	},
	fallback: FALLBACK,
};

/** Normalise une valeur stockée en URL affichable. */
export function resolveBannerUrl(path: string | null | undefined, fallback = FALLBACK): string {
	const raw = (path ?? "").trim();
	if (!raw) return fallback;
	if (/^https?:\/\//i.test(raw)) return raw;
	const resolved = assetUrl(raw);
	return resolved || fallback;
}

/** Fusionne un patch partiel (DB) avec les défauts — ne throw jamais. */
export function resolvePageBanners(patch: unknown): PageBannersConfig {
	const base = structuredClone(DEFAULT_PAGE_BANNERS);
	if (!patch || typeof patch !== "object") return base;
	const p = patch as Record<string, unknown>;

	if (typeof p.fallback === "string" && p.fallback.trim()) {
		base.fallback = p.fallback.trim();
	}

	if (p.pages && typeof p.pages === "object") {
		const pages = p.pages as Record<string, unknown>;
		for (const key of PAGE_HERO_KEYS) {
			const v = pages[key];
			if (typeof v === "string" && v.trim()) base.pages[key] = v.trim();
		}
	}

	if (p.series && typeof p.series === "object") {
		const series = p.series as Record<string, unknown>;
		for (const [k, v] of Object.entries(series)) {
			if (typeof v === "string" && v.trim()) base.series[k] = v.trim();
		}
	}

	return base;
}
