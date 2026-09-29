/**
 * crawl-guides.ts — Crawl de guides et traductions de référence de Dragon Ball (Kanzenshuu) via bxc.
 *
 * Utilise la CLI bxc local pour récupérer les pages sous forme de Markdown propre,
 * extrait le contenu utile en enlevant le header, la navigation et le footer,
 * et enregistre les fichiers Markdown nettoyés dans data/rag/raw/guides/.
 *
 * Usage : bun apps/shenron/bot/scripts/crawl-guides.ts
 */

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { bxcCommand } from "@shenron/pipeline/bxc/cli";

const OUT_DIR = new URL("../data/rag/raw/guides/", import.meta.url).pathname;

// Liste des sources de référence à récupérer
const SOURCES = [
	{
		url: "https://www.kanzenshuu.com/translations/seg-character-volume-truth-about-dragon-ball/",
		slug: "seg-character-volume",
		title: "SEG: Character Volume - Truth About Dragon Ball",
	},
	{
		url: "https://www.kanzenshuu.com/translations/seg-story-volume-truth-about-dragon-ball/",
		slug: "seg-story-volume",
		title: "SEG: Story Volume - Truth About Dragon Ball",
	},
	{
		url: "https://www.kanzenshuu.com/translations/daizenshuu-1-shenlong-times/",
		slug: "daizenshuu-1-shenlong-times",
		title: "Daizenshuu 1 - Shenlong Times Interview",
	},
	{
		url: "https://www.kanzenshuu.com/translations/akira-toriyama-tankobon-introductions/",
		slug: "akira-toriyama-tankobon-introductions",
		title: "Akira Toriyama Tankōbon Introductions",
	},
	{
		url: "https://www.kanzenshuu.com/translations/dragon-ball-forever-dragon-ball-toriyama/",
		slug: "dragon-ball-forever-toriyama",
		title: "Dragon Ball Forever - Toriyama Interview",
	},
];

// S'assurer que le dossier de sortie existe
if (!existsSync(OUT_DIR)) {
	mkdirSync(OUT_DIR, { recursive: true });
}

async function runBxcScrape(url: string): Promise<string> {
	console.log(`[CRAWL GUIDE] Ingestion via bxc scrape de : ${url}`);
	const proc = Bun.spawn(
		[...(await bxcCommand()), "scrape", url, "--markdown", "--profile", "static"],
		{
			stdout: "pipe",
			stderr: "ignore",
		}
	);

	const rawText = await new Response(proc.stdout).text();
	const exitCode = await proc.exited;
	return exitCode === 0 ? rawText : "";
}

function cleanMarkdown(rawMarkdown: string, title: string, url: string): string {
	const lines = rawMarkdown.split("\n");

	// 1. Trouver le début du contenu réel
	let startIdx = 0;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trim();
		// Le contenu commence généralement après les liens d'archive ou la mention du titre du guide
		if (line.includes("Translations Archive") && i > 15) {
			startIdx = i;
			break;
		}
	}

	// Si non trouvé, on cherche d'autres indices
	if (startIdx === 0) {
		for (let i = 0; i < lines.length; i++) {
			if (lines[i].includes("----------") && i > 15) {
				startIdx = i - 1;
				break;
			}
		}
	}

	// 2. Trouver la fin du contenu réel
	let endIdx = lines.length;
	for (let i = startIdx; i < lines.length; i++) {
		const line = lines[i].trim();
		if (
			line.includes("Connect With Us") ||
			line.includes("[« Previous Page]") ||
			line.includes("Disclaimer") ||
			line.includes("© 2026 Kanzenshuu")
		) {
			endIdx = i;
			break;
		}
	}

	// 3. Extraire le contenu utile et ajouter des métadonnées
	const cleanLines = lines.slice(startIdx, endIdx);
	let content = cleanLines.join("\n").trim();

	// Ajouter l'en-tête de métadonnées de notre RAG
	const header = `---
title: "${title}"
source: "Kanzenshuu Guide Translations"
url: "${url}"
license_key: "fan-translation-fairuse"
lang: "en"
---

# ${title}

`;

	return header + content;
}

async function main() {
	console.log(`=== DÉBUT DU CRAWL DES GUIDES DE RÉFÉRENCE DRAGON BALL ===`);

	for (const src of SOURCES) {
		const finalPath = join(OUT_DIR, `${src.slug}.md`);

		const rawText = await runBxcScrape(src.url);
		if (!rawText) {
			console.error(`✗ Échec de la récupération pour ${src.slug}`);
			continue;
		}

		// Nettoyer le markdown
		const cleanedText = cleanMarkdown(rawText, src.title, src.url);

		// Écrire le fichier final
		await Bun.write(finalPath, cleanedText);
		console.log(`✓ Guide sauvegardé et nettoyé : ${finalPath} (${cleanedText.length} caractères)`);
	}

	console.log(`=== CRAWL DES GUIDES TERMINÉ ===`);
}

main().catch(console.error);
