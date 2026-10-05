#!/usr/bin/env bun
/**
 * audit-images-publiques.ts — live broken-image scan of the public site.
 *
 * Reads the sitemap, samples pages per path family, extracts every `<img src>`
 * from the served HTML, fetches each distinct image ONCE and reports the ones
 * that do not answer with an image (HTTP error, timeout, or a non-image body
 * such as the HTML of a Next catch-all route).
 *
 * Usage:
 *   bun apps/shenron/site/scripts/audit-images-publiques.ts
 *   bun apps/shenron/site/scripts/audit-images-publiques.ts --base https://dragonballfr.com --per 6
 *   bun apps/shenron/site/scripts/audit-images-publiques.ts --include /wiki/toriyama --include /classements
 *   bun apps/shenron/site/scripts/audit-images-publiques.ts --all --out /tmp/images.json
 *
 * Options:
 *   --base <url>         site origin (default https://dragonballfr.com)
 *   --sitemap <url>      sitemap URL (default <base>/sitemap.xml; sitemap indexes are followed)
 *   --per <n>            pages sampled per path family (default 6)
 *   --shallow <depth>    pages at this depth or less are always scanned (default 2)
 *   --include <path>     always scan this path (repeatable)
 *   --all                scan every page of the sitemap (ignores --per)
 *   --concurrency <n>    parallel requests (default 8)
 *   --timeout <ms>       per-request timeout (default 15000)
 *   --max-broken <n>     exit 1 when more broken images than this (default 0)
 *   --out <file>         also write the JSON report to this file
 *
 * Output: the JSON report on stdout ({ pages, images, broken: [{ url, status, pages }] , … });
 * progress goes to stderr. Exit code: 0 ok, 1 too many broken images, 2 fatal error.
 *
 * Dependency-free: Bun's `fetch` and `node:util` only.
 */
import { parseArgs } from "node:util";

const USER_AGENT = "dbfr-audit-images/1.0 (+https://dragonballfr.com)";

interface BrokenImage {
	url: string;
	/** HTTP status, or 0 when the request itself failed (network error, timeout). */
	status: number;
	contentType: string | null;
	reason: string;
	pages: string[];
}

interface Report {
	base: string;
	sitemap: string;
	generatedAt: string;
	sitemapUrls: number;
	families: number;
	pages: number;
	pageErrors: Array<{ url: string; status: number; reason: string }>;
	images: number;
	broken: BrokenImage[];
}

const { values: args } = parseArgs({
	args: Bun.argv.slice(2),
	options: {
		base: { type: "string", default: "https://dragonballfr.com" },
		sitemap: { type: "string" },
		per: { type: "string", default: "6" },
		shallow: { type: "string", default: "2" },
		include: { type: "string", multiple: true, default: [] },
		all: { type: "boolean", default: false },
		concurrency: { type: "string", default: "8" },
		timeout: { type: "string", default: "15000" },
		"max-broken": { type: "string", default: "0" },
		out: { type: "string" },
	},
	strict: true,
});

function intArg(name: string, raw: string | undefined, min: number): number {
	const n = Number(raw);
	if (!Number.isInteger(n) || n < min) {
		console.error(`--${name} doit être un entier >= ${min} (reçu : ${raw})`);
		process.exit(2);
	}
	return n;
}

const base = new URL(args.base!).origin;
const sitemapUrl = args.sitemap ?? `${base}/sitemap.xml`;
const perFamily = intArg("per", args.per, 1);
const shallowDepth = intArg("shallow", args.shallow, 0);
const concurrency = intArg("concurrency", args.concurrency, 1);
const timeoutMs = intArg("timeout", args.timeout, 1);
const maxBroken = intArg("max-broken", args["max-broken"], 0);

const log = (msg: string) => console.error(`[audit-images] ${msg}`);

/** Runs `task` over `items` with at most `limit` in flight. */
async function pool<T, R>(items: readonly T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
	const results: R[] = [];
	let next = 0;
	const worker = async () => {
		while (next < items.length) {
			const i = next++;
			results[i] = await task(items[i]!);
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
	return results;
}

function request(url: string, method: "GET" | "HEAD", accept: string): Promise<Response> {
	return fetch(url, {
		method,
		redirect: "follow",
		headers: { "user-agent": USER_AGENT, accept },
		signal: AbortSignal.timeout(timeoutMs),
	});
}

function describeError(error: unknown): string {
	if (error instanceof Error) return error.name === "TimeoutError" ? `timeout ${timeoutMs} ms` : error.message;
	return String(error);
}

const ENTITIES: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " };

function decodeEntities(value: string): string {
	return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
		if (code[0] === "#") {
			const n = code[1] === "x" || code[1] === "X" ? Number.parseInt(code.slice(2), 16) : Number(code.slice(1));
			return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
		}
		return ENTITIES[code.toLowerCase()] ?? whole;
	});
}

