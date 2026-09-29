/**
 * theme-config — lecture/écriture **server-only** du thème de design global.
 *
 * `getSiteTheme` est mémoïsé par requête (React cache) : le layout racine le lit
 * sur chaque page mais ne tape la DB qu'une fois par rendu. Ne throw jamais →
 * défauts en repli (site inchangé). Écriture via /api/theme-config (gate admin)
 * qui revalide tout le segment layout. Cf. lib/site-theme.ts.
 */
import "server-only";
import { cache } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { siteTheme } from "@/db/schema";
import { DEFAULT_SITE_THEME, resolveSiteTheme, type SiteTheme } from "@/lib/site-theme";

const SINGLETON_ID = "default";

export const getSiteTheme = cache(async (): Promise<SiteTheme> => {
	try {
		const [row] = await db.select().from(siteTheme).where(eq(siteTheme.id, SINGLETON_ID)).limit(1);
		if (!row) return DEFAULT_SITE_THEME;
		return resolveSiteTheme(row.data);
	} catch (e) {
		console.error("[site-theme] lecture échouée, repli sur les défauts :", e);
		return DEFAULT_SITE_THEME;
	}
});

export async function saveSiteTheme(patch: unknown, by?: string | null): Promise<SiteTheme> {
	const resolved = resolveSiteTheme(patch);
	const data = resolved as unknown as Record<string, unknown>;
	await db
		.insert(siteTheme)
		.values({ id: SINGLETON_ID, data, updatedBy: by ?? null, updatedAt: new Date() })
		.onConflictDoUpdate({
			target: siteTheme.id,
			set: { data, updatedBy: by ?? null, updatedAt: new Date() },
		});
	return resolved;
}
