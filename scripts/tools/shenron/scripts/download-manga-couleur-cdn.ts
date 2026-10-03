#!/usr/bin/env bun
/**
 * download-manga-couleur-cdn.ts
 *
 * Downloads all DBFC (Dragon Ball Full Color) manga scan pages from their
 * temporary Discord redirect URLs, stores them in the permanent local assets
 * directory (apps/bot/assets/manga/DBFC/ch{num}/), updates PostgreSQL records
 * to point to the local CDN asset paths (./assets/manga/DBFC/...), and ensures
 * they are served directly by https://cdn.dragonballfr.com.
 */

import postgres from "postgres";
import { mkdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";

const ROOT = resolve(import.meta.dir, "..", "..", "..", "..");

const ASSETS_DIR = join(import.meta.dir, "..", "apps", "bot", "assets", "manga", "DBFC");
const PG_URL = process.env.DATABASE_URL?.trim();
if (!PG_URL) throw new Error("DATABASE_URL is required.");

const sql = postgres(PG_URL, { max: 4, idle_timeout: 10 });

async function fileValid(path: string): Promise<boolean> {
	if (!existsSync(path)) return false;
	try {
		const s = await stat(path);
		return s.size > 1000; // minimum valid image size
	} catch {
		return false;
	}
}

async function downloadWithRetry(url: string, destPath: string, retries = 3): Promise<number> {
	for (let attempt = 1; attempt <= retries; attempt++) {
		try {
			const res = await fetch(url, {
				redirect: "follow",
				headers: {
					"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
				},
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const buf = await res.arrayBuffer();
			if (buf.byteLength < 1000) throw new Error(`Too small (${buf.byteLength} bytes)`);
			await Bun.write(destPath, buf);
			return buf.byteLength;
		} catch (err) {
			if (attempt === retries) throw err;
			await new Promise((r) => setTimeout(r, 1000 * attempt));
		}
	}
	throw new Error("Failed after retries");
}

async function processChapter(ch: {
	id: string | number;
	chapter_number: number;
	pages: string[];
	title: string | null;
}) {
	const chDir = join(ASSETS_DIR, `ch${ch.chapter_number}`);
	await mkdir(chDir, { recursive: true });

	const newPages: string[] = [];
	let downloadedCount = 0;

	for (let i = 0; i < ch.pages.length; i++) {
		const pageSource = ch.pages[i];
		const filename = `${String(i + 1).padStart(3, "0")}.jpg`;
		const destPath = join(chDir, filename);
		const localAsset = `./assets/manga/DBFC/ch${ch.chapter_number}/${filename}`;

		newPages.push(localAsset);

		if (await fileValid(destPath)) {
			continue;
		}

		// If pageSource is already a local asset, skip if missing or not an HTTP URL
		if (!pageSource.startsWith("http://") && !pageSource.startsWith("https://")) {
			continue;
		}

		try {
			const size = await downloadWithRetry(pageSource, destPath);
			downloadedCount++;
		} catch (err) {
			console.error(`  [!] Failed to download Ch ${ch.chapter_number} P ${i + 1}: ${err}`);
		}
	}

	// Update database if pages changed or need updating
	const needsDbUpdate = ch.pages.some((p) => p.startsWith("http"));
	if (needsDbUpdate) {
		await sql`
			UPDATE bot.db_manga_chapters
			SET pages = ${sql.json(newPages)},
				cover = ${newPages[0] || null}
			WHERE id = ${ch.id}
		`;
	}

	return { chapterNumber: ch.chapter_number, downloadedCount, totalPages: ch.pages.length };
}

async function main() {
	console.log("=== DBFC Manga Downloader to Dragon Ball CDN ===");
	await mkdir(ASSETS_DIR, { recursive: true });

	const chapters = await sql`
		SELECT id, chapter_number, title, pages
		FROM bot.db_manga_chapters
		WHERE series = 'DBFC'
		ORDER BY chapter_number ASC
	`;

	console.log(`Found ${chapters.length} DBFC chapters in database.`);

	const concurrency = 6;
	let cursor = 0;
	let totalDownloaded = 0;
	const startTime = Date.now();

	const workers = Array.from({ length: concurrency }, async (_, workerId) => {
		while (cursor < chapters.length) {
			const index = cursor++;
			const ch = chapters[index];
			try {
				const res = await processChapter(ch);
				if (res.downloadedCount > 0) {
					totalDownloaded += res.downloadedCount;
					console.log(`[Ch ${res.chapterNumber}] Downloaded ${res.downloadedCount}/${res.totalPages} pages. Total so far: ${totalDownloaded}`);
				} else {
					// Already local
					if (index % 25 === 0) {
						console.log(`[Progress] Processed up to Chapter ${ch.chapter_number} (${index + 1}/${chapters.length})`);
					}
				}
			} catch (err) {
				console.error(`Error processing chapter ${ch.chapter_number}:`, err);
			}
		}
	});

	await Promise.all(workers);

	const duration = ((Date.now() - startTime) / 1000).toFixed(1);
	console.log(`\nDownload run finished in ${duration}s. Total newly downloaded pages: ${totalDownloaded}`);

	// Sync to the peer node (rsync over ssh, path relative to its home) so both nodes share all assets
	const peer = process.env.SHENRON_SYNC_PEER?.trim();
	if (!peer) {
		console.log("SHENRON_SYNC_PEER is not set: skipping the peer asset sync.");
		return;
	}
	console.log(`Syncing DBFC assets to ${peer}...`);
	const assets = join(ROOT, "apps", "shenron", "bot", "assets", "manga", "DBFC");
	const proc = Bun.spawn(["rsync", "-avz", `${assets}/`, `${peer}:shenron/apps/bot/assets/manga/DBFC/`]);
	await proc.exited;
	console.log("Assets sync complete.");

	await sql.end();
}

main().catch((err) => {
	console.error("Fatal error:", err);
	process.exit(1);
});
