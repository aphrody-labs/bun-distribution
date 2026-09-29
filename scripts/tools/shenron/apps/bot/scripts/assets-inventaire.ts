#!/usr/bin/env bun
/**
 * Inventory of every image asset under the three media roots:
 *   apps/bot/assets, apps/bot/public/db, apps/site/public/wiki.
 * Computes size, SHA-256 (full content), dimensions and a 64-bit dHash, cached in
 * `apps/bot/data/cache/assets-inventory.jsonl` (keyed by path+size+mtime, so a rerun
 * only hashes what changed). Read-only on the files.
 *
 * Usage:
 *   bun apps/bot/scripts/assets-inventaire.ts            # hash + dims + dHash
 *   bun apps/bot/scripts/assets-inventaire.ts --no-dhash # sha256 only (fast)
 *   bun apps/bot/scripts/assets-inventaire.ts --report   # print groups from the cache
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { dHash, hammingDistance, hashFile, isImagePath } from "@shenron/images";

const RACINE = join(import.meta.dir, "..", "..", "..");
const ROOTS = [
	join(RACINE, "apps/bot/assets"),
	join(RACINE, "apps/bot/public/db"),
	join(RACINE, "apps/site/public/wiki"),
];
const CACHE = join(RACINE, "apps/bot/data/cache/assets-inventory.jsonl");
const NO_DHASH = process.argv.includes("--no-dhash");
const REPORT_ONLY = process.argv.includes("--report");
const CONC = 4;

export interface Entry {
	path: string;
	size: number;
	mtime: number;
	sha256: string;
	width?: number;
	height?: number;
	format?: string;
	dhash?: string;
}

function walk(dir: string, out: string[]) {
	for (const name of readdirSync(dir, { withFileTypes: true })) {
		const p = join(dir, name.name);
		if (name.isDirectory()) walk(p, out);
		else if (name.isFile() && isImagePath(name.name)) out.push(p);
	}
}

async function loadCache(): Promise<Map<string, Entry>> {
	const map = new Map<string, Entry>();
	const f = Bun.file(CACHE);
	if (!(await f.exists())) return map;
	for (const line of (await f.text()).split("\n")) {
		if (!line) continue;
		const e = JSON.parse(line) as Entry;
		map.set(e.path, e);
	}
	return map;
}

async function measure(e: Entry): Promise<void> {
	try {
		const img = sharp(e.path, { failOn: "none", limitInputPixels: false });
		const meta = await img.metadata();
		e.width = meta.width;
		e.height = meta.height;
		e.format = meta.format;
		if (!NO_DHASH) e.dhash = await dHash(e.path);
	} catch {
		/* unreadable image: keep sha only */
	}
}

async function build() {
	const files: string[] = [];
	for (const r of ROOTS) walk(r, files);
	const cache = await loadCache();
	const entries: Entry[] = [];
	const todo: Entry[] = [];
	for (const p of files) {
		const st = statSync(p);
		const prev = cache.get(p);
		if (prev && prev.size === st.size && prev.mtime === Math.floor(st.mtimeMs) && (NO_DHASH || prev.dhash || !prev.width)) {
			entries.push(prev);
			continue;
		}
		const e: Entry = { path: p, size: st.size, mtime: Math.floor(st.mtimeMs), sha256: prev?.sha256 ?? "" };
		if (prev && prev.size === st.size && prev.mtime === e.mtime) Object.assign(e, { width: prev.width, height: prev.height, format: prev.format });
		entries.push(e);
		todo.push(e);
	}
	console.log(`${files.length} images, ${todo.length} to (re)hash`);
	let done = 0;
	const writer = Bun.file(CACHE).writer();
	for (const e of entries) if (!todo.includes(e)) writer.write(JSON.stringify(e) + "\n");
	const queue = [...todo];
	await Promise.all(
		Array.from({ length: CONC }, async () => {
			for (;;) {
				const e = queue.shift();
				if (!e) return;
				if (!e.sha256) e.sha256 = await hashFile(e.path);
				if (!e.width || (!NO_DHASH && !e.dhash)) await measure(e);
				writer.write(JSON.stringify(e) + "\n");
				if (++done % 500 === 0) {
					console.log(`  ${done}/${todo.length}`);
					await writer.flush();
				}
			}
		})
	);
	await writer.end();
	return entries;
}

function report(entries: Entry[]) {
	const total = entries.reduce((a, e) => a + e.size, 0);
	console.log(`\n== Inventory: ${entries.length} images, ${(total / 1e9).toFixed(2)} GB`);
	const bySha = new Map<string, Entry[]>();
	for (const e of entries) bySha.set(e.sha256, [...(bySha.get(e.sha256) ?? []), e]);
	const groups = [...bySha.values()].filter((g) => g.length > 1);
	const recoverable = groups.reduce((a, g) => a + g[0]!.size * (g.length - 1), 0);
	const dupFiles = groups.reduce((a, g) => a + g.length - 1, 0);
	console.log(`== Exact duplicates: ${groups.length} groups, ${dupFiles} redundant files, ${(recoverable / 1e6).toFixed(1)} MB recoverable`);
	const perRoot = new Map<string, number>();
	for (const g of groups) for (const e of g.slice(1)) {
		const r = ROOTS.find((x) => e.path.startsWith(x)) ?? "?";
		perRoot.set(r, (perRoot.get(r) ?? 0) + 1);
	}
	for (const [r, n] of perRoot) console.log(`   ${n} redundant under ${r.replace(RACINE + "/", "")}`);

	// Near-clones: same dHash (distance ≤ 4) but different sha256, considering only one entry per sha.
	const uniq = [...bySha.values()].map((g) => g[0]!).filter((e) => e.dhash && e.width && e.width >= 32);
	const buckets = new Map<string, Entry[]>();
	for (const e of uniq) buckets.set(e.dhash!, [...(buckets.get(e.dhash!) ?? []), e]);
	let near = 0;
	const nearGroups: Entry[][] = [];
	for (const g of buckets.values()) if (g.length > 1) { near += g.length - 1; nearGroups.push(g); }
	// Distance 1-4 across buckets (cheap prefix bucketing on first 8 bits is imprecise; do pairwise on ≤ 20k uniq).
	let nearLoose = 0;
	if (uniq.length <= 25000) {
		const seen = new Set<string>();
		for (let i = 0; i < uniq.length; i++) for (let j = i + 1; j < uniq.length; j++) {
			const a = uniq[i]!, b = uniq[j]!;
			if (a.dhash === b.dhash) continue;
			if (hammingDistance(a.dhash!, b.dhash!) <= 3) { nearLoose++; seen.add(a.path); seen.add(b.path); }
		}
	}
	console.log(`== Near-clones (dHash exact, different bytes): ${nearGroups.length} groups, ${near} extra files`);
	console.log(`== Near-clones (dHash distance 1..3): ${nearLoose} pairs`);
	const out = join(RACINE, "apps/bot/data/cache/assets-near-clones.json");
	Bun.write(out, JSON.stringify(nearGroups.map((g) => g.map((e) => ({ path: e.path.replace(RACINE + "/", ""), w: e.width, h: e.height, size: e.size }))), null, 1));
	console.log(`   details → ${out.replace(RACINE + "/", "")}`);
}

const entries = REPORT_ONLY ? [...(await loadCache()).values()] : await build();
report(entries);
