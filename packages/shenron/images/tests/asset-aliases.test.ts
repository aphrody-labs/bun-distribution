import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { ASSET_ALIASES, dbPathToDisk, resolveAppFile, sitePublicRedirects } from "../src/resolve";

const APPS = join(import.meta.dir, "..", "..", "..", "..", "apps", "shenron");
const ROOTS = { bot: join(APPS, "bot"), site: join(APPS, "site") };
/** Directories served by URL or read by the bot canvas; the dedup scope. */
const SCANNED = ["bot/assets", "bot/public", "site/public"];
/**
 * Accepted identical groups: Xenoverse 2 portraits are keyed by game code and
 * the seeds test `<CODE>.png` existence, so two codes sharing art stay two files.
 */
/** Binary media only: small JSON/text twins (e.g. `.well-known` agent cards) are intentional. */
const BINARY = /.(png|jpe?g|webp|avif|gif|ico|svg|woff2?|ttf|otf|mp3|ogg|wav|mp4|webm)$/i;
const ALLOWED_GROUP = (paths: string[]) => paths.every((p) => p.includes("/xv2-portraits/"));

function walk(dir: string, rel: string, out: string[]): void {
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		if (e.name === "node_modules") continue;
		const r = `${rel}/${e.name}`;
		if (e.isDirectory()) walk(join(dir, e.name), r, out);
		else if (e.isFile()) out.push(r);
	}
}

describe("asset dedup manifest", () => {
	test("every alias points to an existing canonical file and its copy is gone", () => {
		const problems: string[] = [];
		for (const [from, to] of Object.entries(ASSET_ALIASES)) {
			if (!existsSync(join(APPS, to))) problems.push(`missing canonical ${to}`);
			if (existsSync(join(APPS, from))) problems.push(`duplicate still on disk ${from}`);
			if (ASSET_ALIASES[to]) problems.push(`chained alias ${from} -> ${to}`);
		}
		expect(problems).toEqual([]);
	});

	test("no byte-identical file across bot/assets, bot/public and site/public", () => {
		const bySize = new Map<number, string[]>();
		for (const root of SCANNED) {
			const abs = join(APPS, root);
			if (!existsSync(abs)) continue;
			const files: string[] = [];
			walk(abs, root, files);
			for (const f of files) {
				if (!BINARY.test(f)) continue;
				const size = statSync(join(APPS, f)).size;
				(bySize.get(size) ?? bySize.set(size, []).get(size)!).push(f);
			}
		}
		const dups: string[][] = [];
		for (const same of bySize.values()) {
			if (same.length < 2) continue;
			const byHash = new Map<string, string[]>();
			for (const f of same) {
				const h = Bun.hash(readFileSync(join(APPS, f))).toString(16);
				(byHash.get(h) ?? byHash.set(h, []).get(h)!).push(f);
			}
			for (const g of byHash.values()) if (g.length > 1 && !ALLOWED_GROUP(g)) dups.push(g.toSorted());
		}
		// A new duplicate: keep one copy (prefer apps/shenron/site/public) and add the
		// others to packages/shenron/images/src/asset-aliases.json.
		expect(dups).toEqual([]);
	}, 120_000);

	test("bot paths resolve to the canonical copy", () => {
		const [from, to] = Object.entries(ASSET_ALIASES).find(([k]) => k.startsWith("bot/assets/"))!;
		const rel = from.slice("bot/".length);
		expect(resolveAppFile("bot", rel, ROOTS)).toBe(join(APPS, to).replaceAll("\\", "/"));
		expect(dbPathToDisk(`./${rel}`, ROOTS)).toBe(join(APPS, to).replaceAll("\\", "/"));
		expect(resolveAppFile("bot", "assets/does-not-exist.png", ROOTS)).toBe(
			join(ROOTS.bot, "assets/does-not-exist.png").replaceAll("\\", "/")
		);
	});

	test("site redirects cover every site/public alias with URL paths", () => {
		const redirects = sitePublicRedirects();
		const expected = Object.keys(ASSET_ALIASES).filter((k) => k.startsWith("site/public/")).length;
		expect(redirects.length).toBe(expected);
		for (const [s, d] of redirects) {
			expect(s.startsWith("/")).toBe(true);
			expect(d.startsWith("/")).toBe(true);
		}
	});
});
