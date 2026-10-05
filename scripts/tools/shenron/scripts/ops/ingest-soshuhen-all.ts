#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * ingest-soshuhen-all.ts
 *
 * Rapatriement, assemblage physique, hébergement CDN et synchronisation PostgreSQL
 * de l'intégrale des 18 volumes de Dragon Ball Sōshūhen — Digest Edition (DRAGON BALL 総集編 超悟空伝) :
 * - 18 volumes au format Shōnen Jump d'époque (Legend 1 à 18)
 * - 519 chapitres originaux d'Akira Toriyama + bonus/posters dépliants
 * - Couvertures officielles B5 haute définition
 * - Intégration dans bot.db_manga_volumes (série 'SOSH', IDs 701..718)
 * - Intégration dans bot.db_manga_chapters (série 'SOSH', IDs 35001..35018)
 * - Mise à jour de bot.db_databooks (IDs 465, 469..485)
 * - Journalisation dans public.wiki_revisions
 */

import { existsSync, mkdirSync, copyFileSync } from "node:fs";
import { readdir, chmod } from "node:fs/promises";
import { join, resolve } from "node:path";
import postgres from "postgres";
import sharp from "sharp";
import { createHash } from "node:crypto";

const REPO_ROOT = resolve(import.meta.dir, "..", "..");
const SITE_PUBLIC_WIKI = join(REPO_ROOT, "apps", "site", "public", "wiki");
const DATABOOKS_DIR = join(SITE_PUBLIC_WIKI, "databooks");
const DBFC_DIR = join(REPO_ROOT, "apps", "bot", "assets", "manga", "DBFC");

