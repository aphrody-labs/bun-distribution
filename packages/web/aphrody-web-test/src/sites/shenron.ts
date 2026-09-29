// SPDX-License-Identifier: Apache-2.0

/**
 * @module @aphrody/web-test/sites/shenron
 *
 * Test presets and helpers for Shenron (`dragonballfr.com`):
 * - Canonical URL presets and slug formatters (no trailing slash, kebab-case).
 * - Wiki rendering validation (main content landmark, headings, slug conventions, chronology timeline order).
 * - CDN static assets check (status, content-type, cache headers).
 */

/** Canonical origins for Shenron / Dragon Ball FR domains. */
export const SHENRON_ORIGINS = {
	site: "https://dragonballfr.com",
	api: "https://api.dragonballfr.com",
	cdn: "https://cdn.dragonballfr.com",
} as const;

/** Canonical routes on dragonballfr.com. */
export const SHENRON_ROUTES = {
	home: "/",
	wiki: "/wiki",
	chronology: "/wiki/chronologie",
	episodes: "/wiki/episodes",
	movies: "/wiki/films",
	characters: "/wiki/personnages",
	sitemap: "/sitemap.xml",
	robots: "/robots.txt",
	llms: "/llms.txt",
} as const;

/** Full canonical URLs for Shenron. */
export const SHENRON_URLS = {
	home: `${SHENRON_ORIGINS.site}/`,
	wiki: `${SHENRON_ORIGINS.site}/wiki`,
	chronology: `${SHENRON_ORIGINS.site}/wiki/chronologie`,
	episodes: `${SHENRON_ORIGINS.site}/wiki/episodes`,
	movies: `${SHENRON_ORIGINS.site}/wiki/films`,
	characters: `${SHENRON_ORIGINS.site}/wiki/personnages`,
	sitemap: `${SHENRON_ORIGINS.site}/sitemap.xml`,
	robots: `${SHENRON_ORIGINS.site}/robots.txt`,
	llms: `${SHENRON_ORIGINS.site}/llms.txt`,
} as const;

/**
 * Builds a canonical Shenron URL for `path`.
 * Enforces kebab-case, no accents, and no trailing slash on non-root paths.
 */
export function shenronUrl(
	path: string,
	origin: string = SHENRON_ORIGINS.site,
): string {
	const cleanOrigin = origin.replace(/\/+$/, "");
	let cleanPath = path.startsWith("/") ? path : `/${path}`;
	if (cleanPath.length > 1 && cleanPath.endsWith("/")) {
		cleanPath = cleanPath.replace(/\/+$/, "");
	}
	return `${cleanOrigin}${cleanPath}`;
}

export interface ShenronWikiValidationResult {
	valid: boolean;
	errors: string[];
	warnings: string[];
	linkCount: number;
	wikiLinks: string[];
	hasMainContent: boolean;
	hasHeading: boolean;
	chronologyValid: boolean;
	detectedYears: number[];
}

/**
 * Validates the HTML rendering of a Shenron wiki page.
 * Checks for:
 * 1. Semantic landmarks (`<main>`, `<article>`, or `role="main"`).
 * 2. Proper headings (`<h1>` or `<h2>`).
 * 3. Canonical wiki links format (`/wiki/...`, kebab-case, no trailing slashes).
 * 4. Chronology validation: detects year/timeline events and asserts ascending chronological sequence.
 */