/** Every page URL of the sitemap; sitemap indexes are followed (at most 3 nested levels). */
async function readSitemap(url: string, depth = 0): Promise<string[]> {
	const res = await request(url, "GET", "application/xml,text/xml;q=0.9,*/*;q=0.1");
	if (!res.ok) throw new Error(`sitemap ${url} : HTTP ${res.status}`);
	const xml = await res.text();
	const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => decodeEntities(m[1]!));
	if (/<sitemapindex[\s>]/i.test(xml)) {
		if (depth >= 3) throw new Error(`sitemap ${url} : index imbriqué trop profond`);
		const nested = await pool(locs, concurrency, (loc) => readSitemap(loc, depth + 1));
		return nested.flat();
	}
	return locs;
}

/**
 * Path family of a page: its parent path with numeric segments generalised,
 * plus `/*` (`/wiki/jeux/jump-ultimate-stars` → `/wiki/jeux/*`,
 * `/manga/12/3` → `/manga/:n/*`). Hubs (a path that is the parent of other
 * URLs) and shallow pages are their own family: they are distinct templates,
 * not instances of one.
 */
function familyOf(path: string, hubs: ReadonlySet<string>): string {
	const segments = path.split("/").filter(Boolean);
	if (segments.length <= shallowDepth || hubs.has(path)) return `=${path}`;
	const parent = segments.slice(0, -1).map((s) => (/^\d+$/.test(s) ? ":n" : s));
	return `/${parent.join("/")}/*`;
}

/** Evenly spaced, deterministic sample (first, …, last) of at most `n` items. */
function spread<T>(items: readonly T[], n: number): T[] {
	if (items.length <= n) return [...items];
	if (n === 1) return [items[0]!];
	return Array.from({ length: n }, (_, i) => items[Math.round((i * (items.length - 1)) / (n - 1))]!);
}

function selectPages(urls: readonly string[]): { pages: string[]; families: number } {
	const sameOrigin = [...new Set(urls)].filter((u) => {
		try {
			return new URL(u).origin === base;
		} catch {
			return false;
		}
	});
	const byPath = new Map(sameOrigin.map((u) => [new URL(u).pathname.replace(/\/+$/, "") || "/", u]));
	const hubs = new Set<string>();
	for (const path of byPath.keys()) {
		const segments = path.split("/").filter(Boolean);
		for (let i = 1; i < segments.length; i++) hubs.add(`/${segments.slice(0, i).join("/")}`);
	}
	const families = new Map<string, string[]>();
	for (const [path, url] of byPath) {
		const key = familyOf(path, hubs);
		const list = families.get(key);
		if (list) list.push(url);
		else families.set(key, [url]);
	}
	const picked = new Set<string>();
	for (const list of families.values()) {
		for (const url of args.all ? list : spread(list, perFamily)) picked.add(url);
	}
	for (const path of args.include ?? []) picked.add(includedPage(path));
	return { pages: [...picked], families: families.size };
}

/**
 * `--include` value (path or absolute URL) as a same-origin page URL.
 *
 * Git Bash rewrites a leading-slash argument into a Windows path
 * (`/classements` → `C:/Program Files/Git/classements`): refused loudly rather
 * than scanned as a bogus URL. Pass the full URL, or set `MSYS_NO_PATHCONV=1`.
 */
function includedPage(value: string): string {
	let url: URL | null = null;
	try {
		url = new URL(value, base);
	} catch {
		/* reported below */
	}
	if (!url || url.origin !== base) {
		console.error(
			`--include ${value} : ni un chemin ni une URL de ${base} (sous Git Bash : MSYS_NO_PATHCONV=1 ou URL complète)`
		);
		process.exit(2);
	}
	return url.href;
}

const IMG_SRC_RE = /<img\b[^>]*?\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;

