// SPDX-License-Identifier: Apache-2.0
/**
 * Orchestrateur de Traduction FR des Databooks pour Agents VPS.
 *
 * Applique le pipeline complet :
 * 1. Détection des planches ayant du japonais (text) sans traduction française (text_fr).
 * 2. Filtrage qualité source via intraduisible() et bruitOcr().
 * 3. Masquage lexical canonique via masquerVocabulaire() (Zeta001, Zeta002...).
 * 4. Préparation et export des lots pour agents VPS (subagents / LLM). Chaque ligne
 *    porte le texte source ET l'image de la planche : ce sont les gardes du dépôt.
 * 5. Réingestion, démasquage strict (jeton non restauré = refus), juge unique
 *    `jugerTraduction` et dépôt atomique par planche (`deposerTraduction`).
 *
 * Utilisation :
 *   bun scripts/ops/translate-databooks.ts --statut
 *   bun scripts/ops/translate-databooks.ts --exporter-lots --taille 50
 *   bun scripts/ops/translate-databooks.ts --databook 4 --exporter-lots
 *   bun scripts/ops/translate-databooks.ts --ingest data/databooks-translation/lots/lot-001-traduit.jsonl [--appliquer]
 */

import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type postgres from "postgres";
import {
	arretSiGel,
	bruitOcr,
	chargeOuvrages,
	connecte,
	deposerTraduction,
	jugerTraduction,
	texteDePlanche,
	traductionDePlanche,
	type Ouvrage,
} from "../../../../../apps/shenron/site/scripts/_databooks-base";
import {
	demasquerVocabulaireStrict,
	masquerVocabulaire,
	verifierTexteSource,
} from "../../../../../apps/shenron/site/src/lib/ja/lexique-canonique";

// Gel des écrivains : sortie 3 avant toute connexion si .coord/FREEZE-databooks.json existe.
arretSiGel("translate-databooks");

const args = process.argv.slice(2);
const opt = (nom: string, defaut?: string) => {
	const i = args.indexOf(`--${nom}`);
	return i !== -1 && args[i + 1] ? args[i + 1]! : defaut;
};
const flag = (nom: string) => args.includes(`--${nom}`);

const STATUT = flag("statut");
const EXPORTER_LOTS = flag("exporter-lots");
const TAILLE_LOT = Number(opt("taille", "50"));
const DATABOOK_ID = opt("databook") ? Number(opt("databook")) : null;
const SORTIE = opt("sortie", join(process.cwd(), "data", "databooks-translation", "lots"))!;
const INGEST_FILE = opt("ingest");
const APPLIQUER = flag("appliquer");
const SIGNATURE = "shenron-vps-agent";

interface PlancheATraduire {
	databookId: number;
	titre: string;
	pageNumber: number;
	image: string | null;
	texteJa: string;
	texteMasque: string;
	tokenMapObj: Record<string, { ja: string; fr: string; kind: string }>;
	termesCount: number;
}

