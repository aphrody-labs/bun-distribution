// SPDX-License-Identifier: Apache-2.0
/**
 * nourrir-shenron.ts — Ingestion des corpus Aphrody & Bxc pour enrichir Shenron :
 * 1. Intégration des documents de knowledge.db et fiches Toriyama dans la table RAG / wiki.
 * 2. Ingestion des transcriptions d'ocr/results.db dans bot.db_databooks (complétion OCR).
 * 3. Crawl & Extraction ciblée via bxc pour les nouvelles parutions et fiches officielles.
 */

import {
	arretSiGel,
	connecte,
	deposerTranscription,
	texteDePlanche,
	type PlancheBrute,
} from "../../../../../apps/shenron/site/scripts/_databooks-base";
import { classerDefaut } from "../../../../../apps/shenron/site/src/lib/databooks-defauts";
import { Database } from "bun:sqlite";
import type postgres from "postgres";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { openOcrResultsReadonly, resolveOcrResultsPath } from "./_ocr-results-db";

// Gel des écrivains : sortie 3 avant toute connexion si .coord/FREEZE-databooks.json existe.
if (import.meta.main) arretSiGel("nourrir-shenron");

/** Écrire en PostgreSQL ; sans ce drapeau, l'ingestion OCR est simulée. */
const APPLIQUER = process.argv.includes("--appliquer");
/** Accepter aussi les lectures `needs-review` (toujours sur planche vide seulement). */
const ACCEPTER_A_RELIRE = process.argv.includes("--accepter-a-relire");

/**
 * Cible EXACTE d'une lecture OCR, ou `null`.
 *
 * Deux formes seulement, parce que ce sont les seules dont on connaît le sens :
 *   - `…/public/wiki/databooks/<fichier>` ou `…/assets/wiki/databooks/<fichier>` :
 *     le chemin d'asset de la planche, comparé à `pages[].image` ;
 *   - `…/data/ocr-gpu/<databookId>/<n>.<ext>` : le dossier de lot de
 *     `gpu-continuous-ocr.ts` (un dossier par ouvrage), dont `<n>` n'est retenu
 *     que si l'ouvrage numérote ses planches 1..N sans trou (numéro = position).
 *
 * Retirés : l'appariement par NOM DE FICHIER seul (« 0002.jpg » existe dans
 * chaque lot) et les dossiers `var/ocr-lots/<n>` dont `<n>` est un numéro de lot,
 * pas un ouvrage.
 */
export function cibleOcr(
	chemin: string
): { type: "asset"; cle: string } | { type: "livre"; databookId: number; numero: number } | null {
	const p = chemin.replace(/\\/g, "/");
	const asset = /(?:^|\/)(?:public|assets)\/wiki\/(databooks\/[^/]+)$/.exec(p);
	if (asset) return { type: "asset", cle: asset[1]! };
	const lot = /(?:^|\/)data\/ocr-gpu\/(\d+)\/(\d+)\.(?:jpe?g|png|webp)$/i.exec(p);
	if (lot) return { type: "livre", databookId: Number(lot[1]), numero: Number(lot[2]) };
	return null;
}

/** Clé d'asset d'une image de planche (`databooks/<fichier>`), ou `null`. */
function cleAsset(image: string | null | undefined): string | null {
	const m = /assets\/wiki\/(databooks\/[^/]+)$/.exec((image ?? "").replace(/\\/g, "/"));
	return m ? m[1]! : null;
}

