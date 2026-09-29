/**
 * Banners DB officiels par série/saga — pour les heros de pages.
 * Manuel curated depuis les 798 assets téléchargés (Toei + DB Official).
 * Aucun reverse-engineering, juste mapping section → asset disponible.
 */
import { API_URL as API } from "@/lib/config";

const SERIES_BANNERS: Record<string, string> = {
	DB: "/banners/banner-17.jpg", // Goku enfant + Shenron (3216x1072 HD)
	DBZ: "/banners/banner-03.png", // Z Warriors Portrait classique (3216x1072 HD)
	DBZ_KAI: "/banners/banner-06.jpg", // Goku SSJ vs Frieza Namek (3216x1072 HD)
	DBZ_KAI_FINAL: "/banners/banner-12.jpg", // Goku SSJ3 Buu (3216x1072 HD)
	DBGT: "/banners/banner-07.jpg", // Goku + Vegeta SSJ4 Apex (3216x1072 HD)
	DBS: "/banners/banner-02.jpg", // Ultra Instinct Maîtrisé (3216x1072 HD)
	DBS_MANGA: "/banners/banner-19.png", // Goku & Gohan SSJ3 (3216x1072 HD)
	DBS_MOVIE: "/banners/banner-15.jpg", // Vegito SSB Spirit Bomb (3216x1072 HD)
	DB_DAIMA: `${API}/db/toei/189-DB-DAIMA-HP-Header-1920x595.png`,
	DB_MOVIE: "/banners/banner-05.jpg", // Mariage Goku & ChiChi classique (3216x1072 HD)
	DBZ_MOVIE: "/banners/banner-09.png", // Gogeta vs Janemba (3216x1072 HD)
	DBZ_OVA: "/banners/banner-01.jpg", // Janemba Démoniaque (3216x1072 HD)
	DBZ_SPECIAL: "/banners/banner-08.jpg", // Goku SSJ Kamehameha (3216x1072 HD)
	DBGT_SPECIAL: "/banners/banner-07.jpg", // Goku + Vegeta SSJ4 Apex (3216x1072 HD)
	DB_DAIMA_MOVIE: `${API}/db/toei/189-DB-DAIMA-HP-Header-1920x595.png`,
};

const SAGAS_HERO = "/banners/banner-04.jpg"; // 5 Super Saiyans ère Cell (3216x1072 HD)
const CHARACTERS_HERO = "/banners/banner-03.png"; // Z Warriors Portrait (3216x1072 HD)
const PLANETS_HERO = "/banners/banner-18.jpg"; // Mondes & Ruines Cosmiques (3216x1072 HD)
const FILMS_HERO = "/banners/banner-09.png"; // Gogeta vs Janemba Cinéma (3216x1072 HD)
export const GAMES_HERO = "/banners/banner-15.jpg"; // Vegito SSB Combats Divins (3216x1072 HD)
const NEWS_HERO = "/banners/banner-10.jpg"; // Goku SSG vs Beerus (3216x1072 HD)
const HOME_HERO = `${API}/db/toei/189-DB-DAIMA-HP-Header-1920x595.png`;

function bannerForSeries(series: string): string {
	return SERIES_BANNERS[series] ?? "/banners/banner-03.png";
}
