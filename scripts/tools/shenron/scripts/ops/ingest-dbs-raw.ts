#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * scripts/ops/ingest-dbs-raw.ts
 *
 * Ingestion intégrale des 103 chapitres Dragon Ball Super RAW japonais depuis jmanga.cyou :
 * 1. Téléchargement et parsing de la liste des chapitres (#ja-chapters)
 * 2. Appel de l'API verticale JSON (https://jmanga.cyou/json/chapter?mode=vertical&id=...)
 * 3. Extraction et téléchargement parallèle des planches haute définition (Referer: https://jmanga.cyou/)
 * 4. Conversion et compression WebP (Sharp q=85) dans apps/bot/assets/manga/DBSJP/ch${chapterNumber}/${padPage}.webp
 *    (immédiatement servi par le CDN Nginx sur https://cdn.dragonballfr.com/assets/manga/DBSJP/...)
 * 5. Indexation dans PostgreSQL (bot.db_manga_chapters, series = 'DBSJP')
 * 6. Audit et traçabilité dans public.wiki_revisions
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import postgres from "postgres";
import sharp from "sharp";

const REPO_ROOT = resolve(import.meta.dir, "..", "..");
const ASSETS_BASE = join(REPO_ROOT, "apps", "bot", "assets", "manga", "DBSJP");
const DBS_RAW_PAGE_URL = "https://jmanga.cyou/read/" + encodeURIComponent("ドラゴンボール超") + "/ja/chapter-101-raw/";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function cuid24(): string {
	const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
	let res = "c";
	for (let i = 0; i < 23; i++) {
		res += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return res;
}

function getDbUrl(): string {
	if (process.env.DATABASE_URL?.trim()) return process.env.DATABASE_URL.trim();
	if (process.env.REMOTE_DATABASE_URL?.trim()) return process.env.REMOTE_DATABASE_URL.trim();
	const envFiles = [".env.remote-db", "apps/site/.env", "apps/bot/.env", ".env"];
	for (const f of envFiles) {
		const p = join(REPO_ROOT, f);
		if (existsSync(p)) {
			const lines = readFileSync(p, "utf8").split("\n");
			for (const line of lines) {
				if (line.startsWith("REMOTE_DATABASE_URL=") || line.startsWith("DATABASE_URL=")) {
					const val = line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "");
					if (val) return val;
				}
			}
		}
	}
	throw new Error("Impossible de déterminer DATABASE_URL");
}

interface JmangaChapterMeta {
	dataId: string;
	chapterNumber: number;
	href: string;
	title: string;
	name: string;
}

async function fetchHtmlWithRetry(url: string, maxRetries = 3): Promise<string> {
	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		try {
			const res = await fetch(url, {
				headers: {
					"User-Agent": USER_AGENT,
					Referer: "https://jmanga.cyou/",
				},
			});
			if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
			return await res.text();
		} catch (err: any) {
			if (attempt === maxRetries) throw err;
			const delay = attempt * 1500;
			console.warn(`[WARN] Échec fetch ${url} (tentative ${attempt}/${maxRetries}): ${err.message}. Nouvelle tentative dans ${delay}ms...`);
			await new Promise((r) => setTimeout(r, delay));
		}
	}
	throw new Error(`Échec fetch ${url}`);
}

async function fetchJsonWithRetry(url: string, maxRetries = 4): Promise<any> {
	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		try {
			const res = await fetch(url, {
				headers: {
					"User-Agent": USER_AGENT,
					Referer: "https://jmanga.cyou/",
					Accept: "application/json, text/javascript, */*; q=0.01",
					"X-Requested-With": "XMLHttpRequest",
				},
			});
			if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
			return await res.json();
		} catch (err: any) {
			if (attempt === maxRetries) throw err;
			const delay = attempt * 1500;
			console.warn(`[WARN] Échec JSON ${url} (tentative ${attempt}/${maxRetries}): ${err.message}. Nouvelle tentative dans ${delay}ms...`);
			await new Promise((r) => setTimeout(r, delay));
		}
	}
	throw new Error(`Échec fetch JSON ${url}`);
}

async function downloadImageWithRetry(url: string, maxRetries = 4): Promise<Buffer> {
	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		try {
			const res = await fetch(url, {
				headers: {
					"User-Agent": USER_AGENT,
					Referer: "https://jmanga.cyou/",
				},
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const buf = Buffer.from(await res.arrayBuffer());
			if (buf.length < 500) {
				throw new Error(`Buffer trop court (${buf.length} octets) pour image`);
			}
			return buf;
		} catch (err: any) {
			if (attempt === maxRetries) throw err;
			const delay = attempt * 1000;
			await new Promise((r) => setTimeout(r, delay));
		}
	}
	throw new Error(`Échec téléchargement image ${url}`);
}

async function extractChaptersList(): Promise<JmangaChapterMeta[]> {
	console.log(`[1/4] Récupération de la liste des chapitres depuis ${DBS_RAW_PAGE_URL}...`);
	const html = await fetchHtmlWithRetry(DBS_RAW_PAGE_URL);
	const jaIdx = html.indexOf('id="ja-chapters"');
	if (jaIdx === -1) {
		throw new Error("Conteneur #ja-chapters introuvable dans la page source");
	}
	const endUl = html.indexOf("</ul>", jaIdx);
	const section = html.slice(jaIdx, endUl !== -1 ? endUl : jaIdx + 200000);

	const regex = /<li[^>]*class="[^"]*chapter-item[^"]*"[^>]*data-id="([^"]+)"[^>]*data-number="([^"]+)"[\s\S]*?<a[^>]*href="([^"]+)"[^>]*title="([^"]*)"[\s\S]*?<span class="name">([\s\S]*?)<\/span>/g;

	const chapters: JmangaChapterMeta[] = [];
	for (const match of section.matchAll(regex)) {
		const [, dataId, dataNumber, href, rawTitle, rawName] = match;
		chapters.push({
			dataId,
			chapterNumber: parseFloat(dataNumber),
			href,
			title: rawTitle.trim(),
			name: rawName.replace(/<[^>]+>/g, "").trim(),
		});
	}

	chapters.sort((a, b) => a.chapterNumber - b.chapterNumber);
	console.log(`  ✓ ${chapters.length} chapitres extraits (Ch.${chapters[0]?.chapterNumber} à Ch.${chapters[chapters.length - 1]?.chapterNumber})`);
	return chapters;
}

// Limiter la concurrence globale
async function mapConcurrent<T, R>(items: T[], concurrency: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> {
	const results: R[] = Array.from<R>({ length: items.length });
	let nextIndex = 0;
	const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
		while (nextIndex < items.length) {
			const current = nextIndex++;
			results[current] = await fn(items[current], current);
		}
	});
	await Promise.all(workers);
	return results;
}

async function main() {
	const args = process.argv.slice(2);
	const force = args.includes("--force");
	const onlyCh = args.find((a) => a.startsWith("--chapter="))?.split("=")[1];
	const concurrencyArg = args.find((a) => a.startsWith("--concurrency="))?.split("=")[1];
	const concurrency = concurrencyArg ? parseInt(concurrencyArg, 10) : 4;

	console.log("================================================================================");
	console.log("🚀 Ingestion DBS RAW Japonais (jmanga.cyou → WebP CDN → bot.db_manga_chapters)");
	console.log(`   Force: ${force ? "OUI" : "NON"} | Concurrence chapitres: ${concurrency}`);
	if (onlyCh) console.log(`   Chapitre ciblé uniquement: ${onlyCh}`);
	console.log("================================================================================");

	const sql = postgres(getDbUrl(), { max: 10 });

	try {
		// 1. Charger métadonnées DBS existantes (titres originaux, volume_id, date de parution)
		const dbsRows = await sql`
			SELECT chapter_number, title_ja, volume_id, published_at
			FROM bot.db_manga_chapters
			WHERE series = 'DBS'
		`;
		const dbsMap = new Map<number, { title_ja: string | null; volume_id: string | null; published_at: string | null }>();
		for (const r of dbsRows) {
			dbsMap.set(Number(r.chapter_number), {
				title_ja: r.title_ja ?? null,
				volume_id: r.volume_id ?? null,
				published_at: r.published_at ?? null,
			});
		}

		// 2. Extraire la liste des 103 chapitres
		let allChapters = await extractChaptersList();
		if (onlyCh) {
			const chNum = parseInt(onlyCh, 10);
			allChapters = allChapters.filter((c) => c.chapterNumber === chNum);
		}

		mkdirSync(ASSETS_BASE, { recursive: true });

		let totalPagesDownloaded = 0;
		let totalBytesDownloaded = 0;
		let totalChaptersProcessed = 0;
		const tStart = performance.now();

		console.log(`\n[2/4] Traitement des ${allChapters.length} chapitres...`);

		await mapConcurrent(allChapters, concurrency, async (chMeta, chIdx) => {
			const chNum = chMeta.chapterNumber;
			const chDir = join(ASSETS_BASE, `ch${chNum}`);
			mkdirSync(chDir, { recursive: true });

			const dbsInfo = dbsMap.get(chNum);
			const titleJa = dbsInfo?.title_ja ? `第${chNum}話 ${dbsInfo.title_ja}` : `第${chNum}話`;
			const publishedAt = dbsInfo?.published_at ? BigInt(dbsInfo.published_at) : BigInt(Math.floor(Date.now() / 1000));
			const volumeId = dbsInfo?.volume_id ? BigInt(dbsInfo.volume_id) : null;
			const chapterRecordId = 36000 + chNum;

			// Vérifier si le chapitre est déjà complet sur disque
			let existingFiles: string[] = [];
			if (existsSync(chDir)) {
				existingFiles = readdirSync(chDir)
					.filter((f) => f.endsWith(".webp") && !f.startsWith("."))
					.toSorted();
			}

			// Interroger l'API jmanga pour connaître les images
			const jsonUrl = `https://jmanga.cyou/json/chapter?mode=vertical&id=${chMeta.dataId}`;
			let imageUrls: string[] = [];

			if (!force && existingFiles.length >= 15) {
				// Déjà téléchargé sur disque, on vérifie si la DB est à jour
				// Utiliser les fichiers existants
				imageUrls = existingFiles.map((f, idx) => `./assets/manga/DBSJP/ch${chNum}/${f}`);
			} else {
				const json = await fetchJsonWithRetry(jsonUrl);
				imageUrls = [...(json.html || "").matchAll(/data-src="([^"]+)"/g)].map((m) => m[1]);
				if (imageUrls.length === 0) {
					throw new Error(`Aucune image trouvée pour le chapitre ${chNum} (id ${chMeta.dataId})`);
				}

				// Télécharger et convertir chaque image en WebP
				let chBytes = 0;
				// Téléchargement parallèle des pages du chapitre avec Sharp
				const pageFiles = await mapConcurrent(imageUrls, 8, async (imgUrl, pageIdx) => {
					const pad = String(pageIdx + 1).padStart(3, "0");
					const dest = join(chDir, `${pad}.webp`);
					const relPath = `./assets/manga/DBSJP/ch${chNum}/${pad}.webp`;

					// Si le fichier existe déjà et valide (> 2048 bytes), skip re-download
					if (!force && existsSync(dest)) {
						const st = statSync(dest);
						if (st.size > 2048) {
							return relPath;
						}
					}

					const buf = await downloadImageWithRetry(imgUrl);
					const webpBuf = await sharp(buf).webp({ quality: 85 }).toBuffer();
					await writeFile(dest, webpBuf);
					chBytes += webpBuf.length;
					return relPath;
				});

				totalBytesDownloaded += chBytes;
				totalPagesDownloaded += pageFiles.length;
			}

			const pagesList = existingFiles.length > 0 && (!force && existingFiles.length >= 15)
				? existingFiles.map((f) => `./assets/manga/DBSJP/ch${chNum}/${f}`)
				: imageUrls.map((_, idx) => `./assets/manga/DBSJP/ch${chNum}/${String(idx + 1).padStart(3, "0")}.webp`);

			const coverRel = `./assets/manga/DBSJP/ch${chNum}/001.webp`;

			// 3. PostgreSQL : Upsert dans bot.db_manga_chapters
			const [existingRow] = await sql`
				SELECT * FROM bot.db_manga_chapters
				WHERE series = 'DBSJP' AND chapter_number = ${chNum}
			`;

			const targetId = existingRow ? existingRow.id : chapterRecordId;

			await sql`
				INSERT INTO bot.db_manga_chapters (
					id,
					series,
					chapter_number,
					title,
					title_ja,
					volume_id,
					published_at,
					cover,
					pages,
					visible
				) VALUES (
					${targetId},
					'DBSJP',
					${chNum},
					${`Chapitre ${chNum}`},
					${titleJa},
					${volumeId},
					${publishedAt},
					${coverRel},
					${sql.json(pagesList)},
					true
				)
				ON CONFLICT (id) DO UPDATE SET
					series = EXCLUDED.series,
					chapter_number = EXCLUDED.chapter_number,
					title = EXCLUDED.title,
					title_ja = EXCLUDED.title_ja,
					volume_id = EXCLUDED.volume_id,
					published_at = EXCLUDED.published_at,
					cover = EXCLUDED.cover,
					pages = EXCLUDED.pages,
					visible = true
			`;

			// 4. Audit dans public.wiki_revisions
			const revId = cuid24();
			const afterPayload = {
				id: targetId,
				series: "DBSJP",
				chapter_number: chNum,
				title: `Chapitre ${chNum}`,
				title_ja: titleJa,
				volume_id: volumeId ? String(volumeId) : null,
				pages_count: pagesList.length,
				cover: coverRel,
				first_page: pagesList[0],
				last_page: pagesList[pagesList.length - 1],
			};

			await sql`
				INSERT INTO public.wiki_revisions (
					id,
					"tableName",
					"rowId",
					action,
					label,
					before,
					after,
					"editorId",
					"editorName",
					"createdAt"
				) VALUES (
					${revId},
					'db_manga_chapters',
					${String(targetId)},
					${existingRow ? "update" : "insert"},
					${`Ingestion DBSJP RAW Chapitre ${chNum} (${pagesList.length} pages)`},
					${existingRow ? sql.json(existingRow) : null},
					${sql.json(afterPayload)},
					'shenron-dbs-agent',
					'Shenron DBS RAW Ingestion Agent',
					NOW()
				)
			`;

			totalChaptersProcessed++;
			const pct = ((totalChaptersProcessed / allChapters.length) * 100).toFixed(1);
			console.log(
				`  [${String(totalChaptersProcessed).padStart(3, " ")}/${allChapters.length} - ${pct.padStart(5, " ")}%] ✓ Ch.${chNum.toString().padStart(3, " ")} (${pagesList.length} pages) → DB ID ${targetId} & rev ${revId.slice(0, 10)}`,
			);
		});

		const durationSec = ((performance.now() - tStart) / 1000).toFixed(1);
		console.log("\n================================================================================");
		console.log(`✨ INGESTION TERMINÉE EN ${durationSec}s`);
		console.log(`   Chapitres traités : ${totalChaptersProcessed} / ${allChapters.length}`);
		console.log(`   Pages téléchargées : ${totalPagesDownloaded}`);
		console.log(`   Poids téléchargé  : ${(totalBytesDownloaded / (1024 * 1024)).toFixed(2)} Mo`);
		console.log("================================================================================");

		// 5. Vérification finale en base
		const [stats] = await sql`
			SELECT
				count(*)::int as total,
				min(chapter_number)::int as min_ch,
				max(chapter_number)::int as max_ch,
				min(id)::text as min_id,
				max(id)::text as max_id
			FROM bot.db_manga_chapters
			WHERE series = 'DBSJP'
		`;
		console.log("\n[VERIFICATION POSTGRESQL]");
		console.log(`Total chapitres DBSJP : ${stats.total}`);
		console.log(`Plage chapitres       : Ch.${stats.min_ch} à Ch.${stats.max_ch}`);
		console.log(`Plage IDs             : ${stats.min_id} à ${stats.max_id}`);

		// Vérifier un exemple de pages
		const [ch101] = await sql`
			SELECT id, series, chapter_number, title, title_ja, cover, jsonb_array_length(pages) as pages_count
			FROM bot.db_manga_chapters
			WHERE series = 'DBSJP' AND chapter_number = 101
		`;
		console.log("\n[DÉTAIL DU CHAPITRE 101 EN BASE]");
		console.log(ch101);
	} finally {
		await sql.end();
	}
}

main().catch((err) => {
	console.error("\n❌ ERREUR FATALE LORS DE L'INGESTION :", err);
	process.exit(1);
});