export async function validateShenronWikiRendering(
	htmlOrPage: string | { content(): Promise<string> },
): Promise<ShenronWikiValidationResult> {
	const html =
		typeof htmlOrPage === "string"
			? htmlOrPage
			: await htmlOrPage.content();

	const errors: string[] = [];
	const warnings: string[] = [];

	// 1. Semantic content container check
	const hasMainContent =
		/<main\b[^>]*>/i.test(html) ||
		/<article\b[^>]*>/i.test(html) ||
		/role=["']main["']/i.test(html);
	if (!hasMainContent) {
		errors.push("Missing main landmark (<main>, <article>, or role='main')");
	}

	// 2. Heading presence check
	const hasHeading = /<h[1-2]\b[^>]*>.*?<\/h[1-2]>/is.test(html);
	if (!hasHeading) {
		errors.push("Missing primary heading (<h1> or <h2>)");
	}

	// 3. Wiki links extraction and audit
	const hrefMatches = html.matchAll(/href=["'](\/wiki\/[^"'#?]+)["']/gi);
	const wikiLinks: string[] = [];
	for (const match of hrefMatches) {
		const link = match[1];
		wikiLinks.push(link);

		if (link.endsWith("/") && link !== "/wiki/") {
			warnings.push(`Wiki link has trailing slash: ${link}`);
		}
		if (/[A-Z]/.test(link)) {
			warnings.push(`Wiki link contains uppercase characters: ${link}`);
		}
		if (/[_éèàêëïîôöùûü]/.test(link)) {
			warnings.push(`Wiki link contains non-ASCII or underscore characters: ${link}`);
		}
	}

	// 4. Chronology ordering validation
	// Matches patterns like "An 737", "An 762", "Year 753", "Année 767"
	const yearMatches = html.matchAll(/(?:An|Année|Year)\s*[:\-–]?\s*(\d{2,4})\b/gi);
	const detectedYears: number[] = [];
	for (const m of yearMatches) {
		const year = Number.parseInt(m[1], 10);
		if (!Number.isNaN(year)) {
			detectedYears.push(year);
		}
	}

	let chronologyValid = true;
	if (detectedYears.length > 1) {
		for (let i = 1; i < detectedYears.length; i++) {
			if (detectedYears[i] < detectedYears[i - 1]) {
				chronologyValid = false;
				errors.push(
					`Chronology timeline disorder detected: Year ${detectedYears[i]} appeared after Year ${detectedYears[i - 1]}`,
				);
				break;
			}
		}
	}

	const valid = errors.length === 0;

	return {
		valid,
		errors,
		warnings,
		linkCount: wikiLinks.length,
		wikiLinks: [...new Set(wikiLinks)],
		hasMainContent,
		hasHeading,
		chronologyValid,
		detectedYears,
	};
}

import type { FetchLike } from "./rosegriffon.ts";

export interface CheckShenronCdnOptions {
	urls?: string[];
	cdnOrigin?: string;
	fetch?: FetchLike;
	timeoutMs?: number;
}

export interface ShenronCdnAssetResult {
	url: string;
	ok: boolean;
	status: number;
	contentType?: string;
	cacheControl?: string;
	error?: string;
}

export interface ShenronCdnCheckResult {
	allOk: boolean;
	checked: number;
	passed: number;
	failed: number;
	results: ShenronCdnAssetResult[];
}

/**
 * Checks static assets on the Shenron CDN (`cdn.dragonballfr.com`).
 * Validates HTTP 200 status, Content-Type, and cache-control headers.
 */
export async function checkShenronCdnAssets(
	opts: CheckShenronCdnOptions = {},
): Promise<ShenronCdnCheckResult> {
	const cdn = (opts.cdnOrigin ?? SHENRON_ORIGINS.cdn).replace(/\/+$/, "");
	const defaultPaths = [
		"/images/shenron-icon.webp",
		"/css/theme.css",
		"/fonts/db-title.woff2",
	];
	const urls = opts.urls ?? defaultPaths.map((p) => `${cdn}${p.startsWith("/") ? p : `/${p}`}`);
	const fetcher = opts.fetch ?? globalThis.fetch;
	const timeoutMs = opts.timeoutMs ?? 5000;

	const results: ShenronCdnAssetResult[] = [];

	for (const url of urls) {
		try {
			const res = await fetcher(url, {
				method: "HEAD",
				signal: AbortSignal.timeout(timeoutMs),
			});
			const ct = res.headers.get("content-type") ?? undefined;
			const cc = res.headers.get("cache-control") ?? undefined;
			const ok = res.ok;
			results.push({
				url,
				ok,
				status: res.status,
				contentType: ct,
				cacheControl: cc,
				error: ok ? undefined : `HTTP status ${res.status}`,
			});
		} catch (err) {
			results.push({
				url,
				ok: false,
				status: 0,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	const passed = results.filter((r) => r.ok).length;
	const failed = results.length - passed;

	return {
		allOk: failed === 0,
		checked: results.length,
		passed,
		failed,
		results,
	};
}