/** Absolute URLs of the `<img src>` of a page, resolved like the browser does. */
function extractImages(html: string, pageUrl: string): string[] {
	const found = new Set<string>();
	for (const m of html.matchAll(IMG_SRC_RE)) {
		const raw = decodeEntities((m[1] ?? m[2] ?? m[3] ?? "").trim());
		if (!raw || /^(data|blob|about|javascript):/i.test(raw)) continue;
		try {
			found.add(new URL(raw, pageUrl).href);
		} catch {
			/* unparsable src: the browser would not load it either */
		}
	}
	return [...found];
}

type ImageCheck = { ok: true } | { ok: false; status: number; contentType: string | null; reason: string };

function judge(res: Response): ImageCheck {
	const contentType = res.headers.get("content-type");
	if (!res.ok) return { ok: false, status: res.status, contentType, reason: `HTTP ${res.status}` };
	const type = contentType?.split(";")[0]?.trim().toLowerCase() ?? "";
	// A 200 that is not an image is still a broken image: typically the HTML of
	// a catch-all route answering for an asset path it does not own.
	if (type && !type.startsWith("image/") && type !== "application/octet-stream") {
		return { ok: false, status: res.status, contentType, reason: `réponse non image (${type})` };
	}
	return { ok: true };
}

/**
 * HEAD first (no body transferred); any failure is confirmed with a GET, since
 * some CDNs and WAFs refuse HEAD (405, 403) while serving the image normally.
 */
async function checkImage(url: string): Promise<ImageCheck> {
	const accept = "image/avif,image/webp,image/png,image/*;q=0.8,*/*;q=0.5";
	try {
		const head = await request(url, "HEAD", accept);
		const verdict = judge(head);
		if (verdict.ok) return verdict;
	} catch {
		/* confirmed below */
	}
	try {
		const res = await request(url, "GET", accept);
		const verdict = judge(res);
		await res.body?.cancel().catch(() => undefined);
		return verdict;
	} catch (error) {
		return { ok: false, status: 0, contentType: null, reason: describeError(error) };
	}
}

async function main(): Promise<number> {
	log(`sitemap ${sitemapUrl}`);
	const urls = await readSitemap(sitemapUrl);
	const { pages, families } = selectPages(urls);
	log(`${urls.length} URL, ${families} familles, ${pages.length} pages à parcourir`);

	const pageErrors: Report["pageErrors"] = [];
	const imagePages = new Map<string, Set<string>>();
	let done = 0;
	await pool(pages, concurrency, async (pageUrl) => {
		try {
			const res = await request(pageUrl, "GET", "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1");
			if (!res.ok) {
				pageErrors.push({ url: pageUrl, status: res.status, reason: `HTTP ${res.status}` });
				await res.body?.cancel().catch(() => undefined);
				return;
			}
			// Relative `src` resolve against the FINAL URL, as in the browser.
			const html = await res.text();
			for (const img of extractImages(html, res.url || pageUrl)) {
				const seen = imagePages.get(img);
				if (seen) seen.add(pageUrl);
				else imagePages.set(img, new Set([pageUrl]));
			}
		} catch (error) {
			pageErrors.push({ url: pageUrl, status: 0, reason: describeError(error) });
		} finally {
			if (++done % 50 === 0) log(`pages ${done}/${pages.length}`);
		}
	});
	log(`${imagePages.size} images distinctes à vérifier`);

	const images = [...imagePages.keys()];
	const checks = await pool(images, concurrency, checkImage);
	const broken: BrokenImage[] = [];
	images.forEach((url, i) => {
		const check = checks[i]!;
		if (check.ok) return;
		broken.push({
			url,
			status: check.status,
			contentType: check.contentType,
			reason: check.reason,
			pages: [...imagePages.get(url)!].toSorted(),
		});
	});
	broken.sort((a, b) => a.url.localeCompare(b.url));

	const report: Report = {
		base,
		sitemap: sitemapUrl,
		generatedAt: new Date().toISOString(),
		sitemapUrls: urls.length,
		families,
		pages: pages.length,
		pageErrors: pageErrors.toSorted((a, b) => a.url.localeCompare(b.url)),
		images: images.length,
		broken,
	};
	const json = JSON.stringify(report, null, 2);
	console.log(json);
	if (args.out) await Bun.write(args.out, `${json}\n`);

	log(
		`${report.pages} pages (${pageErrors.length} en erreur), ${report.images} images, ${broken.length} cassées (seuil ${maxBroken})`
	);
	return broken.length > maxBroken ? 1 : 0;
}

try {
	process.exit(await main());
} catch (error) {
	log(`échec : ${describeError(error)}`);
	process.exit(2);
}