async function afficherStatut(ouvrages: Ouvrage[]) {
	console.log("\n--- Bilan Global Traduction Databooks ---");
	const totalLivres = ouvrages.length;
	let totalPlanches = 0;
	let totalTranscrites = 0;
	let totalTraduites = 0;
	let planchesEligibles = 0;
	let planchesIntraduisibles = 0;

	const categories = new Map<string, { total: number; ja: number; fr: number }>();

	for (const o of ouvrages) {
		const cat = o.category ?? "Non catégorisé";
		const catStats = categories.get(cat) ?? { total: 0, ja: 0, fr: 0 };

		for (const p of o.pages) {
			totalPlanches++;
			catStats.total++;

			const ja = texteDePlanche(p).trim();
			const fr = traductionDePlanche(p).trim();

			if (ja.length > 0) {
				totalTranscrites++;
				catStats.ja++;

				if (fr.length > 0) {
					totalTraduites++;
					catStats.fr++;
				} else if (verifierTexteSource(ja).traduisible && !bruitOcr(ja)) {
					planchesEligibles++;
				} else {
					planchesIntraduisibles++;
				}
			}
		}
		categories.set(cat, catStats);
	}

	console.log(`Total Databooks : ${totalLivres}`);
	console.log(`Total Planches : ${totalPlanches}`);
	console.log(`Planches avec texte JA (transcrites) : ${totalTranscrites} (${((totalTranscrites / totalPlanches) * 100).toFixed(1)}%)`);
	console.log(`Planches avec traduction FR : ${totalTraduites} (${((totalTraduites / (totalTranscrites || 1)) * 100).toFixed(1)}% des transcrites)`);
	console.log(`Planches en attente de traduction FR : ${totalTranscrites - totalTraduites}`);
	console.log(`  - Immédiatement traduisibles (source saine) : ${planchesEligibles}`);
	console.log(`  - Bloquées par le juge qualité (intraduisibles ou bruit OCR) : ${planchesIntraduisibles}`);

	console.log("\n--- Progression par Catégorie ---");
	const tableData = Array.from(categories.entries()).map(([cat, stats]) => ({
		Catégorie: cat,
		Total: stats.total,
		"JA (Transcrites)": stats.ja,
		"FR (Traduites)": stats.fr,
		"Taux Traduction": stats.ja > 0 ? `${Math.round((stats.fr / stats.ja) * 100)}%` : "0%",
	}));
	console.table(tableData);
}

async function exporterLots(ouvrages: Ouvrage[]) {
	const aTraduire: PlancheATraduire[] = [];

	for (const o of ouvrages) {
		for (const p of o.pages) {
			const ja = texteDePlanche(p).trim();
			const fr = traductionDePlanche(p).trim();
			const numero = Number(p.number);

			if (ja.length === 0 || fr.length > 0 || !Number.isInteger(numero)) continue;

			// Filtre de qualité préalable
			if (!verifierTexteSource(ja).traduisible || bruitOcr(ja)) continue;

			// Masquage lexical
			const { texteMasque, tokenMap, termesTrouves } = masquerVocabulaire(ja);

			aTraduire.push({
				databookId: o.id,
				titre: o.title ?? `Livre #${o.id}`,
				pageNumber: numero,
				image: p.image ?? null,
				texteJa: ja,
				texteMasque,
				tokenMapObj: Object.fromEntries(tokenMap.entries()),
				termesCount: termesTrouves.length,
			});
		}
	}

	console.log(`\nPlanches saines à traduire : ${aTraduire.length}`);
	if (aTraduire.length === 0) {
		console.log("Rien à exporter !");
		return;
	}

	await mkdir(SORTIE, { recursive: true });

	const nbLots = Math.ceil(aTraduire.length / TAILLE_LOT);
	console.log(`Export en ${nbLots} lots de max ${TAILLE_LOT} planches dans : ${SORTIE}`);

	for (let lotIndex = 0; lotIndex < nbLots; lotIndex++) {
		const start = lotIndex * TAILLE_LOT;
		const end = Math.min(start + TAILLE_LOT, aTraduire.length);
		const items = aTraduire.slice(start, end);

		const lotId = `trad-lot-${String(lotIndex + 1).padStart(3, "0")}`;
		const lotFile = join(SORTIE, `${lotId}.jsonl`);

		const lines = items.map((item) =>
			JSON.stringify({
				id: `db-${item.databookId}-p${item.pageNumber}`,
				databookId: item.databookId,
				titre: item.titre,
				pageNumber: item.pageNumber,
				// Gardes du dépôt : la traduction ne sera posée que sur la planche
				// qui porte ENCORE ce texte et cette image.
				image: item.image,
				texteJa: item.texteJa,
				texteMasque: item.texteMasque,
				termesCount: item.termesCount,
				tokenMap: item.tokenMapObj,
				// Instruction pour l'agent VPS
				instruction:
					"Traduis fidèlement le texteMasque en français sans commentaire. Conserve impérativement les tokens ZetaNNN intacts. Recopie texteJa, image et tokenMap sans les modifier.",
			})
		);

		await Bun.write(lotFile, lines.join("\n") + "\n");
		console.log(`  ✓ ${lotId} : ${items.length} planches exportées -> ${lotFile}`);
	}
}