async function ingererOcr(sql: postgres.Sql, ocrDb: Database) {
	const statuts = ACCEPTER_A_RELIRE ? ["text", "needs-review"] : ["text"];
	const lignes = ocrDb
		.query<{ path: string; markdown: string; status: string }, []>(
			`SELECT path, markdown, status FROM ocr_pages WHERE status IN (${statuts.map((s) => `'${s}'`).join(",")}) AND LENGTH(markdown) > 5`
		)
		.all();
	console.log(`Lectures OCR retenues (${statuts.join(", ")}) : ${lignes.length}`);

	const books = await sql<{ id: string; pages: PlancheBrute[] | null }[]>`
		SELECT id, pages FROM bot.db_databooks WHERE pages IS NOT NULL`;
	type Cible = { databookId: number; numero: number; image: string | null; texte: string };
	const parAsset = new Map<string, Cible[]>();
	const parLivre = new Map<number, { contigu: boolean; pages: Map<number, Cible[]> }>();
	for (const b of books) {
		const pages = b.pages ?? [];
		const index = new Map<number, Cible[]>();
		let contigu = true;
		pages.forEach((p, i) => {
			const numero = Number(p.number);
			if (numero !== i + 1) contigu = false;
			if (!Number.isInteger(numero)) return;
			const c: Cible = { databookId: Number(b.id), numero, image: p.image ?? null, texte: texteDePlanche(p) };
			index.set(numero, [...(index.get(numero) ?? []), c]);
			const cle = cleAsset(p.image);
			if (cle) parAsset.set(cle, [...(parAsset.get(cle) ?? []), c]);
		});
		parLivre.set(Number(b.id), { contigu, pages: index });
	}

	// Une planche → toutes les lectures qui la visent (plusieurs lectures
	// divergentes = ambiguïté : on n'en choisit aucune).
	const lectures = new Map<string, { cible: Cible; textes: Set<string> }>();
	let nonAppariees = 0;
	for (const l of lignes) {
		const c = cibleOcr(l.path);
		let candidates: Cible[] = [];
		if (c?.type === "asset") candidates = parAsset.get(c.cle) ?? [];
		else if (c?.type === "livre") {
			const livre = parLivre.get(c.databookId);
			candidates = livre?.contigu ? (livre.pages.get(c.numero) ?? []) : [];
		}
		if (candidates.length !== 1) {
			nonAppariees++;
			continue;
		}
		const cible = candidates[0]!;
		const cle = `${cible.databookId}:${cible.numero}`;
		const entree = lectures.get(cle) ?? { cible, textes: new Set<string>() };
		entree.textes.add(l.markdown.trim());
		lectures.set(cle, entree);
	}

	const bilan = { cibles: lectures.size, ecrites: 0, dejaTranscrites: 0, nonAppariees, ambigues: 0, rejetees: 0, conflits: 0 };
	for (const { cible, textes } of lectures.values()) {
		if (textes.size !== 1) {
			bilan.ambigues++;
			continue;
		}
		// Jamais d'écrasement : une transcription existante, relue ou non, vaut
		// mieux qu'une lecture automatique de confiance inconnue.
		if (cible.texte.trim()) {
			bilan.dejaTranscrites++;
			continue;
		}
		const texte = [...textes][0]!;
		if (classerDefaut(texte) !== null) {
			bilan.rejetees++;
			continue;
		}
		if (!APPLIQUER) continue;
		const res = await deposerTranscription(sql, {
			databookId: cible.databookId,
			numero: cible.numero,
			image: cible.image,
			texte,
			texteAttendu: "",
		});
		if (res.statut === "ecrite") bilan.ecrites++;
		else if (res.statut === "conflit") bilan.conflits++;
		else bilan.rejetees++;
	}
	return bilan;
}

