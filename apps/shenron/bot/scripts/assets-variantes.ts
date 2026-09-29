#!/usr/bin/env bun
/**
 * Generates `apps/shenron/site/src/data/image-variants.json` from the asset inventory:
 * for every DB path referenced by an image column (and by the home scenes), the
 * measured dimensions and — when the SAME picture (identical dHash, different
 * bytes) exists at a strictly larger resolution under a servable path — that
 * larger variant. The site's `pickBestImage` serves it. Nothing is copied.
 *
 * Usage: bun apps/shenron/bot/scripts/assets-variantes.ts
 */
import { join } from "node:path";
import postgres from "postgres";
import { coversResolution, dbPathToDisk, diskToDbPath, normalizeDbPath } from "@shenron/images";

const RACINE = join(import.meta.dir, "..", "..", "..");
const ROOTS = { bot: join(RACINE, "apps/shenron/bot"), site: join(RACINE, "apps/shenron/site") };
const CACHE = join(ROOTS.bot, "data/cache/assets-inventory.jsonl");
const OUT = join(ROOTS.site, "src/data/image-variants.json");
const IMAGE_COLUMNS: [string, string][] = [
	["db_characters", "image"], ["db_characters", "portrait_xv2"], ["db_character_variants", "image"],
	["db_planets", "image"], ["db_techniques", "image"], ["db_transformations", "image"], ["db_sagas", "image"],
	["db_movies", "poster"], ["db_episodes", "image"], ["db_databooks", "cover"], ["db_manga_volumes", "cover"],
	["db_games", "cover"],
];

async function urlBase(): Promise<string> {
	const direct = process.env.DATABASE_URL?.trim();
	if (direct) return direct;
	const texte = await Bun.file(join(ROOTS.site, ".env")).text().catch(() => "");
	const v = texte.split("\n").findLast((l) => l.startsWith("DATABASE_URL="))?.slice(13).trim().replace(/^["']|["']$/g, "");
	if (!v) throw new Error("DATABASE_URL introuvable");
	return v;
}
interface Entry { path: string; size: number; sha256: string; width?: number; height?: number; dhash?: string }
const entries: Entry[] = (await Bun.file(CACHE).text()).split("\n").filter(Boolean).map((l) => JSON.parse(l));
const byDisk = new Map(entries.map((e) => [e.path, e]));
const byDhash = new Map<string, Entry[]>();
// A near-flat picture (blank manga page, solid background) has a degenerate dHash
// that collides with other flat pictures: ignore hashes with < 8 or > 56 bits set.
const popcount = (hex: string) => { let n = 0; for (let x = BigInt("0x" + hex); x; x >>= 1n) n += Number(x & 1n); return n; };
const usable = (h?: string) => !!h && popcount(h) >= 8 && popcount(h) <= 56;
for (const e of entries) if (usable(e.dhash) && e.width) byDhash.set(e.dhash, [...(byDhash.get(e.dhash) ?? []), e]);

const sql = postgres(await urlBase(), { max: 1, prepare: false });
const paths = new Set<string>();
for (const [t, c] of IMAGE_COLUMNS) {
	for (const r of (await sql.unsafe(`select distinct ${c} as p from bot.${t} where ${c} is not null and ${c} <> ''`)) as unknown as { p: string }[]) paths.add(r.p);
}
await sql.end();
// Home scenes (static defaults) — the bot cannot import the site; scan the source.
const scenes = await Bun.file(join(ROOTS.site, "src/lib/home-scenes.ts")).text();
for (const m of scenes.matchAll(/image:\s*"(\.\/assets\/[^"]+)"/g)) paths.add(m[1]!);

const out: Record<string, { w: number; h: number; best?: { path: string; w: number; h: number } }> = {};
let withBest = 0;
for (const p of paths) {
	const disk = dbPathToDisk(p, ROOTS);
	const e = disk ? byDisk.get(disk) : undefined;
	if (!e?.width || !e.height) continue;
	const rec: (typeof out)[string] = { w: e.width, h: e.height };
	if (usable(e.dhash)) {
		let best: Entry | null = null;
		for (const cand of byDhash.get(e.dhash) ?? []) {
			if (cand.sha256 === e.sha256 || !cand.width || !cand.height) continue;
			if (!(cand.width > e.width && coversResolution({ path: cand.path, width: cand.width, height: cand.height }, { path: e.path, width: e.width, height: e.height }))) continue;
			// Same aspect ratio (±2 %): a crop is not the same picture.
			if (Math.abs(cand.width / cand.height - e.width / e.height) > 0.02 * (e.width / e.height)) continue;
			if (!diskToDbPath(cand.path, ROOTS)) continue;
			if (!best || cand.width * cand.height > best.width! * best.height!) best = cand;
		}
		if (best) { rec.best = { path: diskToDbPath(best.path, ROOTS)!, w: best.width!, h: best.height! }; withBest++; }
	}
	out[normalizeDbPath(p)] = rec;
}
await Bun.write(OUT, JSON.stringify(out));
console.log(`${Object.keys(out).length} chemins mesurés, ${withBest} avec une variante plus grande → ${OUT.replace(RACINE + "/", "")} (${(Bun.file(OUT).size / 1024).toFixed(0)} KiB)`);
