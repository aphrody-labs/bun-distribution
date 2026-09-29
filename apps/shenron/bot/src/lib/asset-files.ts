/**
 * Disk resolution of the bot's static files through the dedup alias manifest
 * (`@shenron/images/asset-aliases.json`).
 *
 * Byte-identical copies shared with the site (fonts, `dbz/`, banners, brand
 * PNGs, favicons) live once, under `apps/shenron/site/public/`; the bot keeps serving
 * them at their historical `/assets/**` URLs and loads them for canvas from
 * the canonical copy. Roots follow the process cwd (`apps/shenron/bot`), like the rest
 * of the static handlers (`assets/…`, `../site/public/wiki`).
 */
import { resolve } from "node:path";
import { type AssetRoots, resolveAppFile } from "@shenron/images/resolve";

function assetRoots(cwd: string = process.cwd()): AssetRoots {
	return { bot: resolve(cwd), site: resolve(cwd, "..", "site") };
}

/**
 * Absolute disk path of a bot file given relative to `apps/shenron/bot`
 * (`assets/fonts/Inter-Bold.ttf`, `public/favicon.ico`), following aliases.
 */
export function botFile(relative: string, cwd?: string): string {
	return resolveAppFile("bot", relative, assetRoots(cwd));
}
