// SPDX-License-Identifier: Apache-2.0
import "./setup.ts";

/**
 * Unit tests for site testing helpers and presets in @aphrody/web-test/sites:
 * - Rose Griffon (URLs, auth cookies/headers, API health check)
 * - Shenron (URLs, wiki rendering validation, chronology order, CDN assets check)
 * - Aphrody UI / Next.js (M3 design token compliance, RSC hydration errors, instant benchmark)
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { WebCdpPage } from "../src/cdp.ts";
import type { CdpSend } from "../src/next/context.ts";
import {
	// Rose Griffon
	ROSE_GRIFFON_ORIGINS,
	ROSE_GRIFFON_ROUTES,
	ROSE_GRIFFON_URLS,
	ROSE_GRIFFON_AUTH_COOKIES,
	type FetchLike,
	roseGriffonUrl,
	createRoseGriffonAuthCookies,
	roseGriffonAuthHeaders,
	injectRoseGriffonAuth,
	checkRoseGriffonApiHealth,
	// Shenron
	SHENRON_ORIGINS,
	SHENRON_ROUTES,
	SHENRON_URLS,
	shenronUrl,
	validateShenronWikiRendering,
	checkShenronCdnAssets,
	// Aphrody UI
	auditM3DesignTokens,
	detectHydrationErrors,
	benchmarkInstantNavigation,
} from "../src/sites/index.ts";

describe("Rose Griffon site helpers", () => {
	let page: WebCdpPage;

	beforeEach(async () => {
		page = await WebCdpPage.connect();
	});

	afterEach(async () => {
		await page.close();
	});

	test("URL presets and roseGriffonUrl normalizer enforce canonical SEO shape", () => {
		expect(ROSE_GRIFFON_ORIGINS.site).toBe("https://rosegriffon.fr");
		expect(ROSE_GRIFFON_ROUTES.news).toBe("/news");
		expect(ROSE_GRIFFON_URLS.news).toBe("https://rosegriffon.fr/news");

		// Strip trailing slashes on sub-paths
		expect(roseGriffonUrl("/news/")).toBe("https://rosegriffon.fr/news");
		expect(roseGriffonUrl("a-propos")).toBe("https://rosegriffon.fr/a-propos");
		expect(roseGriffonUrl("/")).toBe("https://rosegriffon.fr/");
		expect(roseGriffonUrl("/api/v1/status", ROSE_GRIFFON_ORIGINS.api)).toBe(
			"https://api.rosegriffon.fr/api/v1/status",
		);
	});

	test("createRoseGriffonAuthCookies creates valid cookie parameters", () => {
		const cookies = createRoseGriffonAuthCookies({
			session: "custom-sess-123",
			csrf: "custom-csrf-456",
			token: "custom-jwt-789",
		});

		expect(cookies).toHaveLength(3);
		expect(cookies.find((c) => c.name === ROSE_GRIFFON_AUTH_COOKIES.session)?.value).toBe("custom-sess-123");
		expect(cookies.find((c) => c.name === ROSE_GRIFFON_AUTH_COOKIES.csrf)?.value).toBe("custom-csrf-456");
		expect(cookies.find((c) => c.name === ROSE_GRIFFON_AUTH_COOKIES.token)?.value).toBe("custom-jwt-789");
		expect(cookies.every((c) => c.domain === "rosegriffon.fr")).toBe(true);
	});

	test("roseGriffonAuthHeaders creates bearer and csrf headers", () => {
		const headers = roseGriffonAuthHeaders("tok-abc", "csrf-xyz");
		expect(headers.Authorization).toBe("Bearer tok-abc");
		expect(headers["x-csrf-token"]).toBe("csrf-xyz");
		expect(headers.Cookie).toContain("rg_session=tok-abc");
		expect(headers.Cookie).toContain("rg_csrf=csrf-xyz");
	});

	test("injectRoseGriffonAuth injects cookies into a CDP page", async () => {
		await injectRoseGriffonAuth(
			{ _cdp: page as unknown as CdpSend },
			{ session: "injected-session", csrf: "injected-csrf" },
		);

		const result = (await (page as unknown as CdpSend)._send("Network.getCookies", {})) as {
			cookies: Array<{ name: string; value: string }>;
		};
		const sessionCookie = result.cookies.find((c) => c.name === "rg_session");
		expect(sessionCookie?.value).toBe("injected-session");
		const csrfCookie = result.cookies.find((c) => c.name === "rg_csrf");
		expect(csrfCookie?.value).toBe("injected-csrf");
	});

	test("checkRoseGriffonApiHealth reports latency and status", async () => {
		const mockFetch: FetchLike = async () => {
			return new Response(JSON.stringify({ status: "healthy", version: "1.0.0" }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		};

		const health = await checkRoseGriffonApiHealth({
			fetch: mockFetch,
			apiOrigin: "https://api.rosegriffon.fr",
			endpoint: "/health",
		});

		expect(health.ok).toBe(true);
		expect(health.status).toBe(200);
		expect(health.latencyMs).toBeGreaterThanOrEqual(0);
		expect(health.data).toEqual({ status: "healthy", version: "1.0.0" });
	});

	test("checkRoseGriffonApiHealth handles network errors gracefully", async () => {
		const mockFailingFetch: FetchLike = async () => {
			throw new Error("Connection refused");
		};

		const health = await checkRoseGriffonApiHealth({
			fetch: mockFailingFetch,
			apiOrigin: "https://api.rosegriffon.fr",
		});

		expect(health.ok).toBe(false);
		expect(health.status).toBe(0);
		expect(health.error).toContain("Connection refused");
	});
});

describe("Shenron site helpers", () => {
	test("URL presets and shenronUrl normalizer", () => {
		expect(SHENRON_ORIGINS.site).toBe("https://dragonballfr.com");
		expect(SHENRON_ROUTES.chronology).toBe("/wiki/chronologie");
		expect(SHENRON_URLS.chronology).toBe("https://dragonballfr.com/wiki/chronologie");

		expect(shenronUrl("/wiki/episodes/")).toBe("https://dragonballfr.com/wiki/episodes");
		expect(shenronUrl("wiki/films/fusion-reborn")).toBe(
			"https://dragonballfr.com/wiki/films/fusion-reborn",
		);
	});

	test("validateShenronWikiRendering accepts valid wiki HTML with chronological timeline", async () => {
		const validWikiHtml = `
			<!DOCTYPE html>
			<html>
			<head><title>Chronologie Dragon Ball</title></head>
			<body>
				<header><nav><a href="/">Home</a></nav></header>
				<main>
					<h1>Chronologie Officielle</h1>
					<section>
						<p>Événements majeurs de l'univers :</p>
						<article>
							<h2>An 737</h2>
							<p>Naissance de Son Goku. Voir <a href="/wiki/episodes/1">Episode 1</a>.</p>
						</article>
						<article>
							<h2>An 753</h2>
							<p>22e Tenkaichi Budokai. Voir <a href="/wiki/films/dragon-ball-la-legende-de-shenron">Film Shenron</a>.</p>
						</article>
						<article>
							<h2>An 762</h2>
							<p>Bataille sur Namek contre Freezer.</p>
						</article>
						<article>
							<h2>An 767</h2>
							<p>Cell Game et victoire de Son Gohan.</p>
						</article>
					</section>
				</main>
			</body>
			</html>
		`;

		const res = await validateShenronWikiRendering(validWikiHtml);
		expect(res.valid).toBe(true);
		expect(res.hasMainContent).toBe(true);
		expect(res.hasHeading).toBe(true);
		expect(res.chronologyValid).toBe(true);
		expect(res.detectedYears).toEqual([737, 753, 762, 767]);
		expect(res.wikiLinks).toContain("/wiki/episodes/1");
		expect(res.wikiLinks).toContain("/wiki/films/dragon-ball-la-legende-de-shenron");
		expect(res.errors).toHaveLength(0);
	});

	test("validateShenronWikiRendering flags missing landmarks and chronology disorder", async () => {
		const invalidHtml = `
			<div>
				<span>Timeline non ordonnée :</span>
				<p>An 767 : Défaite de Cell.</p>
				<p>An 753 : Défaite de Piccolo Daimaô.</p>
				<a href="/wiki/Episodes/Bad_Link/">Lien invalide</a>
			</div>
		`;

		const res = await validateShenronWikiRendering(invalidHtml);
		expect(res.valid).toBe(false);
		expect(res.hasMainContent).toBe(false);
		expect(res.hasHeading).toBe(false);
		expect(res.chronologyValid).toBe(false);
		expect(res.errors.some((e) => e.includes("Missing main landmark"))).toBe(true);
		expect(res.errors.some((e) => e.includes("Missing primary heading"))).toBe(true);
		expect(res.errors.some((e) => e.includes("Chronology timeline disorder"))).toBe(true);
		expect(res.warnings.some((w) => w.includes("trailing slash"))).toBe(true);
		expect(res.warnings.some((w) => w.includes("uppercase"))).toBe(true);
	});

	test("checkShenronCdnAssets checks static assets with headers", async () => {
		const mockFetch: FetchLike = async (url) => {
			return new Response(null, {
				status: 200,
				headers: {
					"content-type": url.toString().endsWith(".webp") ? "image/webp" : "text/css",
					"cache-control": "public, max-age=31536000, immutable",
				},
			});
		};

		const check = await checkShenronCdnAssets({
			fetch: mockFetch,
			urls: [
				"https://cdn.dragonballfr.com/images/shenron.webp",
				"https://cdn.dragonballfr.com/css/theme.css",
			],
		});

		expect(check.allOk).toBe(true);
		expect(check.checked).toBe(2);
		expect(check.passed).toBe(2);
		expect(check.failed).toBe(0);
		expect(check.results[0].contentType).toBe("image/webp");
		expect(check.results[0].cacheControl).toContain("immutable");
	});
});

describe("Aphrody UI / Next.js site helpers", () => {
	let page: WebCdpPage;

	beforeEach(async () => {
		page = await WebCdpPage.connect();
	});

	afterEach(async () => {
		await page.close();
	});

	test("auditM3DesignTokens audits standard M3 token definitions", async () => {
		const validM3Styles = {
			"--md-sys-color-primary": "#6750A4",
			"--md-sys-color-surface": "#FEF7FF",
			"--md-sys-color-on-surface": "#1D1B20",
			"--md-sys-color-secondary": "#625B71",
			"--md-sys-color-outline": "#79747E",
			"--md-sys-shape-corner-none": "0px",
			"--md-sys-shape-corner-small": "8px",
			"--md-sys-shape-corner-medium": "12px",
			"--md-sys-shape-corner-large": "16px",
			"--md-sys-elevation-level1": "1",
			"--md-sys-motion-duration-short1": "50ms",
			"--md-sys-typescale-body-large-size": "16px",
		};

		const audit = await auditM3DesignTokens(validM3Styles);
		expect(audit.compliant).toBe(true);
		expect(audit.score).toBeGreaterThanOrEqual(70);
		expect(audit.categories.color).toBe(true);
		expect(audit.categories.shape).toBe(true);
		expect(audit.categories.elevation).toBe(true);
		expect(audit.categories.motion).toBe(true);
		expect(audit.categories.typescale).toBe(true);
		expect(audit.violations).toHaveLength(0);
		expect(audit.missingTokens).toHaveLength(0);
	});

	test("auditM3DesignTokens flags non-standard shape radii violations", async () => {
		const invalidStyles = {
			"--md-sys-color-primary": "#6750A4",
			"--md-sys-shape-corner-medium": "7px", // violation: not in standard scale
		};

		const audit = await auditM3DesignTokens(invalidStyles);
		expect(audit.compliant).toBe(false);
		expect(audit.violations.length).toBeGreaterThan(0);
		expect(audit.violations[0]).toContain("Non-standard M3 shape radius");
		expect(audit.missingTokens.length).toBeGreaterThan(0);
	});

	test("detectHydrationErrors catches React 18/19 and Next.js hydration issues", async () => {
		const logsWithHydration = [
			"Info: app loaded",
			"Error: Text content does not match server-rendered HTML.",
			"Warning: react-error #418 - Hydration failed because the initial UI does not match what was rendered on the server.",
		];

		const check = await detectHydrationErrors(logsWithHydration);
		expect(check.hasHydrationError).toBe(true);
		expect(check.errorCount).toBe(2);
		expect(check.details.map((d) => d.type)).toContain("text_mismatch");
		expect(check.details.map((d) => d.type)).toContain("minified_react_hydration");

		// Clean logs
		const cleanCheck = await detectHydrationErrors(["Ready on http://localhost:3000", "GET / 200"]);
		expect(cleanCheck.hasHydrationError).toBe(false);
		expect(cleanCheck.errorCount).toBe(0);

		// RSC error fallback comment detection in HTML
		const rscHtml = "<div><!--$!--><template data-msg='SSR bailout'></template><!--/$--></div>";
		const rscCheck = await detectHydrationErrors(rscHtml);
		expect(rscCheck.hasHydrationError).toBe(true);
		expect(rscCheck.details[0].type).toBe("rsc_error_fallback");
	});

	test("benchmarkInstantNavigation measures instant navigation iterations", async () => {
		const pwTarget = { url: () => "http://localhost:3000", _cdp: page as unknown as CdpSend };

		let actionsRun = 0;
		const benchmark = await benchmarkInstantNavigation(
			pwTarget,
			async () => {
				actionsRun++;
			},
			{ runs: 2 },
		);

		expect(actionsRun).toBe(2);
		expect(benchmark.runs).toBe(2);
		expect(benchmark.timings).toHaveLength(2);
		expect(benchmark.cachedRendered).toBe(true);
		expect(benchmark.averageMs).toBeGreaterThanOrEqual(0);
	});
});
