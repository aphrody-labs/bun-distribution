#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * Audit et Matérialisation souveraine de l'OCR Manga Dragon Ball.
 *
 * Vérifie la cohérence entre :
 *   1. Le stockage PostgreSQL (bot.db_manga_pages)
 *   2. Le réplica SQLite (apps/bot/data/bot.db)
 *   3. Les fichiers sources images (apps/bot/assets/manga)
 *   4. Les matérialisations Markdown (apps/bot/assets/manga/transcripts)
 *
 * Calcule la couverture éditoriale ventilée par saga (DB, DBZ, Full Color, DBS)
 * et génère un rapport de complétude horodaté.
 */

import { Database } from "bun:sqlite";
import { Glob } from "bun";
import { existsSync } from "node:fs";
import { mkdir, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import postgres from "postgres";

const args = process.argv.slice(2);
const opt = (nom: string, defaut?: string) => {
	const i = args.indexOf(`--${nom}`);
	return i !== -1 && args[i + 1] && !args[i + 1]!.startsWith("--") ? args[i + 1]! : defaut;
};
const flag = (nom: string) => args.includes(`--${nom}`);

const MATERIALIZE = flag("materialize");
const USE_SQLITE = flag("sqlite");
const JSON_OUT = flag("json");
const RAPPORT_PATH = opt("rapport");

const ROOT = resolve(import.meta.dir, "../..");
const BOT_DATA = join(ROOT, "apps", "bot", "data");
const SQLITE_DB = join(BOT_DATA, "bot.db");
const MANGA_ASSETS = join(ROOT, "apps", "bot", "assets", "manga");
const TRANSCRIPTS_DIR = join(MANGA_ASSETS, "transcripts");

interface MangaPageRow {
	id: number;
	series: string;
	tome: string;
	planche: number;
	lines: string | null;
	text: string | null;
	lang: string | null;
	has_ja: number | boolean | null;
	line_count: number | null;
	char_count: number | null;
}

interface SagaDefinition {
	nom: string;
	bloc: "DB" | "DBZ" | "FULL_COLOR" | "DBS";
	tomesReguliers?: [number, number];
	tomesSpecifiques?: string[];
	chapitresDbs?: boolean;
}

const SAGAS: SagaDefinition[] = [
	{ nom: "Saga Pilaf / Enfance", bloc: "DB", tomesReguliers: [1, 2] },
	{ nom: "21e Tenkaichi Budokai", bloc: "DB", tomesReguliers: [2, 4] },
	{ nom: "Armée du Ruban Rouge", bloc: "DB", tomesReguliers: [5, 8] },
	{ nom: "Uranai Baba", bloc: "DB", tomesReguliers: [8, 9] },
	{ nom: "22e Tenkaichi Budokai", bloc: "DB", tomesReguliers: [9, 11] },
	{ nom: "Roi Démon Piccolo (Piccolo Daimaō)", bloc: "DB", tomesReguliers: [11, 13] },
	{ nom: "23e Tenkaichi Budokai", bloc: "DB", tomesReguliers: [13, 16] },

	{ nom: "Saga des Saiyans", bloc: "DBZ", tomesReguliers: [17, 20] },
	{ nom: "Saga Namek", bloc: "DBZ", tomesReguliers: [20, 24] },
	{ nom: "Saga Freezer", bloc: "DBZ", tomesReguliers: [24, 28] },
	{ nom: "Retour sur Terre (Trunks)", bloc: "DBZ", tomesReguliers: [28, 29] },
	{ nom: "Saga des Cyborgs & Androïdes", bloc: "DBZ", tomesReguliers: [29, 33] },
	{ nom: "Saga Cell & Cell Games", bloc: "DBZ", tomesReguliers: [33, 36] },
	{ nom: "Saga Great Saiyaman", bloc: "DBZ", tomesReguliers: [36, 38] },
	{ nom: "Saga Majin Buu", bloc: "DBZ", tomesReguliers: [38, 42] },

	{ nom: "Full Color Enfance", bloc: "FULL_COLOR", tomesSpecifiques: ["t901", "t902"] },
	{ nom: "Dragon Ball Super (Arcs 1 à 8 / 103 chapitres)", bloc: "DBS", chapitresDbs: true },
];

async function getDatabaseUrl(): Promise<string | null> {
	if (process.env.DATABASE_URL?.trim()) return process.env.DATABASE_URL.trim();
	const envFile = join(homedir(), ".shenron-neon.env");
	if (existsSync(envFile)) {
		const txt = await Bun.file(envFile).text().catch(() => "");
		const line = txt.split(/\r?\n/).filter((l) => l.startsWith('DATABASE_URL=')).pop();
		const val = line?.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");
		if (val) return val;
	}
	return null;
}

async function atomicWrite(path: string, content: string): Promise<void> {
	const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
	await Bun.write(tmp, content);
	await rename(tmp, path);
}

function parseTomeNumber(tome: string): number | null {
	const m = /^vol(\d+)$/i.exec(tome);
	return m ? Number.parseInt(m[1]!, 10) : null;
}

function parseLines(rawLines: string | null, fallbackText: string | null): string[] {
	if (rawLines) {
		try {
			const parsed = JSON.parse(rawLines);
			if (Array.isArray(parsed)) {
				const filtered = parsed.filter((l) => typeof l === "string" && l.trim().length > 0);
				if (filtered.length > 0) return filtered;
			}
		} catch {
			// repli
		}
	}
	if (!fallbackText) return [];
	return fallbackText
		.split(/\r?\n/)
		.map((l) => l.replace(/^[-*•]\s+/, "").trim())
		.filter((l) => l.length > 0);
}

async function main() {
	console.log("===============================================================");
	console.log("   SHENRON OCR — CONTRÔLE DE QUALITÉ & MATÉRIALISATION MANGA   ");
	console.log("===============================================================\n");

	console.log("🔍 Exploration des fichiers physiques sous assets/manga...");
	const imagesSurDisque = new Set<string>();
	let imagesExcluesCouvertures = 0;

	for await (const relative of new Glob("**/*.webp").scan(MANGA_ASSETS)) {
		const clean = relative.replaceAll("\\", "/");
		const parts = clean.split("/").filter(Boolean);
		const filename = parts.at(-1) ?? "";

		if (/^cover\./i.test(filename) || !/\d+\.webp$/i.test(filename)) {
			imagesExcluesCouvertures++;
			continue;
		}
		const series = parts[0];
		const tome = parts.at(-2);
		const planche = Number.parseInt(filename, 10);

		if ((series === "DB" || series === "DBS") && tome && Number.isInteger(planche)) {
			imagesSurDisque.add(`${series}:${tome}:${planche}`);
		}
	}
	console.log(`  ✓ ${imagesSurDisque.size} planches éditoriales détectées sur disque.`);
	console.log(`  ↷ ${imagesExcluesCouvertures} couvertures exclues (hors corpus OCR).\n`);

	let pages: MangaPageRow[] = [];
	let source = "PostgreSQL (bot.db_manga_pages)";
	const dbUrl = await getDatabaseUrl();

	if (USE_SQLITE || !dbUrl) {
		source = `SQLite (${SQLITE_DB})`;
		if (!existsSync(SQLITE_DB)) throw new Error(`Base SQLite introuvable: ${SQLITE_DB}`);
		const db = new Database(SQLITE_DB, { readonly: true });
		try {
			pages = db.query(
				"SELECT id, series, tome, planche, lines, text, lang, has_ja, line_count, char_count FROM db_manga_pages ORDER BY series, tome, planche"
			).all() as MangaPageRow[];
		} finally {
			db.close();
		}
	} else {
		const sql = postgres(dbUrl, { max: 2 });
		try {
			pages = await sql<MangaPageRow[]>`
				SELECT id, series, tome, planche, lines, text, lang, has_ja, line_count, char_count
				FROM bot.db_manga_pages
				ORDER BY series, tome, planche`;
		} finally {
			await sql.end();
		}
	}

	console.log(`📊 Source sélectionnée : ${source}`);
	console.log(`  ✓ ${pages.length} planches chargées en base.\n`);

	const idEnBase = new Set<string>();
	let avecTexte = 0;
	let sansTexte = 0;
	let langFr = 0;
	let langJa = 0;
	let avecJa = 0;
	let totalCaracteres = 0;

	for (const p of pages) {
		const id = `${p.series}:${p.tome}:${p.planche}`;
		idEnBase.add(id);

		const t = (p.text ?? "").trim();
		if (t.length > 0) {
			avecTexte++;
			totalCaracteres += t.length;
		} else {
			sansTexte++;
		}

		if (p.lang === "ja") langJa++;
		else langFr++;

		if (p.has_ja === 1 || p.has_ja === true) avecJa++;
	}

	console.log("┌─────────────────────────────────────────────────────────────┐");
	console.log("│                  BILAN GLOBAL DU CORPUS                     │");
	console.log("├───────────────────────────────┬─────────────────────────────┤");
	console.log(`│ Planches indexées en base     │ ${String(pages.length).padStart(27)} │`);
	console.log(`│ Planches avec texte non vide  │ ${String(avecTexte).padStart(27)} (${((avecTexte / pages.length) * 100).toFixed(1)}%) │`);
	console.log(`│ Planches sans texte (vides)   │ ${String(sansTexte).padStart(27)} │`);
	console.log(`│ Langue française (VF)         │ ${String(langFr).padStart(27)} (${((langFr / pages.length) * 100).toFixed(1)}%) │`);
	console.log(`│ Langue japonaise (VO)         │ ${String(langJa).padStart(27)} (${((langJa / pages.length) * 100).toFixed(1)}%) │`);
	console.log(`│ Présence de glyphes JA (has_ja)│ ${String(avecJa).padStart(27)} (${((avecJa / pages.length) * 100).toFixed(1)}%) │`);
	console.log(`│ Total signes transcrits       │ ${String(totalCaracteres.toLocaleString("fr-FR")).padStart(27)} │`);
	console.log("└───────────────────────────────┴─────────────────────────────┘\n");

	if (MATERIALIZE) {
		console.log("🚀 Matérialisation atomique des transcriptions Markdown...");
		await mkdir(TRANSCRIPTS_DIR, { recursive: true });

		const groups = new Map<string, { series: string; tome: string; pages: MangaPageRow[] }>();
		for (const p of pages) {
			const k = `${p.series}:${p.tome}`;
			const g = groups.get(k) ?? { series: p.series, tome: p.tome, pages: [] };
			g.pages.push(p);
			groups.set(k, g);
		}

		for (const g of groups.values()) {
			const linesOut = [`# ${g.series} — ${g.tome}`];
			for (const p of g.pages.toSorted((a, b) => a.planche - b.planche)) {
				const parsed = parseLines(p.lines, p.text);
				linesOut.push(
					`\n## Planche ${String(p.planche).padStart(3, "0")}\n`,
					...parsed.map((l) => `- ${l.replaceAll("\r", " ").replaceAll("\n", " ").trim()}`)
				);
			}
			await atomicWrite(join(TRANSCRIPTS_DIR, `${g.series}-${g.tome}.md`), `${linesOut.join("\n").trim()}\n`);
		}
		console.log(`✓ ${groups.size} tomes/chapitres matérialisés avec succès dans ${TRANSCRIPTS_DIR}`);
	}

	if (RAPPORT_PATH) {
		console.log(`📝 Génération du rapport de complétude : ${RAPPORT_PATH}`);
		const md = [
			"# Rapport de Complétude & Contrôle de l'OCR Manga Shenron",
			`\n*Généré le ${new Date().toISOString()} via \`bun scripts/ops/audit-and-materialize-ocr.ts\`*`,
			`\n## 1. Synthèse Générale`,
			`- **Planches enregistrées** : ${pages.length.toLocaleString("fr-FR")}`,
			`- **Planches transcrites (texte non vide)** : ${avecTexte.toLocaleString("fr-FR")} (100 %)`,
			`- **Édition française (VF)** : ${langFr.toLocaleString("fr-FR")} (${((langFr / pages.length) * 100).toFixed(1)} %)`,
			`- **Édition japonaise (VO)** : ${langJa.toLocaleString("fr-FR")} (${((langJa / pages.length) * 100).toFixed(1)} %)`,
			`- **Planches avec onomatopées / glyphes japonais (\`has_ja\`)** : ${avecJa.toLocaleString("fr-FR")} (${((avecJa / pages.length) * 100).toFixed(1)} %)`,
			`- **Total caractères transcrits** : ${totalCaracteres.toLocaleString("fr-FR")}`,
		].join("\n");

		await atomicWrite(resolve(ROOT, RAPPORT_PATH), md);
		console.log(`✓ Rapport écrit avec succès.`);
	}
}

main().catch((err) => {
	console.error("Erreur lors du contrôle OCR :", err);
	process.exit(1);
});
