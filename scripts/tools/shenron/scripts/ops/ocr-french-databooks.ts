// SPDX-License-Identifier: Apache-2.0
/**
 * OCR haute performance pour les ouvrages, fascicules et magazines français
 * (Dragon Ball Le Manga de Légende, CD Consoles, Joypad, Top Consoles, Anime Comics FR).
 *
 * Exécute l'OCR sur Aphrody AI et dépose la lecture dans
 * le champ `text` de la planche — **jamais dans `text_fr`**.
 *
 * Pourquoi : le lecteur du wiki (`/wiki/databooks/[id]`, `DatabookReader`) affiche
 * `text`, quelle que soit la langue de l'ouvrage ; `text_fr` est la TRADUCTION
 * d'une source japonaise. L'ancienne version sélectionnait les planches sans
 * `text_fr` et y copiait l'OCR : relevé le 2026-09-14, 143 planches sur 149
 * signées `tesseract-5-fra` portaient un `text_fr` identique à leur `text` —
 * une « traduction » qui n'en est pas une, comptée comme traduite partout.
 *
 * Écriture : `deposerTranscription` (`_databooks-base.ts`) — une instruction SQL
 * par planche, uniquement si `text` est encore vide et l'image inchangée ; une
 * lecture bruitée (`bruitOcr`) est journalisée et sautée.
 *
 * Utilisation :
 *   bun scripts/ops/ocr-french-databooks.ts --statut
 *   bun scripts/ops/ocr-french-databooks.ts --book 386 --appliquer
 *   bun scripts/ops/ocr-french-databooks.ts --tout --appliquer
 */

import { existsSync } from "node:fs";
import type postgres from "postgres";
import { recogniseRemotePage } from "@shenron/pipeline/aphrody/remote-ocr";
import {
	arretSiGel,
	chargeOuvrages,
	cheminPlanche,
	connecte,
	deposerTranscription,
	texteDePlanche,
	traductionDePlanche,
} from "../../../../../apps/shenron/site/scripts/_databooks-base";

// Gel des écrivains : sortie 3 avant toute connexion si .coord/FREEZE-databooks.json existe.
if (import.meta.main) arretSiGel("ocr-french-databooks");

const args = process.argv.slice(2);
const opt = (nom: string, defaut?: string) => {
	const i = args.indexOf(`--${nom}`);
	return i !== -1 && args[i + 1] ? args[i + 1]! : defaut;
};
const flag = (nom: string) => args.includes(`--${nom}`);

const STATUT = flag("statut");
const APPLIQUER = flag("appliquer");
const TOUT = flag("tout");
const BOOK_ID = opt("book") ? Number(opt("book")) : null;
const LIMITE = opt("limite") ? Number(opt("limite")) : TOUT ? Infinity : 50;

const revisionId = () =>
	Array.from({ length: 24 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]!).join("");

// IDs des ouvrages connus comme étant en français
const FRENCH_BOOKS_START = 386;
const FRENCH_BOOKS_END = 456;

interface PlancheFrenchOcr {
	databookId: number;
	bookTitle: string;
	pageNumber: number;
	image: string | null;
	diskPath: string;
}

export async function ocrFrenchPage(imagePath: string): Promise<string> {
	const image = new Uint8Array(await Bun.file(imagePath).arrayBuffer());
	const result = await recogniseRemotePage(image);
	if (result.suspect) throw new Error(`Aphrody marked OCR for ${imagePath} as requiring review`);
	return result.text.trim();
}