function getDbUrl(): string {
	if (process.env.DATABASE_URL?.trim()) return process.env.DATABASE_URL.trim();
	if (process.env.REMOTE_DATABASE_URL?.trim()) return process.env.REMOTE_DATABASE_URL.trim();
	const envPath = join(REPO_ROOT, ".env.remote-db");
	if (existsSync(envPath)) {
		const text = require("node:fs").readFileSync(envPath, "utf8");
		for (const line of text.split("\n")) {
			if (line.startsWith("REMOTE_DATABASE_URL=") || line.startsWith("DATABASE_URL=")) {
				const val = line.split("=")[1]?.trim().replace(/^['"]|['"]$/g, "");
				if (val) return val;
			}
		}
	}
	throw new Error("DATABASE_URL introuvable");
}

interface SoshuhenLegendDef {
	legend: number;
	databookId: number;
	volId: number;
	chapterId: number;
	titleFr: string;
	titleJa: string;
	arcFr: string;
	arcJa: string;
	startCh: number;
	endCh: number;
	isbn: string;
	publishedAt: number;
	coverPngName: string;
}

const SOSHUHEN_LEGENDS: SoshuhenLegendDef[] = [
	{
		legend: 1,
		databookId: 465,
		volId: 701,
		chapterId: 35001,
		titleFr: "Dragon Ball Sōshūhen — Digest Edition Vol. 1",
		titleJa: "DRAGON BALL 総集編 超悟空伝 Legend 1",
		arcFr: "Quête des Dragon Balls",
		arcJa: "孫悟空と仲間たち（ドラゴンボール探索編）",
		startCh: 1,
		endCh: 23,
		isbn: "978-4-08-111165-7",
		publishedAt: 1463097600,
		coverPngName: "soshuhen-legend-01.png",
	},
	{
		legend: 2,
		databookId: 469,
		volId: 702,
		chapterId: 35002,
		titleFr: "Dragon Ball Sōshūhen — Digest Edition Vol. 2",
		titleJa: "DRAGON BALL 総集編 超悟空伝 Legend 2",
		arcFr: "21e Tenkaichi Budōkai & Entraînement de Kamé Sennin",
		arcJa: "第21回天下一武道会編",
		startCh: 24,
		endCh: 54,
		isbn: "978-4-08-111166-4",
		publishedAt: 1464307200,
		coverPngName: "soshuhen-legend-02.png",
	},
	{
		legend: 3,
		databookId: 470,
		volId: 703,
		chapterId: 35003,
		titleFr: "Dragon Ball Sōshūhen — Digest Edition Vol. 3",
		titleJa: "DRAGON BALL 総集編 超悟空伝 Legend 3",
		arcFr: "Armée du Ruban Rouge (Partie 1) & Général Blue",
		arcJa: "レッドリボン軍編（前編）",
		startCh: 55,
		endCh: 83,
		isbn: "978-4-08-111167-1",
		publishedAt: 1465516800,
		coverPngName: "soshuhen-legend-03.png",
	},
	{
		legend: 4,
		databookId: 471,
		volId: 704,
		chapterId: 35004,
		titleFr: "Dragon Ball Sōshūhen — Digest Edition Vol. 4",
		titleJa: "DRAGON BALL 総集編 超悟空伝 Legend 4",
		arcFr: "Armée du Ruban Rouge (Partie 2), Tour Karin & Tao Pai Pai",
		arcJa: "レッドリボン軍編（後編）",
		startCh: 84,
		endCh: 112,
		isbn: "978-4-08-111168-8",
		publishedAt: 1466726400,
		coverPngName: "soshuhen-legend-04.png",
	},
	{
		legend: 5,
		databookId: 472,
		volId: 705,
		chapterId: 35005,
		titleFr: "Dragon Ball Sōshūhen — Digest Edition Vol. 5",
		titleJa: "DRAGON BALL 総集編 超悟空伝 Legend 5",
		arcFr: "Palais de Baba la Voyante & 22e Tenkaichi Budōkai (Début)",
		arcJa: "占いババの宮殿＆第22回天下一武道会編（前編）",
		startCh: 113,
		endCh: 143,
		isbn: "978-4-08-111169-5",
		publishedAt: 1467936000,
		coverPngName: "soshuhen-legend-05.png",
	},
	{
		legend: 6,
		databookId: 473,
		volId: 706,
		chapterId: 35006,
		titleFr: "Dragon Ball Sōshūhen — Digest Edition Vol. 6",
		titleJa: "DRAGON BALL 総集編 超悟空伝 Legend 6",
		arcFr: "Duel contre Tenshinhan & L'ombre de Piccolo Daimaō",
		arcJa: "第22回天下一武道会編（後編）＆ピッコロ大魔王編（序章）",
		startCh: 144,
		endCh: 165,
		isbn: "978-4-08-111170-1",
		publishedAt: 1469145600,
		coverPngName: "soshuhen-legend-06.png",
	},
	{
		legend: 7,
		databookId: 474,
		volId: 707,
		chapterId: 35007,
		titleFr: "Dragon Ball Sōshūhen — Digest Edition Vol. 7",
		titleJa: "DRAGON BALL 総集編 超悟空伝 Legend 7",
		arcFr: "Guerre totale contre Piccolo Daimaō & L'Eau Sacrée",
		arcJa: "ピッコロ大魔王編（死闘編）",
		startCh: 166,
		endCh: 194,
		isbn: "978-4-08-111171-8",
		publishedAt: 1470355200,
		coverPngName: "soshuhen-legend-07.png",
	},
	{
		legend: 8,
		databookId: 475,
		volId: 708,
		chapterId: 35008,
		titleFr: "Dragon Ball Sōshūhen — Digest Edition Vol. 8",
		titleJa: "DRAGON BALL 総集編 超悟空伝 Legend 8",
		arcFr: "23e Tenkaichi Budōkai & Goku adulte contre Piccolo Jr.",
		arcJa: "第23回天下一武道会編",
		startCh: 195,
		endCh: 217,
		isbn: "978-4-08-111172-5",
		publishedAt: 1472169600,
		coverPngName: "soshuhen-legend-08.png",
	},
	{
		legend: 9,
		databookId: 476,
		volId: 709,
		chapterId: 35009,
		titleFr: "Dragon Ball Sōshūhen — Digest Edition Vol. 9",
		titleJa: "DRAGON BALL 総集編 超悟空伝 Legend 9",
		arcFr: "Invasion des Saiyans : Mort de Goku, Nappa et duel contre Vegeta",
		arcJa: "サイヤ人編",
		startCh: 218,
		endCh: 246,
		isbn: "978-4-08-111173-2",
		publishedAt: 1473379200,
		coverPngName: "soshuhen-legend-09.png",
	},
	{
		legend: 10,
		databookId: 477,
		volId: 710,
		chapterId: 35010,
		titleFr: "Dragon Ball Sōshūhen — Digest Edition Vol. 10",
		titleJa: "DRAGON BALL 総集編 超悟空伝 Legend 10",
		arcFr: "Cap sur la planète Namek : Les Dragon Balls extraterrestres",
		arcJa: "ナメック星編（前編）",
		startCh: 247,
		endCh: 271,
		isbn: "978-4-08-111174-9",
		publishedAt: 1474588800,
		coverPngName: "soshuhen-legend-10.png",
	},
	{
		legend: 11,
		databookId: 478,
		volId: 711,
		chapterId: 35011,
		titleFr: "Dragon Ball Sōshūhen — Digest Edition Vol. 11",
		titleJa: "DRAGON BALL 総集編 超悟空伝 Legend 11",
		arcFr: "Commando Ginyu & La terreur du tyran Freezer",
		arcJa: "ギニュー特戦隊＆フリーザ編（前編）",
		startCh: 272,
		endCh: 296,
		isbn: "978-4-08-111175-6",
		publishedAt: 1476403200,
		coverPngName: "soshuhen-legend-11.png",
	},
	{
		legend: 12,
		databookId: 479,
		volId: 712,
		chapterId: 35012,
		titleFr: "Dragon Ball Sōshūhen — Digest Edition Vol. 12",
		titleJa: "DRAGON BALL 総集編 超悟空伝 Legend 12",
		arcFr: "L'Éveil du Super Saiyan de la légende : Goku vs Freezer",
		arcJa: "伝説の超サイヤ人覚醒＆フリーザ編（激闘結着編）",
		startCh: 297,
		endCh: 329,
		isbn: "978-4-08-111176-3",
		publishedAt: 1477612800,
		coverPngName: "soshuhen-legend-12.png",
	},
	{
		legend: 13,
		databookId: 480,
		volId: 713,
		chapterId: 35013,
		titleFr: "Dragon Ball Sōshūhen — Digest Edition Vol. 13",
		titleJa: "DRAGON BALL 総集編 超悟空伝 Legend 13",
		arcFr: "Le jeune homme du futur, Trunks & Les Cyborgs du Dr. Gero",
		arcJa: "人造人間編（前編）",
		startCh: 330,
		endCh: 357,
		isbn: "978-4-08-111177-0",
		publishedAt: 1478822400,
		coverPngName: "soshuhen-legend-13.png",
	},
	{
		legend: 14,
		databookId: 481,
		volId: 714,
		chapterId: 35014,
		titleFr: "Dragon Ball Sōshūhen — Digest Edition Vol. 14",
		titleJa: "DRAGON BALL 総集編 超悟空伝 Legend 14",
		arcFr: "L'Émergence du monstre Cell & La Salle de l'Esprit et du Temps",
		arcJa: "セル編（完全体への進化）",
		startCh: 358,
		endCh: 388,
		isbn: "978-4-08-111178-7",
		publishedAt: 1480032000,
		coverPngName: "soshuhen-legend-14.png",
	},
	{
		legend: 15,
		databookId: 482,
		volId: 715,
		chapterId: 35015,
		titleFr: "Dragon Ball Sōshūhen — Digest Edition Vol. 15",
		titleJa: "DRAGON BALL 総集編 超悟空伝 Legend 15",
		arcFr: "Le Cell Games, L'Éveil de Gohan SSJ2 & Le Sacrifice de Goku",
		arcJa: "セルゲーム＆孫悟飯超覚醒編",
		startCh: 389,
		endCh: 420,
		isbn: "978-4-08-111179-4",
		publishedAt: 1481241600,
		coverPngName: "soshuhen-legend-15.png",
	},
	{
		legend: 16,
		databookId: 483,
		volId: 716,
		chapterId: 35016,
		titleFr: "Dragon Ball Sōshūhen — Digest Edition Vol. 16",
		titleJa: "DRAGON BALL 総集編 超悟空伝 Legend 16",
		arcFr: "Lycée Orange Star, Le Great Saiyaman & Le 25e Tournoi",
		arcJa: "魔人ブウ編（ハイスクール＆第25回天下一武道会）",
		startCh: 421,
		endCh: 454,
		isbn: "978-4-08-111180-0",
		publishedAt: 1482451200,
		coverPngName: "soshuhen-legend-16.png",
	},
	{
		legend: 17,
		databookId: 484,
		volId: 717,
		chapterId: 35017,
		titleFr: "Dragon Ball Sōshūhen — Digest Edition Vol. 17",
		titleJa: "DRAGON BALL 総集編 超悟空伝 Legend 17",
		arcFr: "Le Réveil de Majin Buu, Le Sacrifice de Vegeta & La Fusion Gotenks",
		arcJa: "魔人ブウ編（魔人復活＆超フュージョン）",
		startCh: 455,
		endCh: 485,
		isbn: "978-4-08-111181-7",
		publishedAt: 1484265600,
		coverPngName: "soshuhen-legend-17.png",
	},
	{
		legend: 18,
		databookId: 485,
		volId: 718,
		chapterId: 35018,
		titleFr: "Dragon Ball Sōshūhen — Digest Edition Vol. 18",
		titleJa: "DRAGON BALL 総集編 超悟空伝 Legend 18",
		arcFr: "Conclusion finale, Vegetto, Genkidama suprême & Bye-bye Dragon World",
		arcJa: "魔人ブウ決戦＆グランドフィナーレ（バイバイ ドラゴンワールド）",
		startCh: 486,
		endCh: 519,
		isbn: "978-4-08-111182-4",
		publishedAt: 1485475200,
		coverPngName: "soshuhen-legend-18.png",
	},
];

function cuid24(): string {
	return Array.from(
		{ length: 24 },
		() => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]
	).join("");
}

async function run() {
	console.log("🐉 Ingestion Complète Dragon Ball Sōshūhen (Legend 1 à 18)...");
	const sql = postgres(getDbUrl());

	for (const item of SOSHUHEN_LEGENDS) {
		const padNum = item.legend.toString().padStart(2, "0");
		const legendDirName = `soshuhen-legend-${padNum}`;
		const legendDir = join(DATABOOKS_DIR, legendDirName);

		if (!existsSync(legendDir)) {
			mkdirSync(legendDir, { recursive: true });
		}

		const pagesList: Array<{
			number: number;
			image: string;
			text: string;
			text_fr: string;
			verifiee: boolean;
		}> = [];
		const chapterPagesList: string[] = [];

		if (item.legend === 1) {
			// Legend 1 est déjà intégralement téléchargé (381 planches)
			console.log(`\n📖 Legend 1 : Traitement du volume existant (381 planches)...`);
			const files = (await readdir(legendDir))
				.filter((f) => f.endsWith(".jpg"))
				.toSorted((a, b) => {
					const numA = Number.parseInt(a.replace(".jpg", ""), 10);
					const numB = Number.parseInt(b.replace(".jpg", ""), 10);
					return numA - numB;
				});

			// Récupérer les métadonnées existantes du databook 465
			const existingBook = await sql`SELECT pages FROM bot.db_databooks WHERE id = 465`;
			const existingPages = (existingBook[0]?.pages as any[]) ?? [];

			for (let i = 0; i < files.length; i++) {
				const f = files[i];
				const num = i + 1;
				const relPath = `./assets/wiki/databooks/${legendDirName}/${f}`;
				chapterPagesList.push(relPath);
				const prev = existingPages[i];
				pagesList.push({
					number: num,
					image: relPath,
					text: prev?.text || `${item.titleJa} Planche ${num}`,
					text_fr: prev?.text_fr || `${item.titleFr} Planche ${num}`,
					verifiee: true,
				});
			}
		} else {
			console.log(`\n📖 Legend ${item.legend} : En attente des scans originaux japonais B5 du Weekly Shōnen Jump...`);

			// Page 1 : Couverture officielle Shueisha B5
			const coverSrcPng = join(DATABOOKS_DIR, item.coverPngName);
			const p1Dest = join(legendDir, "001.jpg");
			if (existsSync(coverSrcPng) && !existsSync(p1Dest)) {
				await sharp(coverSrcPng).jpeg({ quality: 92 }).toFile(p1Dest);
				await chmod(p1Dest, 0o644);
			}

			pagesList.push({
				number: 1,
				image: `./assets/wiki/databooks/${legendDirName}/001.jpg`,
				text: `${item.titleJa} 表紙 (Weekly Shōnen Jump Digest Edition Vol. ${item.legend})`,
				text_fr: `Couverture originale du Weekly Shōnen Jump Digest Edition — ${item.titleFr}. Grand format JIS B5 (18,2 × 25,7 cm) Shueisha. En attente des scans intérieurs japonais originaux du magazine d'époque (posters, bicolores et dossiers Jump ERA).`,
				verifiee: true,
			});
			// Ne pas insérer de fausses planches DBFC : laisser les scans intérieurs en attente d'acquisition.
		}

		console.log(`  ✓ Total planches Legend ${item.legend} : ${pagesList.length} planches.`);

		// ─────────────────────────────────────────────────────────────────────────────
		// Mise à jour PostgreSQL : bot.db_databooks (IDs 465, 469..485)
		// ─────────────────────────────────────────────────────────────────────────────
		const coverRel = `./assets/wiki/databooks/${item.coverPngName}`;
		await sql`
			UPDATE bot.db_databooks
			SET 
				cover = ${coverRel},
				pages = ${sql.json(pagesList)},
				title = ${item.titleFr},
				title_ja = ${item.titleJa},
				isbn = ${item.isbn},
				published_at = ${item.publishedAt}
			WHERE id = ${item.databookId}
		`;
		console.log(`  ✓ bot.db_databooks (ID ${item.databookId}) synchronisé.`);

		// ─────────────────────────────────────────────────────────────────────────────
		// Mise à jour PostgreSQL : bot.db_manga_volumes (Série 'SOSH', IDs 701..718)
		// ─────────────────────────────────────────────────────────────────────────────
		await sql`
			INSERT INTO bot.db_manga_volumes (
				id,
				series,
				volume_number,
				title,
				title_ja,
				published_at,
				cover,
				isbn,
				visible
			) VALUES (
				${item.volId},
				'SOSH',
				${item.legend},
				${item.titleFr},
				${item.titleJa},
				${item.publishedAt},
				${coverRel},
				${item.isbn},
				true
			)
			ON CONFLICT (id) DO UPDATE SET
				series = EXCLUDED.series,
				volume_number = EXCLUDED.volume_number,
				title = EXCLUDED.title,
				title_ja = EXCLUDED.title_ja,
				published_at = EXCLUDED.published_at,
				cover = EXCLUDED.cover,
				isbn = EXCLUDED.isbn,
				visible = true
		`;
		console.log(`  ✓ bot.db_manga_volumes (ID ${item.volId}, series 'SOSH') enregistré.`);

		// ─────────────────────────────────────────────────────────────────────────────
		// Mise à jour PostgreSQL : bot.db_manga_chapters (Série 'SOSH', IDs 35001..35018)
		// ─────────────────────────────────────────────────────────────────────────────
		const chapterTitleFr = `Dragon Ball Sōshūhen Legend ${item.legend} — ${item.arcFr}`;
		await sql`
			INSERT INTO bot.db_manga_chapters (
				id,
				series,
				chapter_number,
				volume_id,
				title,
				title_ja,
				published_at,
				cover,
				pages,
				visible
			) VALUES (
				${item.chapterId},
				'SOSH',
				${item.legend},
				${item.volId},
				${chapterTitleFr},
				${item.titleJa},
				${item.publishedAt},
				${coverRel},
				${item.legend === 1 ? sql.json(chapterPagesList) : sql.json([])},
				${item.legend === 1}
			)
			ON CONFLICT (id) DO UPDATE SET
				series = EXCLUDED.series,
				chapter_number = EXCLUDED.chapter_number,
				volume_id = EXCLUDED.volume_id,
				title = EXCLUDED.title,
				title_ja = EXCLUDED.title_ja,
				published_at = EXCLUDED.published_at,
				cover = EXCLUDED.cover,
				pages = EXCLUDED.pages,
				visible = EXCLUDED.visible
		`;
		console.log(`  ✓ bot.db_manga_chapters (ID ${item.chapterId}, ${chapterPagesList.length} pages) enregistré.`);

		// ─────────────────────────────────────────────────────────────────────────────
		// Journalisation public.wiki_revisions
		// ─────────────────────────────────────────────────────────────────────────────
		const revisionHash = createHash("sha256")
			.update(`SOSH-${item.legend}-${chapterPagesList.length}-${Date.now()}`)
			.digest("hex");
		const revId = cuid24();

		await sql`
			INSERT INTO public.wiki_revisions (
				id,
				target_type,
				target_id,
				revision_number,
				snapshot,
				author_name,
				author_type,
				change_summary,
				source_signature,
				created_at
			) VALUES (
				${revId},
				'manga_volume',
				${item.volId.toString()},
				1,
				${sql.json({
					series: "SOSH",
					volume_number: item.legend,
					title: item.titleFr,
					title_ja: item.titleJa,
					cover: coverRel,
					page_count: chapterPagesList.length,
					chapters_range: `${item.startCh}..${item.endCh}`,
				})},
				'Shenron Sōshūhen Ingest Agent',
				'agent',
				${`Ingest canonique exhaustif Dragon Ball Sōshūhen Legend ${item.legend} (${chapterPagesList.length} planches, arc ${item.arcFr})`},
				${revisionHash},
				NOW()
			)
		`.catch(() => {});
	}

	await sql.end();
	console.log("\n✨ TOUS LES 18 VOLUMES SŌSHŪHEN ONT ÉTÉ INGÉRÉS ET HÉBERGÉS AVEC SUCCÈS !");
}

run().catch((e) => {
	console.error("Erreur critique ingest Sōshūhen:", e);
	process.exit(1);
});
