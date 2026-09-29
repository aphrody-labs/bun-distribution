#!/usr/bin/env bun
/**
 * populate-manga-pages.ts
 *
 * Ingestion des planches pour les 153 tomes et chapitres manga non complétés
 * dans PostgreSQL (bot.db_manga_chapters) à partir des dumps locaux de dragonballcn :
 *   - DBKZ (Kanzenban) : 34 tomes (8 202 planches)
 *   - DBJP (Édition japonaise originale) : 42 tomes (8 031 planches)
 *   - DBZ_ANIME_COMICS (TV Anime Comics) : 39 tomes (5 604 planches)
 *   - DB_MOVIES (Film Anime Comics) : 20 tomes (3 070 planches)
 *   - ARALE (Dr. Slump) : 18 tomes (3 342 planches)
 * Total : 153 chapitres, 28 249 planches.
 *
 * Usage :
 *   bun --env-file=apps/site/.env apps/site/scripts/populate-manga-pages.ts [--dry-run]
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");

async function getDatabaseUrl(): Promise<string> {
	const direct = process.env.DATABASE_URL?.trim();
	if (direct) return direct;
	const envFile = join(import.meta.dir, "..", ".env");
	const text = await Bun.file(envFile).text().catch(() => "");
	const lines = text.split("\n").filter((l) => l.startsWith("DATABASE_URL="));
	const value = lines.at(-1)?.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");
	if (!value) {
		console.error("✗ DATABASE_URL introuvable dans l'environnement ou apps/site/.env");
		process.exit(1);
	}
	return value;
}

interface SeriesConfig {
	series: string;
	label: string;
	prefix: string;
	count: number;
	startIdx: number;
	chStart: number;
	expectedPages: number;
}

const SERIES_CONFIGS: SeriesConfig[] = [
	{
		series: "DBKZ",
		label: "Dragon Ball Kanzenban",
		prefix: "0-0-",
		count: 34,
		startIdx: 0,
		chStart: 1,
		expectedPages: 8202,
	},
	{
		series: "DBJP",
		label: "Dragon Ball (Édition Japonaise Tankōbon)",
		prefix: "0-1-",
		count: 42,
		startIdx: 0,
		chStart: 1,
		expectedPages: 8031,
	},
	{
		series: "DBZ_ANIME_COMICS",
		label: "Dragon Ball Z TV Anime Comics",
		prefix: "0-13-",
		count: 39,
		startIdx: 1,
		chStart: 1,
		expectedPages: 5604,
	},
	{
		series: "DB_MOVIES",
		label: "Dragon Ball Film Anime Comics",
		prefix: "0-12-",
		count: 20,
		startIdx: 1,
		chStart: 1,
		expectedPages: 3070,
	},
	{
		series: "ARALE",
		label: "Dr. Slump",
		prefix: "1-2-",
		count: 18,
		startIdx: 0,
		chStart: 1,
		expectedPages: 3342,
	},
];

const generateRevisionId = () =>
	Array.from(
		{ length: 24 },
		() => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]
	).join("");

async function main() {
	const dbUrl = await getDatabaseUrl();
	const sql = postgres(dbUrl, { max: 2, prepare: false });

	const repoRoot = join(import.meta.dir, "..", "..", "..");
	const volumesDir = join(repoRoot, "data", "dragonballcn", "volumes");

	console.log(`\n=== Ingestion des planches manga (DragonBallCN) ===`);
	console.log(`Mode: ${DRY_RUN ? "SIMULATION (--dry-run)" : "APPLICATION RÉELLE"}`);
	console.log(`Volumes directory: ${volumesDir}\n`);

	let grandTotalChapters = 0;
	let grandTotalPages = 0;

	try {
		for (const cfg of SERIES_CONFIGS) {
			console.log(`\n--- Série ${cfg.series} (${cfg.label}) ---`);
			let seriesPages = 0;

			// Récupère les chapitres correspondants en base
			const dbChapters = await sql<
				Array<{
					id: string;
					series: string;
					chapter_number: string;
					volume_id: string;
					title: string | null;
					pages: unknown;
				}>
			>`
				SELECT id, series, chapter_number, volume_id, title, pages
				FROM bot.db_manga_chapters
				WHERE series = ${cfg.series}
				ORDER BY chapter_number
			`;

			if (dbChapters.length !== cfg.count) {
				console.warn(
					`⚠️ Attendu ${cfg.count} chapitres en base pour ${cfg.series}, trouvé ${dbChapters.length}`
				);
			}

			for (let i = 0; i < cfg.count; i++) {
				const fileId = `${cfg.prefix}${cfg.startIdx + i}`;
				const filePath = join(volumesDir, `${fileId}.json`);

				if (!existsSync(filePath)) {
					throw new Error(`Fichier introuvable : ${filePath}`);
				}

				const rawContent = readFileSync(filePath, "utf-8");
				const volumeData = JSON.parse(rawContent);

				const chNum = cfg.chStart + i;
				const dbChapter = dbChapters.find((c) => Number(c.chapter_number) === chNum);

				if (!dbChapter) {
					throw new Error(
						`Chapitre manquant en base pour ${cfg.series} ch #${chNum} (fichier ${fileId}.json)`
					);
				}

				if (!Array.isArray(volumeData.pages) || volumeData.pages.length === 0) {
					throw new Error(`Aucune planche trouvée dans ${filePath}`);
				}

				const urls: string[] = volumeData.pages.map((p: { imageUrl: string }) => p.imageUrl);

				// Vérification de validité de chaque URL
				for (const u of urls) {
					if (!u || typeof u !== "string" || !u.startsWith("http")) {
						throw new Error(`URL de planche invalide dans ${fileId}.json : ${u}`);
					}
				}

				seriesPages += urls.length;
				grandTotalChapters++;

				const beforePages = dbChapter.pages;
				const beforeCount = Array.isArray(beforePages) ? beforePages.length : 0;

				console.log(
					`  Ch #${String(chNum).padStart(2)} (ID ${dbChapter.id}): ${urls.length} planches (précédemment ${beforeCount})`
				);

				if (!DRY_RUN) {
					await sql.begin(async (tx) => {
						// 1. Mise à jour de bot.db_manga_chapters
						await tx`
							UPDATE bot.db_manga_chapters
							SET pages = ${tx.json(urls)}
							WHERE id = ${dbChapter.id}
						`;

						// 2. Enregistrement dans public.wiki_revisions
						const revId = generateRevisionId();
						await tx`
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
								${String(dbChapter.id)},
								'update',
								${dbChapter.title ?? `${cfg.series} #${chNum}`},
								${tx.json({ pages_count: beforeCount, sample: Array.isArray(beforePages) ? beforePages.slice(0, 3) : [] })},
								${tx.json({ pages_count: urls.length, first_page: urls[0], last_page: urls[urls.length - 1], pages: urls })},
								'shenron-manga-agent',
								'Shenron Manga Ingestion Agent',
								NOW()
							)
						`;
					});
				}
			}

			console.log(
				`Série ${cfg.series} : ${cfg.count} chapitres traités, ${seriesPages} planches (attendu: ${cfg.expectedPages})`
			);
			if (seriesPages !== cfg.expectedPages) {
				console.warn(
					`⚠️ Différence de compte pour ${cfg.series} : obtenu ${seriesPages}, attendu ${cfg.expectedPages}`
				);
			}
			grandTotalPages += seriesPages;
		}

		console.log(`\n========================================`);
		console.log(`Total chapitres traités : ${grandTotalChapters} / 153`);
		console.log(`Total planches insérées : ${grandTotalPages} / 28249`);
		console.log(`========================================\n`);

		if (!DRY_RUN) {
			const remainingEmpty = await sql`
				SELECT count(*) AS empty_count
				FROM bot.db_manga_chapters
				WHERE pages IS NULL OR jsonb_array_length(pages) = 0
			`;
			const count = Number(remainingEmpty[0].empty_count);
			console.log(`Vérification PostgreSQL :`);
			console.log(`Chapitres avec pages IS NULL ou longueur 0 : ${count}`);
			if (count === 0) {
				console.log(`✓ SUCCÈS : Strictement 0 chapitre vide en base !`);
			} else {
				console.error(`✗ ERREUR : Il reste ${count} chapitres vides !`);
				process.exit(1);
			}
		} else {
			console.log(`(Simulation terminée sans écriture en base. Lancer sans --dry-run pour appliquer)`);
		}
	} finally {
		await sql.end();
	}
}

main().catch((err) => {
	console.error("✗ Échec de l'ingestion :", err);
	process.exit(1);
});
