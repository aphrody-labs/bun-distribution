/**
 * Mapping between paths stored in the database and files on disk.
 *
 * Measured facts (see docs/pieges.md): a DB path is never a disk path.
 *  - `./assets/wiki/<x>` and `assets/wiki/<x>` → `apps/site/public/wiki/<x>`
 *  - `./assets/<other>`                       → `apps/bot/assets/<other>`
 *  - `/db/<x>` (mirror)                        → `apps/bot/public/db/<x>`
 * The bot serves the first two under `/assets/…` and the mirror under `/db/…`.
 */
import { join, normalize } from "node:path";
import ASSET_ALIASES_JSON from "./asset-aliases.json" with { type: "json" };

export interface AssetRoots {
	/** apps/bot */
	bot: string;
	/** apps/site */
	site: string;
}

export function normalizeDbPath(p: string): string {
	return p.trim().replace(/^\.?\/+/, "");
}

function toPosix(p: string): string {
	return normalize(p).replaceAll("\\", "/");
}

/**
 * Deduplicated binaries: `<app>/<root>/<path>` → canonical `<app>/<root>/<path>`
 * (paths relative to `apps/`). Each alias is a byte-identical copy that was
 * removed from disk; its public URL keeps answering through this map (bot
 * `/assets/**`, bot favicons, Next redirects for `apps/site/public`).
 * Regenerate and verify with `packages/images/tests/asset-aliases.test.ts`.
 */
export const ASSET_ALIASES: Readonly<Record<string, string>> = ASSET_ALIASES_JSON;

function aliasToDisk(appRelative: string, roots: AssetRoots): string | null {
	const target = ASSET_ALIASES[appRelative];
	if (!target) return null;
	const [app, ...rest] = target.split("/");
	if (app !== "bot" && app !== "site") return null;
	return toPosix(join(roots[app], ...rest));
}

/**
 * Disk path for a file of an app root, following {@link ASSET_ALIASES} when the
 * copy was deduplicated. `relative` is relative to the app (`assets/fonts/x.ttf`,
 * `public/favicon.ico`). No existence check: the caller decides.
 */
export function resolveAppFile(app: keyof AssetRoots, relative: string, roots: AssetRoots): string {
	const clean = normalizeDbPath(relative.replaceAll("\\", "/"));
	return aliasToDisk(`${app}/${clean}`, roots) ?? toPosix(join(roots[app], clean));
}

/**
 * Site `public/` aliases as `[fromUrlPath, toUrlPath]` pairs, for Next
 * `redirects()`: a removed duplicate URL answers with its canonical copy.
 */
export function sitePublicRedirects(): Array<[string, string]> {
	const out: Array<[string, string]> = [];
	for (const [from, to] of Object.entries(ASSET_ALIASES)) {
		if (from.startsWith("site/public/") && to.startsWith("site/public/")) {
			out.push([from.slice("site/public".length), to.slice("site/public".length)]);
		}
	}
	return out;
}

/** Absolute disk path for a DB path, or null if it is external (http) or unknown. */
export function dbPathToDisk(dbPath: string | null | undefined, roots: AssetRoots): string | null {
	if (!dbPath) return null;
	const p = dbPath.trim();
	if (/^https?:\/\//i.test(p)) return null;
	const clean = normalizeDbPath(p);
	if (clean.includes("..") || clean.includes("\0")) return null;
	if (clean.startsWith("db/")) return toPosix(join(roots.bot, "public", clean));
	if (clean.startsWith("assets/wiki/"))
		return toPosix(join(roots.site, "public", clean.slice("assets/".length)));
	if (clean.startsWith("assets/")) return resolveAppFile("bot", clean, roots);
	return null;
}

/** Inverse mapping: absolute disk path → canonical DB path (`./assets/…` or `db/…`), or null. */
export function diskToDbPath(disk: string, roots: AssetRoots): string | null {
	const botAssets = toPosix(join(roots.bot, "assets")) + "/";
	const botDb = toPosix(join(roots.bot, "public", "db")) + "/";
	const siteWiki = toPosix(join(roots.site, "public", "wiki")) + "/";
	const d = toPosix(disk);
	// `apps/bot/assets/wiki/` is a dead root: the bot serves `/assets/wiki/*` from
	// `apps/site/public/wiki/` only, so a file there has no servable DB path.
	if (d.startsWith(botAssets + "wiki/")) return null;
	if (d.startsWith(siteWiki)) return `./assets/wiki/${d.slice(siteWiki.length)}`;
	if (d.startsWith(botAssets)) return `./assets/${d.slice(botAssets.length)}`;
	if (d.startsWith(botDb)) return `db/${d.slice(botDb.length)}`;
	return null;
}

/** URL path served by the bot for a DB path (`/assets/…` or `/db/…`). */
export function dbPathToUrlPath(dbPath: string): string | null {
	const clean = normalizeDbPath(dbPath);
	if (clean.startsWith("db/")) return `/${clean.split("/").map(encodeURIComponent).join("/")}`;
	if (clean.startsWith("assets/"))
		return `/${clean.split("/").map(encodeURIComponent).join("/")}`;
	return null;
}

export const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif"]);

export function isImagePath(p: string): boolean {
	const m = /\.[a-z0-9]+$/i.exec(p);
	return m ? IMAGE_EXTENSIONS.has(m[0].toLowerCase()) : false;
}
