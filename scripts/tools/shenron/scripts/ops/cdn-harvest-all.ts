#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * cdn-harvest-all.ts
 *
 * Orchestrateur de rapatriement et hébergement exhaustif CDN :
 * - Sōshūhen Legend 1 (Databook 465) : 381 planches -> apps/site/public/wiki/databooks/soshuhen-legend-01/
 * - Kanzenban (DBKZ) : 34 tomes, 8 202 planches -> apps/bot/assets/manga/DBKZ/vol{1..34}/
 * - Tankōbon JP (DBJP) : 42 tomes, 8 031 planches -> apps/bot/assets/manga/DBJP/vol{1..42}/
 * - TV Anime Comics (DBZ_ANIME_COMICS) : 39 tomes, 5 604 planches -> apps/bot/assets/manga/DBZ_ANIME_COMICS/vol{1..39}/
 * - Film Anime Comics (DB_MOVIES) : 20 tomes, 3 070 planches -> apps/bot/assets/manga/DB_MOVIES/vol{1..20}/
 * - Dr. Slump (ARALE) : 18 tomes, 3 342 planches -> apps/bot/assets/manga/ARALE/vol{1..18}/
 *
 * Utilise le pool de workers BXC curl-impersonate pour contourner Cloudflare
 * et met à jour PostgreSQL (bot.db_databooks et bot.db_manga_chapters).
 */

import { existsSync, readFileSync } from "node:fs";

import { homedir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import type { HarvestResult, HarvestTask } from "./cdn-harvest-worker";

// ─────────────────────────────────────────────────────────────────────────────
// 1. Arguments & Configuration
// ─────────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function getArg(flag: string, defaultValue?: string): string | undefined {
	const idx = args.indexOf(flag);
	return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : defaultValue;
}

const SERIES_ARG = (getArg("--series", "ALL") || "ALL").toUpperCase();
const CONCURRENCY = Math.max(1, Math.min(16, Number.parseInt(getArg("--concurrency", "8")!, 10)));
const LIMIT = getArg("--limit") ? Number.parseInt(getArg("--limit")!, 10) : undefined;
const DRY_RUN = args.includes("--dry-run");
const SKIP_DB = args.includes("--skip-db");
const DB_ONLY = args.includes("--db-only");

const REPO_ROOT = join(import.meta.dir, "..", "..");
const VOLUMES_DIR = join(REPO_ROOT, "data", "dragonballcn", "volumes");
const WORKER_SCRIPT = join(import.meta.dir, "cdn-harvest-worker.ts");

const SITE_PUBLIC_WIKI = join(REPO_ROOT, "apps", "site", "public", "wiki");
const BOT_ASSETS_MANGA = join(REPO_ROOT, "apps", "bot", "assets", "manga");

