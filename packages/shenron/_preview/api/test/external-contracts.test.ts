// SPDX-License-Identifier: Apache-2.0
/**
 * External contract drift: every `/api/public/*` path referenced by the
 * consumers within Shenron (the site `llms.txt`) must be a known route — an ENDPOINTS
 * entry or a LEGACY_PUBLIC_PATHS entry — and the legacy list itself must match
 * the routes actually served by `apps/bot/src/api/server.ts` (read as text).
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ENDPOINTS, LEGACY_PUBLIC_PATHS } from "../src/contract/endpoints";

const REPO = join(import.meta.dir, "..", "..", "..");
const LLMS_ROUTE = join(REPO, "apps", "site", "src", "app", "llms.txt", "route.ts");
const BOT_SERVER = join(REPO, "apps", "bot", "src", "api", "server.ts");
const SITE_APP = join(REPO, "apps", "site", "src", "app");

const KNOWN: readonly string[] = [...ENDPOINTS.map((e) => e.path), ...LEGACY_PUBLIC_PATHS];

/** `{a,b}` brace lists expanded (`/eval/{cache-stats,reports}` → two paths). */
function expandBraces(path: string): string[] {
	const match = /\{([^{}]*,[^{}]*)\}/.exec(path);
	if (!match) return [path];
	return match[1]!.split(",").flatMap((part) => expandBraces(path.replace(match[0], part.trim())));
}

/** Normalises interpolations (`${x}`, `$(x)`, `$x`) into a `{p}` placeholder. */
function normaliseSource(text: string): string {
	return text
		.replace(/\$\{[^}]*\}/g, "{p}")
		.replace(/\$\([^)]*\)/g, "{p}")
		.replace(/\$[A-Za-z_]\w*/g, "{p}")
		.replace(/\.\.\.\/wiki\//g, "/api/public/wiki/");
}

/** `/api/public/*` paths referenced in `text` (query strings and trailing punctuation removed). */
export function extractPublicPaths(text: string): string[] {
	const out = new Set<string>();
	for (const m of normaliseSource(text).matchAll(/\/api\/public\/[A-Za-z0-9_{}.,:\-/]*/g)) {
		for (const raw of expandBraces(m[0])) {
			const path = raw.replace(/[.,:]+$/, "").replace(/\/+$/, "");
			if (path === "/api/public" || path.endsWith("/api/public")) continue;
			out.add(path);
		}
	}
	return [...out].toSorted();
}

const isParam = (segment: string) => /^\{\w+\}$/.test(segment);

/**
 * `true` when `path` is an instance of `template`: same segment count, each
 * template segment is a parameter or equal to the reference segment; a
 * reference placeholder only matches a template parameter.
 */
export function matchesTemplate(path: string, template: string): boolean {
	const a = path.split("/");
	const b = template.split("/");
	if (a.length !== b.length) return false;
	return b.every((segment, i) => (isParam(segment) ? true : segment === a[i]));
}

function unknownPaths(paths: readonly string[]): string[] {
	return paths.filter((p) => !KNOWN.some((template) => matchesTemplate(p, template)));
}

describe("extraction helpers", () => {
	test("interpolations, brace lists and shorthands", () => {
		expect(
			extractPublicPaths(
				"`/api/public/wiki/${category}` $(x) /api/public/eval/{cache-stats,reports}. `.../wiki/sagas/{slug}`"
			)
		).toEqual([
			"/api/public/eval/cache-stats",
			"/api/public/eval/reports",
			"/api/public/wiki/sagas/{slug}",
			"/api/public/wiki/{p}",
		]);
		expect(
			matchesTemplate("/api/public/wiki/battles/12", "/api/public/wiki/{category}/{idOrSlug}")
		).toBe(true);
		expect(matchesTemplate("/api/public/nope", "/api/public/news")).toBe(false);
	});
});

describe("site llms.txt", () => {
	const text = readFileSync(LLMS_ROUTE, "utf8");

	test("no unknown /api/public/* path", () => {
		expect(unknownPaths(extractPublicPaths(text))).toEqual([]);
	});

	test("each site /api/* path has a route.ts", () => {
		const paths = new Set(
			[...normaliseSource(text).matchAll(/\/api\/(?!public\/)[A-Za-z0-9_{}\-/]*/g)].map((m) =>
				m[0].replace(/\/+$/, "")
			)
		);
		expect(paths.size).toBeGreaterThan(0);
		const missing = [...paths].filter((p) => {
			const segments = p.split("/").filter(Boolean);
			// `{id}` → any single dynamic directory (`[id]`, `[slug]`…).
			let dirs = [SITE_APP];
			for (const segment of segments) {
				const next: string[] = [];
				for (const dir of dirs) {
					if (isParam(segment)) {
						let entries: string[] = [];
						try {
							entries = readdirSync(dir);
						} catch {
							entries = [];
						}
						for (const entry of entries) {
							if (/^\[[^.\]]+\]$/.test(entry)) next.push(join(dir, entry));
						}
					} else if (existsSync(join(dir, segment))) next.push(join(dir, segment));
				}
				dirs = next;
			}
			return !dirs.some((dir) => existsSync(join(dir, "route.ts")));
		});
		expect(missing).toEqual([]);
	});
});

describe("LEGACY_PUBLIC_PATHS ↔ apps/bot/src/api/server.ts", () => {
	const server = readFileSync(BOT_SERVER, "utf8");
	const routeKeys = new Set([...server.matchAll(/^\s*"(\/[^"]+)":/gm)].map((m) => m[1]!));
	const toBun = (p: string) => p.replace(/\{(\w+)\}/g, ":$1");
	const toContract = (p: string) => p.replace(/:(\w+)/g, "{$1}");

	test("every legacy path is a route key or a fetch-level pathname check", () => {
		const missing = LEGACY_PUBLIC_PATHS.filter(
			(p) => !routeKeys.has(toBun(p)) && !server.includes(`url.pathname === "${p}"`)
		);
		expect(missing).toEqual([]);
	});

	test("every /api/public/* route key of the bot is listed", () => {
		const unlisted = [...routeKeys]
			.filter((k) => k.startsWith("/api/public/"))
			.map(toContract)
			.filter((p) => !LEGACY_PUBLIC_PATHS.includes(p));
		expect(unlisted).toEqual([]);
	});

	test("no ENDPOINTS path shadows a legacy route (legacy keeps priority)", () => {
		const legacy = new Set(LEGACY_PUBLIC_PATHS);
		const newPublic = ENDPOINTS.filter(
			(e) => e.path.startsWith("/api/public/wiki/") && !legacy.has(e.path)
		);
		expect(newPublic.map((e) => e.path).toSorted()).toEqual([
			"/api/public/wiki/categories",
			"/api/public/wiki/{category}",
			"/api/public/wiki/{category}/{idOrSlug}",
		]);
	});
});
