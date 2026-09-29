#!/usr/bin/env bun
/**
 * Ingest autonome d'assets Dragon Ball « officiels / rights-held FR ».
 *
 * Sources joignables depuis ce VPS :
 *  1. MyInstants media CDN (sons DBZ — équipe DBFR déclare les droits FR Toei/Shueisha)
 *  2. dragonball-api.com (images REST publiques libre, personnages/planètes/transfos)
 *
 * Usage :
 *   bun scripts/ingest-official-assets.ts
 *   bun scripts/ingest-official-assets.ts --sfx-only
 *   bun scripts/ingest-official-assets.ts --images-only
 *   bun scripts/ingest-official-assets.ts --force   # re-télécharge même si présent
 *
 * Écrit :
 *   public/sfx/* (+ inventory)
 *   public/dbz/{characters,planets,transformations}/*
 *   scripts/inventaires/assets-inventory.json  (catalogue installé)
 */
import { mkdir, writeFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import {
	SFX_CATALOG,
	IMAGE_API,
	type SfxCatalogEntry,
	type InventoryRecord,
} from "./asset-catalog";
import { SITE_URL } from "../src/lib/config";

const ROOT = join(import.meta.dir, "..");
const PUBLIC = join(ROOT, "public");
const SFX_DIR = join(PUBLIC, "sfx");
const DBZ_DIR = join(PUBLIC, "dbz");
// Hors de `public/` : un catalogue d'ingestion n'a rien à faire sur le
// domaine public — il expose les URL sources et les chemins internes.
const INVENTORY_PATH = join(ROOT, "scripts", "inventaires", "assets-inventory.json");

const args = new Set(process.argv.slice(2));
const FORCE = args.has("--force");
const SFX_ONLY = args.has("--sfx-only");
const IMAGES_ONLY = args.has("--images-only");
const CONCURRENCY = 6;

export type { InventoryRecord };

async function ensureDir(p: string) {
	if (!existsSync(p)) await mkdir(p, { recursive: true });
}

function isValidAudio(buf: ArrayBuffer, contentType: string | null): boolean {
	if (buf.byteLength < 800) return false;
	const u8 = new Uint8Array(buf);
	// MP3 frame sync or ID3
	const id3 = u8[0] === 0x49 && u8[1] === 0x44 && u8[2] === 0x33;
	const mp3 = u8[0] === 0xff && (u8[1] & 0xe0) === 0xe0;
	if (id3 || mp3) return true;
	if (contentType?.includes("audio") || contentType?.includes("mpeg")) return buf.byteLength > 2000;
	return false;
}

function isValidImage(buf: ArrayBuffer, contentType: string | null): boolean {
	if (buf.byteLength < 200) return false;
	const u8 = new Uint8Array(buf);
	// PNG / JPEG / WEBP / GIF magic
	const png = u8[0] === 0x89 && u8[1] === 0x50;
	const jpg = u8[0] === 0xff && u8[1] === 0xd8;
	const gif = u8[0] === 0x47 && u8[1] === 0x49;
	const webp = u8[0] === 0x52 && u8[1] === 0x49 && u8[8] === 0x57; // RIFF....WEBP
	if (png || jpg || gif || webp) return true;
	if (contentType?.startsWith("image/")) return buf.byteLength > 500;
	return false;
}

async function downloadOne(
	url: string,
	dest: string,
	kind: "audio" | "image",
	role: string,
	source: string,
	force: boolean
): Promise<InventoryRecord> {
	const base: InventoryRecord = {
		path: dest.replace(PUBLIC + "/", "public/"),
		role,
		source,
		url,
		ok: false,
		bytes: 0,
		error: null,
	};
	try {
		if (!force && existsSync(dest)) {
			const st = await stat(dest);
			if (st.size > 200) {
				return { ...base, ok: true, bytes: st.size, error: null, cached: true };
			}
		}
		let buf: ArrayBuffer;
		let ct: string | null = null;
		try {
			const res = await fetch(url, {
				headers: { "User-Agent": `DBFR-asset-ingest/1.0 (+${new URL(SITE_URL).host} rights-held)` },
				signal: AbortSignal.timeout(45_000),
			});
			if (!res.ok) {
				return { ...base, error: `HTTP ${res.status}` };
			}
			buf = await res.arrayBuffer();
			ct = res.headers.get("content-type");
		} catch (fetchErr: any) {
			if (fetchErr?.message?.includes("UnsupportedProxyProtocol")) {
				const proc = Bun.spawn(
					[
						"curl",
						"-sSL",
						"--noproxy",
						"*",
						"-H",
						`User-Agent: DBFR-asset-ingest/1.0 (+${new URL(SITE_URL).host} rights-held)`,
						url,
					],
					{
						stdout: "pipe",
						stderr: "pipe",
					}
				);
				buf = await new Response(proc.stdout).arrayBuffer();
				await proc.exited;
				if (proc.exitCode !== 0 || buf.byteLength === 0) {
					return { ...base, error: `curl fallback failed: code ${proc.exitCode}` };
				}
			} else {
				throw fetchErr;
			}
		}
		const valid = kind === "audio" ? isValidAudio(buf, ct) : isValidImage(buf, ct);
		if (!valid) {
			return { ...base, error: `invalid ${kind} (${buf.byteLength}B, ${ct})` };
		}
		await ensureDir(dirname(dest));
		await Bun.write(dest, buf);
		return { ...base, ok: true, bytes: buf.byteLength, error: null };
	} catch (e) {
		return {
			...base,
			error: e instanceof Error ? e.message : String(e),
		};
	}
}

// `readonly T[]` et non `T[]` : la fonction ne fait que LIRE `items`, et
// l'exiger mutable rejetait les catalogues déclarés `as const`.
async function mapPool<T, R>(
	items: readonly T[],
	limit: number,
	fn: (t: T) => Promise<R>
): Promise<R[]> {
	const out: R[] = [];
	let i = 0;
	async function worker() {
		while (i < items.length) {
			const idx = i++;
			out[idx] = await fn(items[idx]!);
		}
	}
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
	return out;
}

export async function ingestSfx(
	catalog: readonly SfxCatalogEntry[] = SFX_CATALOG,
	opts: { force?: boolean; sfxDir?: string } = {}
): Promise<InventoryRecord[]> {
	const dir = opts.sfxDir ?? SFX_DIR;
	const force = opts.force ?? FORCE;
	await ensureDir(dir);
	return mapPool(catalog, CONCURRENCY, async (entry) => {
		const dest = join(dir, entry.filename);
		const rec = await downloadOne(entry.url, dest, "audio", entry.role, entry.source, force);
		if (rec.ok) {
			console.log(`  ✓ sfx ${entry.filename} (${rec.bytes}B)${rec.cached ? " [cached]" : ""}`);
		} else {
			console.warn(`  ✗ sfx ${entry.filename}: ${rec.error}`);
		}
		return rec;
	});
}

function slugify(s: string): string {
	return s
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.replace(/[^a-zA-Z0-9]+/g, "-")
		.toLowerCase()
		.replace(/^-+|-+$/g, "");
}

async function fetchAllPages<T>(endpoint: string): Promise<T[]> {
	const all: T[] = [];
	// First request: may be a raw array (transformations) or paginated {items, meta}
	const res0 = await fetch(`${IMAGE_API}${endpoint}?page=1&limit=100`, {
		signal: AbortSignal.timeout(30_000),
	});
	if (!res0.ok) return all;
	const data0 = (await res0.json()) as T[] | { items?: T[]; meta?: { totalPages?: number } };
	if (Array.isArray(data0)) {
		return data0;
	}
	all.push(...(data0.items ?? []));
	const totalPages = data0.meta?.totalPages ?? 1;
	for (let page = 2; page <= totalPages && page < 50; page++) {
		const res = await fetch(`${IMAGE_API}${endpoint}?page=${page}&limit=100`, {
			signal: AbortSignal.timeout(30_000),
		});
		if (!res.ok) break;
		const data = (await res.json()) as { items?: T[] };
		all.push(...(data.items ?? []));
	}
	return all;
}

export async function ingestImages(
	opts: { force?: boolean; dbzDir?: string } = {}
): Promise<InventoryRecord[]> {
	const root = opts.dbzDir ?? DBZ_DIR;
	const force = opts.force ?? FORCE;
	const records: InventoryRecord[] = [];

	type Item = { id: number; name: string; image?: string };

	const jobs: { kind: string; endpoint: string; sub: string }[] = [
		{ kind: "character", endpoint: "/characters", sub: "characters" },
		{ kind: "planet", endpoint: "/planets", sub: "planets" },
		{ kind: "transformation", endpoint: "/transformations", sub: "transformations" },
	];

	for (const job of jobs) {
		console.log(`▶ images ${job.kind}`);
		await ensureDir(join(root, job.sub));
		let items: Item[] = [];
		try {
			items = await fetchAllPages<Item>(job.endpoint);
		} catch (e) {
			console.warn(`  ✗ list ${job.kind}: ${e instanceof Error ? e.message : e}`);
			continue;
		}
		const batch = await mapPool(items, CONCURRENCY, async (item) => {
			if (!item.image) {
				return {
					path: "",
					role: job.kind,
					source: "dragonball-api.com",
					url: "",
					ok: false,
					bytes: 0,
					error: "no image",
				} satisfies InventoryRecord;
			}
			const ext = item.image.includes(".webp")
				? "webp"
				: item.image.includes(".png")
					? "png"
					: item.image.includes(".jpg") || item.image.includes(".jpeg")
						? "jpg"
						: "png";
			const dest = join(root, job.sub, `${slugify(item.name) || String(item.id)}.${ext}`);
			const rec = await downloadOne(
				item.image,
				dest,
				"image",
				`${job.kind}:${item.name}`,
				"dragonball-api.com",
				force
			);
			return rec;
		});
		const ok = batch.filter((r) => r.ok).length;
		console.log(`  ✓ ${job.kind}: ${ok}/${items.length} ok`);
		records.push(...batch.filter((r) => r.path || r.error));
	}
	return records;
}

/** Apply preferred slot files (copy best source onto canonical name). */
export async function applyCanonicalSlots(sfxDir = SFX_DIR): Promise<void> {
	// Prefer stronger teleport for scroll
	const prefer: [string, string][] = [
		["dragon-ball-teleport.mp3", "teleport.mp3"],
		["its-over-9000.mp3", "over9000.mp3"],
		["charging.mp3", "ki-charge.mp3"],
		["powerup.mp3", "power-up.mp3"],
		// Préfère le clip Gohan long s'il existe encore en local
		["gohan-kamehameha.mp3", "kamehameha.mp3"],
	];
	for (const [from, to] of prefer) {
		const src = join(sfxDir, from);
		const dest = join(sfxDir, to);
		if (!existsSync(src)) continue;
		const st = await stat(src);
		if (st.size < 800) continue;
		// Only overwrite if dest missing or smaller (prefer fuller clip)
		if (existsSync(dest)) {
			const dt = await stat(dest);
			if (dt.size >= st.size && from !== to) continue;
		}
		if (from === to) continue;
		await Bun.write(dest, await Bun.file(src).arrayBuffer());
		console.log(`  → slot ${to} <= ${from} (${st.size}B)`);
	}
}

export async function writeInventory(
	records: InventoryRecord[],
	path = INVENTORY_PATH
): Promise<{ ok: number; fail: number; totalBytes: number }> {
	const ok = records.filter((r) => r.ok);
	const fail = records.filter((r) => !r.ok);
	const totalBytes = ok.reduce((s, r) => s + r.bytes, 0);
	const doc = {
		generatedAt: new Date().toISOString(),
		summary: { ok: ok.length, fail: fail.length, totalBytes },
		records,
	};
	await ensureDir(dirname(path));
	await writeFile(path, JSON.stringify(doc, null, 2), "utf8");
	return doc.summary;
}

async function main() {
	console.log("📥 Ingest assets officiels / rights-held →", PUBLIC);
	const all: InventoryRecord[] = [];

	if (!IMAGES_ONLY) {
		console.log("▶ SFX (MyInstants CDN)");
		all.push(...(await ingestSfx()));
		await applyCanonicalSlots();
	}
	if (!SFX_ONLY) {
		console.log("▶ Images (dragonball-api.com)");
		all.push(...(await ingestImages()));
	}

	const summary = await writeInventory(all);
	console.log(
		`✓ inventory: ${summary.ok} ok / ${summary.fail} fail / ${(summary.totalBytes / 1024 / 1024).toFixed(2)} MiB → ${INVENTORY_PATH}`
	);
	if (summary.ok < 1) {
		console.error("Aucun asset valide — échec.");
		process.exit(2);
	}
}

// Only run CLI when executed directly
if (import.meta.main) {
	main().catch((e) => {
		console.error(e);
		process.exit(1);
	});
}
