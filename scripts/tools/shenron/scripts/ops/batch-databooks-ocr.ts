// SPDX-License-Identifier: Apache-2.0
/**
 * Partitionne les planches de databooks sans transcription japonaise
 * en lots JSONL normalisés prêts pour inférence GPU locale (PP-OCRv5 / Qwen2.5-VL / Aphrody).
 *
 * Utilisation :
 *   bun scripts/ops/batch-databooks-ocr.ts --statut
 *   bun scripts/ops/batch-databooks-ocr.ts --exporter --taille 100 --sortie data/databooks-ocr/lots
 *   bun scripts/ops/batch-databooks-ocr.ts --databook 4 --exporter
 */

import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import {
	cheminPlanche,
	chargeOuvrages,
	connecte,
	texteDePlanche,
} from "../../../../../apps/shenron/site/scripts/_databooks-base";

const args = process.argv.slice(2);
const opt = (nom: string, defaut?: string) => {
	const i = args.indexOf(`--${nom}`);
	return i !== -1 && args[i + 1] ? args[i + 1]! : defaut;
};
const flag = (nom: string) => args.includes(`--${nom}`);

const STATUT = flag("statut");
const EXPORTER = flag("exporter");
const TAILLE_LOT = Number(opt("taille", "100"));
const SORTIE = opt("sortie", join(process.cwd(), "data", "databooks-ocr", "lots"));
const DATABOOK_ID = opt("databook") ? Number(opt("databook")) : null;

interface PlancheOcrManquante {
	databookId: number;
	titre: string;
	pageNumber: number;
	imagePath: string | null;
	imageOnDisk: boolean;
	imageDiskPath: string | null;
}

async function main() {
	console.log("=== Préparation des Lots Databooks OCR pour GPU Local ===");

	const sql = await connecte();
	let ouvrages;
	try {
		ouvrages = await chargeOuvrages(sql, {
			ids: DATABOOK_ID ? [DATABOOK_ID] : undefined,
		});
	} finally {
		await sql.end();
	}

	const planchesManquantes: PlancheOcrManquante[] = [];
	let totalPlanches = 0;
	let totalAvecTexte = 0;

	for (const o of ouvrages) {
		for (let i = 0; i < o.pages.length; i++) {
			totalPlanches++;
			const p = o.pages[i]!;
			const texte = texteDePlanche(p).trim();

			if (texte.length > 0) {
				totalAvecTexte++;
				continue;
			}

			const diskPath = cheminPlanche(p.image);
			const onDisk = diskPath !== null && existsSync(diskPath);

			planchesManquantes.push({
				databookId: o.id,
				titre: o.title ?? `Databook #${o.id}`,
				pageNumber: Number(p.number) || i + 1,
				imagePath: p.image ?? null,
				imageOnDisk: onDisk,
				imageDiskPath: diskPath,
			});
		}
	}

	console.log(`Total planches analysées : ${totalPlanches}`);
	console.log(`Planches avec texte JA : ${totalAvecTexte} (${((totalAvecTexte / totalPlanches) * 100).toFixed(1)}%)`);
	console.log(`Planches SANS texte JA (à transcrire) : ${planchesManquantes.length}`);

	const presentesDisque = planchesManquantes.filter((p) => p.imageOnDisk).length;
	console.log(`  - Images présentes sur disque local : ${presentesDisque}`);
	console.log(`  - Images distantes / à télécharger : ${planchesManquantes.length - presentesDisque}`);

	if (STATUT && !EXPORTER) {
		return;
	}

	if (EXPORTER) {
		if (planchesManquantes.length === 0) {
			console.log("Aucune planche manquante à exporter !");
			return;
		}

		await mkdir(SORTIE, { recursive: true });

		const nbLots = Math.ceil(planchesManquantes.length / TAILLE_LOT);
		console.log(`\nExport de ${planchesManquantes.length} planches en ${nbLots} lots de max ${TAILLE_LOT} planches...`);

		const manifestsSummary = [];

		for (let lotIndex = 0; lotIndex < nbLots; lotIndex++) {
			const start = lotIndex * TAILLE_LOT;
			const end = Math.min(start + TAILLE_LOT, planchesManquantes.length);
			const lotItems = planchesManquantes.slice(start, end);

			const lotId = `databooks-lot-${String(lotIndex + 1).padStart(3, "0")}`;
			const lotFile = join(SORTIE, `${lotId}.jsonl`);

			// Format JSONL pour worker GPU (PP-OCRv5 / VLM)
			const jsonlLines = lotItems.map((item) =>
				JSON.stringify({
					id: `db-${item.databookId}-p${item.pageNumber}`,
					databookId: item.databookId,
					titre: item.titre,
					pageNumber: item.pageNumber,
					image: item.imagePath,
					imagePath: item.imageDiskPath,
					onDisk: item.imageOnDisk,
					// Attendu en retour du modèle de vision
					expectedFormat: {
						image: basename(item.imagePath ?? `p${item.pageNumber}.jpg`),
						text: {
							kind: "text",
							markdown: "# TITRE\\n\\nTexte transcrit case par case...",
						},
					},
				})
			);

			await Bun.write(lotFile, jsonlLines.join("\n") + "\n");
			console.log(`  ✓ ${lotId} : ${lotItems.length} planches -> ${lotFile}`);

			manifestsSummary.push({
				lotId,
				file: `data/databooks-ocr/lots/${basename(lotFile)}`,
				count: lotItems.length,
				firstBook: lotItems[0]!.titre,
				lastBook: lotItems[lotItems.length - 1]!.titre,
			});
		}

		// Écrire un index récapitulatif
		const indexPath = join(SORTIE, "index-manifest.json");
		await Bun.write(indexPath, JSON.stringify(manifestsSummary, null, 2));
		console.log(`\nIndex des lots écrit dans : ${indexPath}`);
	}
}

main().catch((err) => {
	console.error("Erreur lors de la préparation des lots OCR :", err);
	process.exit(1);
});