async function main() {
	console.log("=== NOURRIR SHENRON : APHRODY + BXC ===");

	const sql = await connecte();

	// 1. Audit des Databooks en base PostgreSQL
	console.log("\n--- 1. ÉTAT ACTUEL DES DATABOOKS (PostgreSQL) ---");
	const stats = await sql`
		SELECT 
			count(*) as total_livres,
			sum(jsonb_array_length(pages)) as total_pages,
			count(*) filter (where exists (select 1 from jsonb_array_elements(pages) p where (p->>'text') is not null and length(p->>'text') > 5)) as livres_avec_ocr,
			count(*) filter (where exists (select 1 from jsonb_array_elements(pages) p where (p->>'text_fr') is not null and length(p->>'text_fr') > 5)) as livres_avec_trad
		FROM bot.db_databooks
	`;
	console.log("Stats Databooks :", stats[0]);

	// 2. Vérification des planches manquantes d'OCR
	const planchesManquantes = await sql`
		WITH pages_depliees AS (
			SELECT d.id as book_id, d.title, (p.value->>'number')::int as page_num, p.value->>'image' as image, p.value->>'text' as texte
			FROM bot.db_databooks d, jsonb_array_elements(d.pages) p
		)
		SELECT count(*) as count_sans_ocr FROM pages_depliees WHERE texte IS NULL OR length(texte) < 5
	`;
	console.log("Nombre de planches sans OCR en base :", planchesManquantes[0]?.count_sans_ocr);

	// 3. Ingestion d'ocr/results.db (lecture seule, contrôlée)
	const resultsDbPath = resolveOcrResultsPath();
	if (existsSync(resultsDbPath)) {
		console.log(`\n--- 2. INGESTION DES TRANSCRIPTIONS DEPUIS APHRODY (${resultsDbPath}) ---`);
		// Lecture seule + `PRAGMA quick_check` : une base corrompue lève ici, AVANT
		// toute écriture. Le 2026-09-14, l'ancienne version lisait une base dont
		// l'`integrity_check` échouait et en recopiait le contenu en PostgreSQL.
		let ocrDb: Database;
		try {
			ocrDb = openOcrResultsReadonly(resultsDbPath, "quick");
		} catch (err) {
			console.error(`✗ ${err instanceof Error ? err.message : err}`);
			console.error("Ingestion OCR abandonnée : aucune écriture.");
			await sql.end();
			process.exit(1);
		}
		const bilan = await ingererOcr(sql, ocrDb);
		ocrDb.close();
		console.log(
			`✓ Rapprochement : ${bilan.cibles} planches appariées exactement, ${bilan.ecrites} écrites` +
				`${APPLIQUER ? "" : " (simulation — --appliquer pour écrire)"}, ${bilan.dejaTranscrites} déjà transcrites (jamais écrasées), ` +
				`${bilan.nonAppariees} chemins sans appariement exact, ${bilan.ambigues} ambiguës, ${bilan.rejetees} rejetées, ${bilan.conflits} conflits.`
		);
	} else {
		console.log(`results.db introuvable (${resultsDbPath}).`);
	}

	// 4. Ingestion de Knowledge.db ou memory/ vers le Wiki / RAG de Shenron
	const aphrodyWorkspace = process.env.APHRODY_WORKSPACE?.trim() || join(homedir(), ".aphrody", "workspace");
	const knowledgeDbPaths = [join(aphrodyWorkspace, "knowledge.db")];
	const memoryDirs = [join(aphrodyWorkspace, "memory")];

	const outDir = join(import.meta.dir, "..", "..", "apps", "bot", "data", "rag", "raw", "aphrody");
	if (!existsSync(outDir)) {
		const { mkdirSync } = await import("node:fs");
		mkdirSync(outDir, { recursive: true });
	}

	let insertedDocs = 0;
	let knowledgePath = knowledgeDbPaths.find((p) => existsSync(p));
	if (knowledgePath) {
		console.log(`\n--- 3. INGESTION DES DOCUMENTS KNOWLEDGE APHRODY (${knowledgePath}) ---`);
		try {
			const kDb = new Database(knowledgePath);
			const hasDocsTable = kDb.query("SELECT count(*) as c FROM sqlite_master WHERE type='table' AND name='documents'").get() as any;
			if (hasDocsTable?.c > 0) {
				const docs = kDb.query("SELECT id, filename, category, title, content FROM documents WHERE LENGTH(content) > 50").all() as any[];
				console.log(`Documents trouvés dans knowledge.db : ${docs.length}`);
				for (const doc of docs) {
					const outPath = join(outDir, `${doc.filename || `doc-${doc.id}`}.md`);
					const header = `---\ntitle: "${doc.title?.replace(/"/g, '\\"') || doc.filename}"\ncategory: "${doc.category}"\nsource: "aphrody-knowledge"\n---\n\n`;
					await Bun.write(outPath, header + doc.content);
					insertedDocs++;
				}
			}
		} catch (err: any) {
			console.warn("Knowledge.db avertissement:", err?.message);
		}
	}

	const memoryDir = memoryDirs.find((d) => existsSync(d));
	if (memoryDir) {
		const files = readdirSync(memoryDir).filter((f) => f.endsWith(".md"));
		console.log(`Fichiers trouvés dans memory/ (${memoryDir}) : ${files.length}`);
		for (const f of files) {
			const content = readFileSync(join(memoryDir, f), "utf-8");
			if (content.length > 50) {
				const outPath = join(outDir, f);
				if (!existsSync(outPath)) {
					await Bun.write(outPath, content);
					insertedDocs++;
				}
			}
		}
	}
	console.log(`✓ Synchronisé ${insertedDocs} documents Aphrody dans apps/bot/data/rag/raw/aphrody/`);

	// 5. Extraction Bxc Web Crawl & Scraping
	console.log("\n--- 4. EXTRACTION BXC (OFFICIAL DRAGON BALL NEWS & LORE) ---");
	const bxcPaths = [process.env.BXC_BIN?.trim(), Bun.which("bxc")].filter(
		(path): path is string => Boolean(path)
	);
	const bxcBin = bxcPaths.find((p) => existsSync(p));
	if (bxcBin) {
		console.log(`Bxc détecté : ${bxcBin}`);
		try {
			const outDir = join(import.meta.dir, "..", "..", "apps", "bot", "data", "rag", "raw", "bxc");
			if (!existsSync(outDir)) {
				const { mkdirSync } = await import("node:fs");
				mkdirSync(outDir, { recursive: true });
			}
			const proc = Bun.spawn([bxcBin, "scrape", "https://fr.dragon-ball-official.com", "--markdown", "--quiet"], {
				stdout: "pipe",
				stderr: "ignore",
			});
			const text = await new Response(proc.stdout).text();
			await proc.exited;
			if (text && text.length > 100) {
				const filePath = join(outDir, "db-official-fr-homepage.md");
				await Bun.write(filePath, `---\ntitle: "Dragon Ball Official FR"\nsource: "bxc-scrape"\nurl: "https://fr.dragon-ball-official.com"\n---\n\n` + text);
				console.log(`✓ Scraped Dragon Ball Official FR (${text.length} chars) via bxc -> ${filePath}`);
			}
		} catch (e: any) {
			console.warn("Bxc scrape avertissement:", e?.message);
		}
	} else {
		console.log("bxc introuvable dans les chemins standards.");
	}

	// 6. Exécution de canon-ingest pour matérialiser les preuves
	console.log("\n--- 5. SYNCHRONISATION CANON_REFERENCES ---");
	const { execSync } = await import("node:child_process");
	try {
		const out = execSync("bun apps/site/scripts/canon-ingest.ts", { encoding: "utf-8" });
		console.log(out.trim());
	} catch (e: any) {
		console.warn("Avertissement canon-ingest:", e?.message);
	}

	await sql.end();
	console.log("\n=== NUTRITION SHENRON COMPLÉTÉE AVEC SUCCÈS ===");
}

main().catch(console.error);