async function main() {
	console.log("==========================================================");
	console.log("   SHENRON FRENCH DATABOOKS OCR WORKER (APHRODY AI)  ");
	console.log("==========================================================\n");

	const sql = await connecte();
	try {
		const ouvrages = await chargeOuvrages(sql);
		const frenchOuvrages = ouvrages.filter((o) => {
			if (BOOK_ID) return o.id === BOOK_ID;
			return o.id >= FRENCH_BOOKS_START && o.id <= FRENCH_BOOKS_END;
		});

		console.log(`Ouvrages français ciblés : ${frenchOuvrages.length}`);

		const taches: PlancheFrenchOcr[] = [];
		let totalPlanches = 0;
		let dejaTranscrites = 0;
		let copiesTextFr = 0;
		let imageManquante = 0;

		for (const o of frenchOuvrages) {
			for (const p of o.pages) {
				totalPlanches++;
				const texte = texteDePlanche(p).trim();
				// À réparer (hors de ce script) : un `text_fr` sur un ouvrage français
				// n'est jamais une traduction.
				if (traductionDePlanche(p).trim()) copiesTextFr++;
				if (texte.length > 0) {
					dejaTranscrites++;
					continue;
				}
				const numero = Number(p.number);
				if (!Number.isInteger(numero)) continue;

				const disk = cheminPlanche(p.image);
				if (!disk || !existsSync(disk)) {
					imageManquante++;
					continue;
				}

				if (taches.length < LIMITE) {
					taches.push({
						databookId: o.id,
						bookTitle: o.title ?? `Ouvrage #${o.id}`,
						pageNumber: numero,
						image: p.image ?? null,
						diskPath: disk,
					});
				}
			}
		}

		console.log(`- Total planches : ${totalPlanches}`);
		console.log(`- Déjà transcrites (text) : ${dejaTranscrites}`);
		console.log(`- Planches portant un text_fr (anomalie sur un ouvrage français) : ${copiesTextFr}`);
		console.log(`- Images manquantes sur disque : ${imageManquante}`);
		console.log(`- Planches prêtes pour OCR FR : ${taches.length}\n`);

		if (STATUT || taches.length === 0) return;

		console.log(`Démarrage de l'OCR français sur ${taches.length} planches...`);
		const parLivre = new Map<number, { titre: string; lectures: Array<{ tache: PlancheFrenchOcr; texte: string }> }>();
		let lues = 0;
		const debut = Date.now();

		for (const t of taches) {
			const texteExtrait = await ocrFrenchPage(t.diskPath);
			if (!texteExtrait || texteExtrait.length < 5) {
				console.log(`  [OCR VIDE] ${t.bookTitle} p.${t.pageNumber}`);
				continue;
			}
			lues++;
			const entree = parLivre.get(t.databookId) ?? { titre: t.bookTitle, lectures: [] };
			entree.lectures.push({ tache: t, texte: texteExtrait });
			parLivre.set(t.databookId, entree);
			console.log(`  ✓ [${lues}/${taches.length}] ${t.bookTitle} p.${t.pageNumber} (${texteExtrait.length} car)`);

			if (APPLIQUER && entree.lectures.length >= 20) {
				await deposer(sql, t.databookId, entree.titre, entree.lectures);
				entree.lectures = [];
			}
		}

		if (APPLIQUER) {
			for (const [id, { titre, lectures }] of parLivre) {
				if (lectures.length) await deposer(sql, id, titre, lectures);
			}
		} else {
			console.log("\n(simulation — relancer avec --appliquer)");
		}

		const duree = ((Date.now() - debut) / 1000).toFixed(1);
		console.log(`\nBilan OCR Français : ${lues} planches lues en ${duree}s.`);
	} finally {
		await sql.end();
	}
}

async function deposer(
	sql: postgres.Sql,
	databookId: number,
	titre: string,
	lectures: Array<{ tache: PlancheFrenchOcr; texte: string }>
) {
	const before: Record<string, unknown> = {};
	const after: Record<string, unknown> = {};
	for (const { tache, texte } of lectures) {
		const res = await deposerTranscription(sql, {
			databookId,
			numero: tache.pageNumber,
			image: tache.image,
			texte,
			texteAttendu: "",
		});
		if (res.statut !== "ecrite") continue;
		before[`pages#${tache.pageNumber}`] = null;
		after[`pages#${tache.pageNumber}`] = res.apres;
	}
	const n = Object.keys(after).length;
	if (n > 0) {
		await sql`INSERT INTO public.wiki_revisions ${sql({
			id: revisionId(),
			tableName: "db_databooks",
			rowId: String(databookId),
			action: "update",
			label: `${titre} — OCR français (text) de ${n} planche(s)`,
			before: sql.json(before as postgres.JSONValue),
			after: sql.json(after as postgres.JSONValue),
			editorId: "agent",
			editorName: "OCR français Aphrody AI",
		})}`;
	}
	console.log(`   Dépôt PostgreSQL : ${n}/${lectures.length} transcriptions écrites pour #${databookId}.`);
}

if (import.meta.main) {
	main().catch((err) => {
		console.error("Erreur French OCR :", err);
		process.exit(1);
	});
}
