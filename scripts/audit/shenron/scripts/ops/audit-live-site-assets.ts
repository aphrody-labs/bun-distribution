/**
 * Audits every URL published by the live sitemap, then the first-party media
 * referenced by the rendered pages. It is intentionally read-only: repairs
 * must be based on the concrete failure report rather than inferred content.
 *
 * Usage:
 *   bun scripts/ops/audit-live-site-assets.ts
 *   SITE_AUDIT_CONCURRENCY=32 bun scripts/ops/audit-live-site-assets.ts
 *   SITE_AUDIT_MAX_PAGES=500 SITE_AUDIT_MAX_ASSETS=2000 bun scripts/ops/audit-live-site-assets.ts
 */

const siteOrigin = (process.env.SITE_URL ?? "https://dragonballfr.com").replace(/\/+$/, "");
const concurrency = Math.max(1, Number(process.env.SITE_AUDIT_CONCURRENCY ?? 24) || 24);
const timeoutMs = Math.max(2_000, Number(process.env.SITE_AUDIT_TIMEOUT_MS ?? 20_000) || 20_000);
const maxPages = Math.max(0, Number(process.env.SITE_AUDIT_MAX_PAGES ?? 0) || 0);
const maxAssets = Math.max(0, Number(process.env.SITE_AUDIT_MAX_ASSETS ?? 0) || 0);
const output = process.env.SITE_AUDIT_OUTPUT ?? "/tmp/shenron-live-site-assets.json";
const agent = "shenron-live-site-asset-audit/1.0";

type Failure = { url: string; status: number; phase: "page" | "asset"; error?: string };

function normalizeUrl(raw: string, base: string): string | null {
	try {
		if (/\s/.test(raw) || raw.startsWith("data:") || raw.startsWith("javascript:")) return null;
		const url = new URL(raw, base);
		if (url.protocol !== "https:" && url.protocol !== "http:") return null;
		// Only probe resources served by this stack; third-party analytics/ads are
		// deliberately outside the availability contract of the site/CDN.
		if (!new Set(["dragonballfr.com", "cdn.dragonballfr.com", "bot.dragonballfr.com"]).has(url.hostname)) {
			return null;
		}
		if (url.pathname === "/" && !url.search) return null;
		return url.href;
	} catch {
		return null;
	}
}

function extractAssets(html: string, base: string): string[] {
	const found = new Set<string>();
	const add = (raw: string) => {
		const normalized = normalizeUrl(raw.trim(), base);
		if (normalized) found.add(normalized);
	};
	// `href` and meta `content` contain navigation/SEO text, not assets. Only
	// fetchable resource attributes belong in this audit; page links are checked
	// by the sitemap pass itself.
	for (const match of html.matchAll(/(?:src|poster)=["']([^"']+)["']/gi)) add(match[1]!);
	for (const match of html.matchAll(/url\(\s*["']?([^\s"')]+)["']?\s*\)/gi)) add(match[1]!);
	return [...found];
}

async function mapLimit<T>(items: T[], fn: (item: T) => Promise<void>): Promise<void> {
	let cursor = 0;
	await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
		while (true) {
			const item = items[cursor++];
			if (item === undefined) return;
			await fn(item);
		}
	}));
}

async function request(url: string): Promise<Response> {
	return fetch(url, {
		redirect: "manual",
		headers: { "user-agent": agent },
		signal: AbortSignal.timeout(timeoutMs),
	});
}

const sitemap = await request(`${siteOrigin}/sitemap.xml`);
if (!sitemap.ok) throw new Error(`Sitemap indisponible: HTTP ${sitemap.status}`);
const allPageUrls = [...(await sitemap.text()).matchAll(/<loc>([^<]+)<\/loc>/g)]
	.map((match) => normalizeUrl(match[1]!, siteOrigin))
	.filter((url): url is string => Boolean(url));
const pageUrls = maxPages > 0 ? allPageUrls.slice(0, maxPages) : allPageUrls;

const failures: Failure[] = [];
const assets = new Set<string>();
await mapLimit(pageUrls, async (url) => {
	try {
		const response = await request(url);
		if (response.status === 404 || response.status >= 500) {
			failures.push({ url, status: response.status, phase: "page" });
			return;
		}
		if ((response.headers.get("content-type") ?? "").includes("text/html")) {
			for (const asset of extractAssets(await response.text(), url)) assets.add(asset);
		}
	} catch (error) {
		failures.push({ url, status: 0, phase: "page", error: String(error) });
	}
});

const assetUrls = maxAssets > 0 ? [...assets].slice(0, maxAssets) : [...assets];
await mapLimit(assetUrls, async (url) => {
	try {
		const response = await request(url);
		if (response.status === 404 || response.status >= 500) failures.push({ url, status: response.status, phase: "asset" });
	} catch (error) {
		failures.push({ url, status: 0, phase: "asset", error: String(error) });
	}
});

const report = {
	createdAt: new Date().toISOString(),
	siteOrigin,
	pageLimit: maxPages || null,
	assetLimit: maxAssets || null,
	pagesDiscovered: allPageUrls.length,
	pagesAudited: pageUrls.length,
	assetsDiscovered: assets.size,
	assetsAudited: assetUrls.length,
	failures,
};
await Bun.write(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ...report, failures: failures.length, output }, null, 2));
