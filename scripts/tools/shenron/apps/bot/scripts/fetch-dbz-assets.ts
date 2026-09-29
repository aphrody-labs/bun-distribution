#!/usr/bin/env bun
/**
 * Télécharge les assets Dragon Ball pour le site (characters, transformations,
 * planets) depuis la Dragon Ball API — **API publique libre, sans clé**.
 *
 * Politique projet : zéro API payante, zéro API à clé propriétaire. Si tu veux
 * ajouter une source, elle doit être libre et accessible sans inscription.
 *
 * Usage :
 *   bun scripts/fetch-dbz-assets.ts                # download tout dans apps/site/public/dbz/
 *   bun scripts/fetch-dbz-assets.ts --characters   # uniquement personnages
 *   bun scripts/fetch-dbz-assets.ts --planets      # uniquement planètes
 *
 * Source :
 *   - https://dragonball-api.com (REST publique, libre, CDN images)
 */

import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";

const ROOT = join(import.meta.dir, "../../site/public/dbz/");
const DBAPI = "https://dragonball-api.com/api";

const args = new Set(process.argv.slice(2));
const ALL = args.size === 0;
const DO_CHARS = ALL || args.has("--characters");
const DO_PLANETS = ALL || args.has("--planets");
const DO_TRANSFORMS = ALL || args.has("--transformations");

async function ensureDir(path: string) {
	if (!existsSync(path)) await mkdir(path, { recursive: true });
}

async function downloadFile(url: string, destPath: string): Promise<boolean> {
	if (existsSync(destPath)) return false;
	try {
		const res = await fetch(url);
		if (!res.ok) {
			console.warn(`  ✗ ${res.status} ${url}`);
			return false;
		}
		await ensureDir(dirname(destPath));
		await Bun.write(destPath, await res.arrayBuffer());
		return true;
	} catch (e) {
		console.warn(`  ✗ ${url}: ${e instanceof Error ? e.message : e}`);
		return false;
	}
}

function slugify(s: string): string {
	return s
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.replace(/[^a-zA-Z0-9]+/g, "-")
		.toLowerCase()
		.replace(/^-+|-+$/g, "");
}

async function fetchAllPages<T>(endpoint: string, key = "items"): Promise<T[]> {
	const all: T[] = [];
	let page = 1;
	while (true) {
		const res = await fetch(`${DBAPI}${endpoint}?page=${page}&limit=100`);
		if (!res.ok) break;
		const data = (await res.json()) as {
			items?: T[];
			meta?: { totalPages?: number };
		};
		const items = (data as Record<string, T[]>)[key] ?? data.items ?? [];
		all.push(...items);
		if (!data.meta || page >= (data.meta.totalPages ?? 1)) break;
		page++;
	}
	return all;
}

async function downloadCharacters() {
	console.log("▶ Characters (dragonball-api.com)");
	await ensureDir(join(ROOT, "characters"));
	const chars = await fetchAllPages<{
		id: number;
		name: string;
		image: string;
	}>("/characters");
	let dl = 0;
	for (const c of chars) {
		if (!c.image) continue;
		const ext = c.image.includes(".webp") ? "webp" : "png";
		const dest = join(ROOT, "characters", `${slugify(c.name)}.${ext}`);
		if (await downloadFile(c.image, dest)) dl++;
	}
	console.log(`  ✓ ${dl}/${chars.length} new (total ${chars.length})`);
	return chars;
}

async function downloadPlanets() {
	console.log("▶ Planets");
	await ensureDir(join(ROOT, "planets"));
	const planets = await fetchAllPages<{
		id: number;
		name: string;
		image: string;
	}>("/planets");
	let dl = 0;
	for (const p of planets) {
		if (!p.image) continue;
		const ext = p.image.includes(".webp") ? "webp" : "png";
		const dest = join(ROOT, "planets", `${slugify(p.name)}.${ext}`);
		if (await downloadFile(p.image, dest)) dl++;
	}
	console.log(`  ✓ ${dl}/${planets.length} new`);
	return planets;
}

async function downloadTransformations() {
	console.log("▶ Transformations");
	await ensureDir(join(ROOT, "transformations"));
	const trans = await fetchAllPages<{
		id: number;
		name: string;
		image: string;
	}>("/transformations", "items");
	let dl = 0;
	for (const t of trans) {
		if (!t.image) continue;
		const ext = t.image.includes(".webp") ? "webp" : "png";
		const dest = join(ROOT, "transformations", `${slugify(t.name)}.${ext}`);
		if (await downloadFile(t.image, dest)) dl++;
	}
	console.log(`  ✓ ${dl}/${trans.length} new`);
	return trans;
}

async function main() {
	console.log(`📥 DBZ assets → ${ROOT}`);
	await ensureDir(ROOT);
	if (DO_CHARS) await downloadCharacters();
	if (DO_PLANETS) await downloadPlanets();
	if (DO_TRANSFORMS) await downloadTransformations();
	console.log("✓ done");
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