function getDbUrl(): string {
	if (process.env.DATABASE_URL?.trim()) return process.env.DATABASE_URL.trim();
	if (process.env.REMOTE_DATABASE_URL?.trim()) return process.env.REMOTE_DATABASE_URL.trim();
	for (const envPath of [
		join(REPO_ROOT, ".env.remote-db"),
		`${homedir()}/.shenron-neon.env`,
		join(REPO_ROOT, "apps", "site", ".env"),
		join(REPO_ROOT, "apps", "bot", ".env"),
		join(REPO_ROOT, ".env"),
	]) {
		if (existsSync(envPath)) {
			const text = readFileSync(envPath, "utf8");
			for (const line of text.split("\n")) {
				if (line.startsWith("REMOTE_DATABASE_URL=") || line.startsWith("DATABASE_URL=")) {
					const val = line.split("=")[1]?.trim().replace(/^['"]|['"]$/g, "");
					if (val) return val;
				}
			}
		}
	}
	throw new Error("DATABASE_URL / REMOTE_DATABASE_URL non configuré.");
}

function cuid24(): string {
	return Array.from(
		{ length: 24 },
		() => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]
	).join("");
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Définition des Séries & Volumes
// ─────────────────────────────────────────────────────────────────────────────

interface VolumeItem {
	series: string;
	volNum: number;
	jsonFile: string;
	targetDir: string;
	dbRelativePrefix: string;
	format: "jpg" | "webp";
	quality?: number;
	chapterId?: number | string;
	title?: string;
}

function buildVolumeList(): VolumeItem[] {
	const items: VolumeItem[] = [];

	// Sōshūhen Legend 1 (Databook 465)
	if (SERIES_ARG === "ALL" || SERIES_ARG === "SOSH_1" || SERIES_ARG === "SOSH") {
		items.push({
			series: "SOSH_1",
			volNum: 1,
			jsonFile: "0-11-0.json",
			targetDir: join(SITE_PUBLIC_WIKI, "databooks", "soshuhen-legend-01"),
			dbRelativePrefix: "./assets/wiki/databooks/soshuhen-legend-01",
			format: "jpg",
			title: "Dragon Ball Sōshūhen Legend 1",
		});
	}

	// Manga Kanzenban (DBKZ) : 34 tomes
	if (SERIES_ARG === "ALL" || SERIES_ARG === "DBKZ") {
		for (let i = 0; i < 34; i++) {
			items.push({
				series: "DBKZ",
				volNum: i + 1,
				jsonFile: `0-0-${i}.json`,
				targetDir: join(BOT_ASSETS_MANGA, "DBKZ", `vol${i + 1}`),
				dbRelativePrefix: `./assets/manga/DBKZ/vol${i + 1}`,
				format: "webp",
				quality: 75,
			});
		}
	}

	// Manga Tankōbon Japonais (DBJP) : 42 tomes
	if (SERIES_ARG === "ALL" || SERIES_ARG === "DBJP") {
		for (let i = 0; i < 42; i++) {
			items.push({
				series: "DBJP",
				volNum: i + 1,
				jsonFile: `0-1-${i}.json`,
				targetDir: join(BOT_ASSETS_MANGA, "DBJP", `vol${i + 1}`),
				dbRelativePrefix: `./assets/manga/DBJP/vol${i + 1}`,
				format: "webp",
				quality: 75,
			});
		}
	}

	// Anime Comics TV (DBZ_ANIME_COMICS) : 39 tomes
	if (SERIES_ARG === "ALL" || SERIES_ARG === "DBZ_ANIME_COMICS" || SERIES_ARG === "DBZ") {
		for (let i = 1; i <= 39; i++) {
			items.push({
				series: "DBZ_ANIME_COMICS",
				volNum: i,
				jsonFile: `0-13-${i}.json`,
				targetDir: join(BOT_ASSETS_MANGA, "DBZ_ANIME_COMICS", `vol${i}`),
				dbRelativePrefix: `./assets/manga/DBZ_ANIME_COMICS/vol${i}`,
				format: "webp",
				quality: 75,
			});
		}
	}

	// Anime Film Comics (DB_MOVIES) : 20 tomes
	if (SERIES_ARG === "ALL" || SERIES_ARG === "DB_MOVIES" || SERIES_ARG === "MOVIES") {
		for (let i = 1; i <= 20; i++) {
			items.push({
				series: "DB_MOVIES",
				volNum: i,
				jsonFile: `0-12-${i}.json`,
				targetDir: join(BOT_ASSETS_MANGA, "DB_MOVIES", `vol${i}`),
				dbRelativePrefix: `./assets/manga/DB_MOVIES/vol${i}`,
				format: "webp",
				quality: 75,
			});
		}
	}

	// Dr. Slump (ARALE) : 18 tomes
	if (SERIES_ARG === "ALL" || SERIES_ARG === "ARALE") {
		for (let i = 0; i < 18; i++) {
			items.push({
				series: "ARALE",
				volNum: i + 1,
				jsonFile: `1-2-${i}.json`,
				targetDir: join(BOT_ASSETS_MANGA, "ARALE", `vol${i + 1}`),
				dbRelativePrefix: `./assets/manga/ARALE/vol${i + 1}`,
				format: "webp",
				quality: 75,
			});
		}
	}

	return items;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Pool de Workers & Orchestrateur
// ─────────────────────────────────────────────────────────────────────────────

interface PageJob {
	task: HarvestTask;
	series: string;
	volNum: number;
	pageNum: number;
	localDbUrl: string;
}

async function runHarvestPool(jobs: PageJob[], concurrency: number): Promise<{
	successCount: number;
	skippedCount: number;
	errorCount: number;
	totalBytes: number;
}> {
	if (jobs.length === 0) {
		return { successCount: 0, skippedCount: 0, errorCount: 0, totalBytes: 0 };
	}

	console.log(`\n🚀 Lancement du pool de moissonnage (${concurrency} workers, ${jobs.length} planches à traiter)...`);

	const startTime = Date.now();
	let nextIdx = 0;
	let completedCount = 0;
	let successCount = 0;
	let skippedCount = 0;
	let errorCount = 0;
	let totalBytes = 0;

	const numWorkers = Math.min(concurrency, jobs.length);
	const workers: Worker[] = [];

	return new Promise((resolve) => {
		let activeWorkers = numWorkers;

		for (let wId = 0; wId < numWorkers; wId++) {
			const worker = new Worker(new URL(WORKER_SCRIPT, import.meta.url).href);
			workers.push(worker);

			const dispatchNext = () => {
				if (nextIdx >= jobs.length) {
					worker.terminate();
					activeWorkers--;
					if (activeWorkers === 0) {
						resolve({ successCount, skippedCount, errorCount, totalBytes });
					}
					return;
				}

				const job = jobs[nextIdx++];
				worker.postMessage(job.task, worker.location.origin);
			};

			worker.onmessage = (event: MessageEvent<HarvestResult>) => {
				const res = event.data;
				completedCount++;

				if (res.type === "success") {
					successCount++;
					totalBytes += res.bytes ?? 0;
				} else if (res.type === "skipped") {
					skippedCount++;
					totalBytes += res.bytes ?? 0;
				} else {
					errorCount++;
					console.error(`  ✗ [W#${wId}] Échec ${res.id}: ${res.error}`);
				}

				if (completedCount % 50 === 0 || completedCount === jobs.length) {
					const pct = ((completedCount / jobs.length) * 100).toFixed(1);
					const elapsedSec = Math.max(0.1, (Date.now() - startTime) / 1000);
					const rate = (completedCount / elapsedSec).toFixed(1);
					const mb = (totalBytes / (1024 * 1024)).toFixed(1);
					console.log(
						`  [${completedCount}/${jobs.length} - ${pct}%] ${rate} img/s | ${mb} Mo | Succès: ${successCount}, Ignorés: ${skippedCount}, Erreurs: ${errorCount}`
					);
				}

				dispatchNext();
			};

			worker.onerror = (err) => {
				console.error(`  [Worker #${wId} error]:`, err);
				completedCount++;
				errorCount++;
				dispatchNext();
			};

			dispatchNext();
		}
	});
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Synchronisation Base de Données & Traçabilité
// ─────────────────────────────────────────────────────────────────────────────

async function syncDatabases(volumes: VolumeItem[], sql: postgres.Sql) {
	console.log(`\n🗄️  Synchronisation des bases de données (${volumes.length} volumes)...`);

	for (const vol of volumes) {
		const jsonPath = join(VOLUMES_DIR, vol.jsonFile);
		if (!existsSync(jsonPath)) continue;
		const raw = readFileSync(jsonPath, "utf8");
		const data = JSON.parse(raw);
		const pages = data.pages as Array<{ pageNumber: number; imageUrl: string }>;
		if (!Array.isArray(pages) || pages.length === 0) continue;

		const ext = vol.format === "webp" ? "webp" : "jpg";

		if (vol.series === "SOSH_1") {
			// Databook 465
			console.log(`  Updating bot.db_databooks (ID 465)...`);
			const [current] = await sql<{
				pages: Array<{ number: number; image: string | null; text?: string | null; text_fr?: string | null; verifiee?: boolean }>;
			}>`
				SELECT pages FROM bot.db_databooks WHERE id = 465
			`;

			const currentPages = Array.isArray(current?.pages) ? current.pages : [];
			const updatedPages = pages.map((p, idx) => {
				const existing = currentPages[idx];
				const pad = String(p.pageNumber).padStart(3, "0");
				const localImg = `${vol.dbRelativePrefix}/${pad}.${ext}`;
				return {
					...existing,
					number: p.pageNumber,
					image: localImg,
					verifiee: true,
				};
			});

			await sql`
				UPDATE bot.db_databooks
				SET pages = ${sql.json(updatedPages)}
				WHERE id = 465
			`;

			const revId = cuid24();
			await sql`
				INSERT INTO public.wiki_revisions (
					id, "tableName", "rowId", action, label, before, after, "editorId", "editorName", "createdAt"
				) VALUES (
					${revId},
					'db_databooks',
					'465',
					'update',
					'Dragon Ball Sōshūhen Legend 1 - Localisation CDN Zéro-Hotlink',
					${sql.json({ pages_count: currentPages.length, note: "URLs distantes 403" })},
					${sql.json({ pages_count: updatedPages.length, sample: updatedPages.slice(0, 3) })},
					'shenron-cdn-agent',
					'Shenron CDN Agent',
					NOW()
				)
			`;
			console.log(`  ✓ Databook 465 mis à jour avec ${updatedPages.length} planches locales !`);
		} else {
			// Manga chapters
			const localUrls = pages.map((p) => {
				const pad = String(p.pageNumber).padStart(3, "0");
				return `${vol.dbRelativePrefix}/${pad}.${ext}`;
			});

			const [chap] = await sql<{ id: number; title: string | null; pages: unknown }>`
				SELECT id, title, pages
				FROM bot.db_manga_chapters
				WHERE series = ${vol.series} AND chapter_number = ${vol.volNum}
				LIMIT 1
			`;

			if (chap) {
				await sql`
					UPDATE bot.db_manga_chapters
					SET pages = ${sql.json(localUrls)}
					WHERE id = ${chap.id}
				`;

				const revId = cuid24();
				await sql`
					INSERT INTO public.wiki_revisions (
						id, "tableName", "rowId", action, label, before, after, "editorId", "editorName", "createdAt"
					) VALUES (
						${revId},
						'db_manga_chapters',
						${String(chap.id)},
						'update',
						${chap.title ?? `${vol.series} vol.${vol.volNum}`},
						${sql.json({ note: "URLs externes" })},
						${sql.json({ pages_count: localUrls.length, first: localUrls[0], last: localUrls[localUrls.length - 1] })},
						'shenron-cdn-agent',
						'Shenron CDN Agent',
						NOW()
					)
				`;
				console.log(`  ✓ ${vol.series} vol.${vol.volNum} (ch ${chap.id}) : ${localUrls.length} planches CDN.`);
			} else {
				console.warn(`  ⚠️ Chapitre introuvable pour ${vol.series} vol.${vol.volNum}`);
			}
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Point d'Entrée Principal
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
	console.log("🐉 === SHENRON CDN HARVEST & ZERO-HOTLINK INGESTION ===");
	console.log(`Mode série : ${SERIES_ARG}`);
	console.log(`Workers : ${CONCURRENCY}`);
	console.log(`DRY_RUN : ${DRY_RUN}`);
	console.log(`SKIP_DB : ${SKIP_DB}`);
	console.log(`DB_ONLY : ${DB_ONLY}`);

	const allVolumes = buildVolumeList();
	console.log(`📦 ${allVolumes.length} volume(s) ciblés.`);

	const jobs: PageJob[] = [];

	for (const vol of allVolumes) {
		const jsonPath = join(VOLUMES_DIR, vol.jsonFile);
		if (!existsSync(jsonPath)) {
			console.warn(`⚠️ Fichier introuvable : ${jsonPath}`);
			continue;
		}

		const raw = readFileSync(jsonPath, "utf8");
		const data = JSON.parse(raw);
		const pages = data.pages as Array<{ pageNumber: number; imageUrl: string }>;
		if (!Array.isArray(pages)) continue;

		const ext = vol.format === "webp" ? "webp" : "jpg";

		for (const page of pages) {
			const pad = String(page.pageNumber).padStart(3, "0");
			const destFile = `${pad}.${ext}`;
			const destPath = join(vol.targetDir, destFile);
			const localDbUrl = `${vol.dbRelativePrefix}/${destFile}`;

			jobs.push({
				task: {
					id: `${vol.series}-${vol.volNum}-${page.pageNumber}`,
					url: page.imageUrl,
					destPath,
					format: vol.format,
					quality: vol.quality,
				},
				series: vol.series,
				volNum: vol.volNum,
				pageNum: page.pageNumber,
				localDbUrl,
			});
		}
	}

	console.log(`📋 Total planches à traiter : ${jobs.length}`);

	const workJobs = LIMIT ? jobs.slice(0, LIMIT) : jobs;

	if (!DB_ONLY && !DRY_RUN) {
		const stats = await runHarvestPool(workJobs, CONCURRENCY);
		console.log(`\n🎉 Téléchargements terminés :`);
		console.log(`  - Réussis : ${stats.successCount}`);
		console.log(`  - Déjà présents (ignorés) : ${stats.skippedCount}`);
		console.log(`  - Erreurs : ${stats.errorCount}`);
		console.log(`  - Volume : ${(stats.totalBytes / (1024 * 1024)).toFixed(1)} Mo`);
	}

	if (!SKIP_DB && !DRY_RUN) {
		const dbUrl = getDbUrl();
		const sql = postgres(dbUrl, { max: 2, prepare: false });
		try {
			await syncDatabases(allVolumes, sql);
		} finally {
			await sql.end();
		}
	}

	console.log(`\n✨ Opération terminée avec succès !`);
}

main().catch((err) => {
	console.error("💥 Erreur fatale :", err);
	process.exit(1);
});