async function ingererTraductions(cheminFichier: string, sql: postgres.Sql) {
	console.log(`\nIngestion du fichier traduit : ${cheminFichier}`);
	const contenu = readFileSync(cheminFichier, "utf-8");
	const lignes = contenu.split("\n").filter((l) => l.trim().length > 0);

	let valideCount = 0;
	let refuseCount = 0;
	let ecrites = 0;
	let conflits = 0;

	for (const ligne of lignes) {
		let item: Record<string, unknown>;
		try {
			item = JSON.parse(ligne);
		} catch {
			continue;
		}

		const databookId = Number(item.databookId);
		const pageNumber = Number(item.pageNumber);
		const texteMasqueTraduit = item.texteTraduit ?? item.traduction ?? item.text_fr;
		const texteJa = item.texteJa;

		if (!Number.isInteger(databookId) || !Number.isInteger(pageNumber) || typeof texteMasqueTraduit !== "string") {
			continue;
		}
		// Sans le texte source, rien ne prouve que la traduction appartient à
		// cette planche : c'est exactement le désalignement observé. L'ancien
		// ingest jugeait contre le texte MASQUÉ, jamais contre la planche.
		if (typeof texteJa !== "string" || !texteJa.trim()) {
			refuseCount++;
			console.log(`  [REFUS] Livre #${databookId} Planche #${pageNumber}: lot sans texteJa (réexporter le lot)`);
			continue;
		}

		const mapTokens = new Map<string, { ja: string; fr: string; kind: string }>();
		if (item.tokenMap && typeof item.tokenMap === "object") {
			for (const [k, v] of Object.entries(item.tokenMap as Record<string, unknown>)) {
				mapTokens.set(k, v as { ja: string; fr: string; kind: string });
			}
		}

		// Démasquage strict avec réinjection du vocabulaire officiel
		const { texte: texteFrFinal, residuels } = demasquerVocabulaireStrict(texteMasqueTraduit, mapTokens);
		if (residuels.length) {
			refuseCount++;
			console.log(`  [REFUS] Livre #${databookId} Planche #${pageNumber}: jeton non restauré (${residuels.slice(0, 3).join(", ")})`);
			continue;
		}

		const travail = {
			databookId,
			numero: pageNumber,
			...(typeof item.image === "string" || item.image === null ? { image: item.image as string | null } : {}),
			source: texteJa,
			traduction: texteFrFinal,
		};
		const verdict = jugerTraduction(travail);
		if (!verdict.ok) {
			refuseCount++;
			console.log(`  [REFUS] Livre #${databookId} Planche #${pageNumber}: ${verdict.motif}`);
			continue;
		}
		valideCount++;

		if (!APPLIQUER) continue;
		const res = await deposerTraduction(sql, { ...travail, par: SIGNATURE });
		if (res.statut === "ecrite") ecrites++;
		else if (res.statut === "conflit") conflits++;
		else refuseCount++;
	}

	console.log(`\nRésultats du contrôle qualité :`);
	console.log(`  - Validées : ${valideCount}`);
	console.log(`  - Refusées par le juge : ${refuseCount}`);

	if (!APPLIQUER) {
		console.log(`\nMode SIMULATION. Utilise --appliquer pour enregistrer dans PostgreSQL.`);
		return;
	}
	console.log(`✓ ${ecrites} planches traduites déposées, ${conflits} conflits (planche modifiée ou déjà traduite).`);
}

async function main() {
	console.log("=== Orchestrateur de Traduction VPS des Databooks ===");

	const sql = await connecte();
	try {
		if (INGEST_FILE) {
			await ingererTraductions(INGEST_FILE, sql);
			return;
		}

		const ouvrages = await chargeOuvrages(sql, {
			ids: DATABOOK_ID ? [DATABOOK_ID] : undefined,
		});

		if (STATUT || (!EXPORTER_LOTS && !INGEST_FILE)) {
			await afficherStatut(ouvrages);
		}

		if (EXPORTER_LOTS) {
			await exporterLots(ouvrages);
		}
	} finally {
		await sql.end();
	}
}

main().catch((err) => {
	console.error("Erreur dans l'orchestrateur de traduction :", err);
	process.exit(1);
});
