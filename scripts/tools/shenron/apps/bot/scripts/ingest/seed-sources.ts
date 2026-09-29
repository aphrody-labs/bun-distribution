#!/usr/bin/env bun
/**
 * seed-sources — peuple db_licenses + db_sources (registre des origines).
 * Idempotent : run autant de fois que voulu.
 */
import { db } from "./_db";
import { dbLicenses, dbSources } from "../../src/db/schema";

const LICENSES = [
	{
		key: "MIT",
		name: "MIT License",
		url: "https://opensource.org/license/mit/",
		requiresAttribution: true,
		shareAlike: false,
	},
	{
		key: "CC-BY-SA-3",
		name: "Creative Commons BY-SA 3.0",
		url: "https://creativecommons.org/licenses/by-sa/3.0/",
		requiresAttribution: true,
		shareAlike: true,
	},
	{
		key: "CC-BY-SA-4",
		name: "Creative Commons BY-SA 4.0",
		url: "https://creativecommons.org/licenses/by-sa/4.0/",
		requiresAttribution: true,
		shareAlike: true,
	},
	{
		key: "FAIR-USE-EDITORIAL",
		name: "Fair use éditorial fan-site (non commercial)",
		url: "https://dragonballfr.com/licence",
		requiresAttribution: true,
		shareAlike: false,
	},
	{
		key: "API-PUBLIC",
		name: "API publique avec attribution",
		url: null,
		requiresAttribution: true,
		shareAlike: false,
	},
] as const;

const SOURCES = [
	{
		id: "dragonball-api",
		name: "dragonball-api.com",
		url: "https://dragonball-api.com/",
		licenseKey: "MIT",
		attributionTemplate: "dragonball-api.com (OSS MIT)",
	},
	{
		id: "bandai-eu",
		name: "Bandai Namco Entertainment EU",
		url: "https://en.bandainamcoent.eu/dragon-ball",
		licenseKey: "FAIR-USE-EDITORIAL",
		attributionTemplate: "© Bandai Namco Entertainment",
	},
	{
		id: "dbofficial-fr",
		name: "Site officiel Dragon Ball FR",
		url: "https://fr.dragon-ball-official.com/",
		licenseKey: "FAIR-USE-EDITORIAL",
		attributionTemplate: "© Bird Studio / Shueisha / Toei Animation",
	},
	{
		id: "dbofficial-en",
		name: "Dragon Ball Official Site EN",
		url: "https://en.dragon-ball-official.com/",
		licenseKey: "FAIR-USE-EDITORIAL",
		attributionTemplate: "© Bird Studio / Shueisha / Toei Animation",
	},
	{
		id: "toei-animation",
		name: "Toei Animation",
		url: "https://www.toei-animation.com/catalog/dragon-ball/",
		licenseKey: "FAIR-USE-EDITORIAL",
		attributionTemplate: "© Toei Animation",
	},
	{
		id: "shueisha",
		name: "Shueisha (corporate)",
		url: "https://www.shueisha.co.jp/",
		licenseKey: "FAIR-USE-EDITORIAL",
		attributionTemplate: "© Shueisha",
	},
	{
		id: "shonenjump-plus",
		name: "Shōnen Jump+ (Shueisha)",
		url: "https://shonenjumpplus.com/",
		licenseKey: "FAIR-USE-EDITORIAL",
		attributionTemplate: "© Shueisha — Shōnen Jump+",
	},
	{
		id: "viz-media",
		name: "Viz Media",
		url: "https://www.viz.com/shonenjump/chapters/dragon-ball-super",
		licenseKey: "FAIR-USE-EDITORIAL",
		attributionTemplate: "© Viz Media / Shueisha",
	},
	{
		id: "kanzenshuu",
		name: "Kanzenshuu (fan-site historique)",
		url: "https://kanzenshuu.com/",
		licenseKey: "FAIR-USE-EDITORIAL",
		attributionTemplate: "© Kanzenshuu — fan-site",
	},
	{
		id: "jikan",
		name: "Jikan (MyAnimeList scraper)",
		url: "https://jikan.moe/",
		licenseKey: "API-PUBLIC",
		attributionTemplate: "MyAnimeList via Jikan",
	},
	{
		id: "anilist",
		name: "AniList",
		url: "https://anilist.co/",
		licenseKey: "API-PUBLIC",
		attributionTemplate: "AniList",
	},
	{
		id: "kitsu",
		name: "Kitsu.io",
		url: "https://kitsu.io/",
		licenseKey: "API-PUBLIC",
		attributionTemplate: "Kitsu.io",
	},
] as const;

const lic = await db.select().from(dbLicenses);
if (lic.length === 0) {
	await db.insert(dbLicenses).values(LICENSES);
}
const src = await db.select().from(dbSources);
if (src.length === 0) {
	await db.insert(dbSources).values(SOURCES);
}
console.log(`OK seed-sources : ${LICENSES.length} licences, ${SOURCES.length} sources`);
