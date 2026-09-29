/**
 * banner-config — lecture/écriture **server-only** des bannières de pages.
 *
 * Table `PageBanners` (schéma public), singleton `default`. Les pages wiki
 * (épisodes, films…) lisent ici la config résolue ; l'éditeur `/admin/banners`
 * l'écrit via `/api/banner-config`. Repli sur les défauts si table absente / DB
 * KO → site strictement identique à l'ancien hardcode.
 */
import "server-only";
import { cache } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { pageBanners } from "@/db/schema";
import {
	DEFAULT_PAGE_BANNERS,
	resolveBannerUrl,
	resolvePageBanners,
	type PageBannersConfig,
	type PageHeroKey,
} from "@/lib/page-banners";

const SINGLETON_ID = "default";

/** Config résolue (mémoïsée par requête React). Ne throw jamais. */
export const getPageBanners = cache(async (): Promise<PageBannersConfig> => {
	try {
		const [row] = await db
			.select()
			.from(pageBanners)
			.where(eq(pageBanners.id, SINGLETON_ID))
			.limit(1);
		if (!row) return structuredClone(DEFAULT_PAGE_BANNERS);
		return resolvePageBanners(row.data);
	} catch (e) {
		console.error("[page-banners] lecture échouée, repli défauts :", e);
		return structuredClone(DEFAULT_PAGE_BANNERS);
	}
});

/** Upsert singleton → renvoie la config résolue. */
export async function savePageBanners(
	patch: unknown,
	by?: string | null
): Promise<PageBannersConfig> {
	const resolved = resolvePageBanners(patch);
	const data = resolved as unknown as Record<string, unknown>;
	await db
		.insert(pageBanners)
		.values({ id: SINGLETON_ID, data, updatedBy: by ?? null, updatedAt: new Date() })
		.onConflictDoUpdate({
			target: pageBanners.id,
			set: { data, updatedBy: by ?? null, updatedAt: new Date() },
		});
	return resolved;
}

/** URL affichable pour le hero d'une page (landing). */
export async function pageHero(key: PageHeroKey): Promise<string> {
	const cfg = await getPageBanners();
	return resolveBannerUrl(cfg.pages[key], cfg.fallback);
}

/** URL affichable pour la bannière d'une série (`DB`, `DBZ`, …). */
export async function bannerForSeries(series: string): Promise<string> {
	const cfg = await getPageBanners();
	const raw = cfg.series[series] ?? cfg.fallback;
	return resolveBannerUrl(raw, cfg.fallback);
}
