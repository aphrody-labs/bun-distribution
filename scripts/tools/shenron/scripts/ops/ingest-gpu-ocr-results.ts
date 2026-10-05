// SPDX-License-Identifier: Apache-2.0
/**
 * Ingestion et validation des résultats OCR GPU dans la base de données centrale.
 *
 * Utilisation :
 *   bun scripts/ops/ingest-gpu-ocr-results.ts --fichier chemin/vers/resultats.jsonl [--appliquer] [--forcer]
 *   bun scripts/ops/ingest-gpu-ocr-results.ts --dossier data/databooks-ocr/lots/resultats [--appliquer]
 */

import { existsSync, readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import {
	arretSiGel,
	connecte,
	ecrirePlanche,
	texteDePlanche,
	type PlancheBrute,
} from "../../../../../apps/shenron/site/scripts/_databooks-base";
import { classerDefaut } from "../../../../../apps/shenron/site/src/lib/databooks-defauts";

// Gel des écrivains : sortie 3 avant toute connexion si .coord/FREEZE-databooks.json existe.
arretSiGel("ingest-gpu-ocr-results");

const args = process.argv.slice(2);
const opt = (nom: string, defaut?: string) => {
	const i = args.indexOf(`--${nom}`);
	return i !== -1 && args[i + 1] ? args[i + 1]! : defaut;
};
const flag = (nom: string) => args.includes(`--${nom}`);

const FICHIER = opt("fichier");
const DOSSIER = opt("dossier");
const APPLIQUER = flag("appliquer");
const FORCER = flag("forcer");
/** Remplacer une transcription déjà présente (par défaut : planches vides seulement). */
const ECRASER = flag("ecraser");

interface ResultatLigne {
	image?: string;
	id?: string;
	databookId?: number;
	pageNumber?: number;
	text?: string | { kind?: string; markdown?: string };
}

async function main() {
	console.log("=== Ingestion des Résultats OCR GPU (Validation Double Juge) ===");

	const fichiersATraiter: string[] = [];
	if (FICHIER && existsSync(FICHIER)) {
		fichiersATraiter.push(FICHIER);
	} else if (DOSSIER && existsSync(DOSSIER)) {
		const files = await readdir(DOSSIER);
		for (const f of files) {
			if (f.endsWith(".jsonl") || f.endsWith(".json")) {
				fichiersATraiter.push(join(DOSSIER, f));
			}
		}
	} else {
		console.log("Usage : bun scripts/ops/ingest-gpu-ocr-results.ts --fichier <path> [--appliquer]");
		console.log("        bun scripts/ops/ingest-gpu-ocr-results.ts --dossier <path> [--appliquer]");
		return;
	}

	console.log(`Fichiers trouvés à ingérer : ${fichiersATraiter.length}`);

	const sql = await connecte();
	try {
		let totalPlanches = 0;
		let valides = 0;
		let defautsCount = 0;

		const updatesParLivre = new Map<number, Map<number, string>>();

		for (const chemin of fichiersATraiter) {
			const contenu = readFileSync(chemin, "utf-8");
			const lignes = contenu.split("\n").filter((l) => l.trim().length > 0);

			for (const ligne of lignes) {
				totalPlanches++;
				let obj: ResultatLigne;
				try {
					obj = JSON.parse(ligne);
				} catch  {
					console.warn(`Ligne JSON invalide ignorée dans ${basename(chemin)}`);
					continue;
				}

				// Extraire le texte markdown
				let texte = "";
				if (typeof obj.text === "string") {
					texte = obj.text;
				} else if (obj.text && typeof obj.text === "object" && obj.text.markdown) {
					texte = obj.text.markdown;
				}

				// Extraire identifiants du livre et de la page
				let databookId = obj.databookId;
				let pageNumber = obj.pageNumber;

				if ((!databookId || !pageNumber) && obj.image) {
					// Format standard 323-0007.jpg
					const m = /(\d+)-(\d+)/.exec(obj.image);
					if (m) {
						databookId = Number(m[1]);
						pageNumber = Number(m[2]);
					}
				}

				if (!databookId || !pageNumber) {
					console.warn(`Identifiants manquants pour la ligne : ${ligne.slice(0, 80)}...`);
					continue;
				}

				// Évaluation par le juge de défauts
				const defaut = classerDefaut(texte);
				if (defaut && !FORCER) {
					defautsCount++;
					console.log(`  [DÉFAUT ${defaut}] Livre #${databookId} Planche #${pageNumber}`);
					continue;
				}

				valides++;
				let pagesMap = updatesParLivre.get(databookId);
				if (!pagesMap) {
					pagesMap = new Map();
					updatesParLivre.set(databookId, pagesMap);
				}
				pagesMap.set(pageNumber, texte);
			}
		}

		console.log(`\nBilan de l'audit OCR :`);
		console.log(`  - Total planches lues : ${totalPlanches}`);
		console.log(`  - Planches valides (sans défaut) : ${valides}`);
		console.log(`  - Planches refusées par le juge : ${defautsCount}`);

		if (!APPLIQUER) {
			console.log(`\nMode SIMULATION (--appliquer requis pour sauvegarder en PostgreSQL).`);
			return;
		}

		console.log(`\nApplication des mises à jour dans PostgreSQL (écriture atomique par planche)...`);
		let totalAppliquees = 0;
		let conflits = 0;

		for (const [databookId, pagesMap] of updatesParLivre.entries()) {
			// Lecture de l'état courant : sert de garde optimiste, jamais de base
			// à une réécriture du tableau entier.
			const [book] = await sql<{ pages: PlancheBrute[] | null }[]>`
				SELECT pages FROM bot.db_databooks WHERE id = ${databookId}
			`;
			const pages = book?.pages ?? [];

			for (const [numero, nouveauTexte] of pagesMap) {
				const planches = pages.filter((p) => Number(p.number) === numero);
				if (planches.length !== 1) {
					console.log(`  [IGNORÉE] Livre #${databookId} Planche #${numero} : absente ou numéro ambigu`);
					continue;
				}
				const actuel = texteDePlanche(planches[0]).trim();
				// Une transcription existante n'est remplacée que sur demande explicite.
				if (actuel && !ECRASER) {
					console.log(`  [IGNORÉE] Livre #${databookId} Planche #${numero} : déjà transcrite (--ecraser pour remplacer)`);
					continue;
				}
				const res = await ecrirePlanche(
					sql,
					{ databookId, numero },
					{ poser: { text: nouveauTexte, verifiee: true, updated_at: new Date().toISOString() } },
					{ texte: actuel, image: planches[0]!.image ?? null }
				);
				if (res.applique) totalAppliquees++;
				else {
					conflits++;
					console.log(`  [CONFLIT] Livre #${databookId} Planche #${numero} : ${res.motif}`);
				}
			}
		}

		console.log(`✓ ${totalAppliquees} planches mises à jour, ${conflits} conflits.`);
	} finally {
		await sql.end();
	}
}

main().catch((err) => {
	console.error("Erreur lors de l'ingestion des résultats :", err);
	process.exit(1);
});
