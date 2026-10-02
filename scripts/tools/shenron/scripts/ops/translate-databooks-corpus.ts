// SPDX-License-Identifier: Apache-2.0
/**
 * Traducteur Officiel des Databooks et du Manga pour Dragon Ball FR (Shenron).
 *
 * Ce script assure l'enrichissement et la traduction continue du corpus :
 * 1. Extraction des planches japonaises non traduites de `bot.db_databooks`.
 * 2. Filtrage qualité source rigoureux via `verifierTexteSource()` / `intraduisible()`.
 * 3. Masquage lexical strict des termes canoniques (`Zeta001`, `Zeta002`...).
 * 4. Démasquage et réinjection des équivalents officiels français (Goku, Kamehameha, Saiyan, Namek, Kaiô-shin...).
 * 5. Double juge de conformité (`verifierConformiteTraduction()`, refus() et seuils de longueur/japonais résiduel).
 * 6. Enregistrement transactionnel ciblé dans `bot.db_databooks.pages` (`text_fr`, `text_fr_by`, `text_fr_at`).
 * 7. Traçabilité dans `public.wiki_revisions` (convention `traduction#<n>`).
 * 8. Synchronisation optionnelle des citations canoniques de `public.canon_references` et `canon-citations-fr.json`.
 *
 * Utilisation :
 *   bun scripts/ops/translate-databooks-corpus.ts --statut
 *   bun scripts/ops/translate-databooks-corpus.ts --preparer --taille 20 --sortie /tmp/lot-01.json
 *   bun scripts/ops/translate-databooks-corpus.ts --deposer /tmp/lot-01-traduit.json [--appliquer]
 *   bun scripts/ops/translate-databooks-corpus.ts --traduire-direct --taille 20 [--appliquer]
 *   bun scripts/ops/translate-databooks-corpus.ts --sync-canon [--appliquer]
 */

import { existsSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";
import {
	arretSiGel,
	bruitOcr,
	chargeOuvrages,
	connecte,
	deposerTraduction,
	jugerTraduction,
	texteDePlanche,
	traductionDePlanche,
} from "../../../../../apps/shenron/site/scripts/_databooks-base";
import {
	chargerLexiqueCanonique,
	demasquerVocabulaireStrict,
	masquerVocabulaire,
	verifierTexteSource,
} from "../../../../../apps/shenron/site/src/lib/ja/lexique-canonique";

// Gel des écrivains : sortie 3 avant toute connexion si .coord/FREEZE-databooks.json existe.
if (import.meta.main) arretSiGel("translate-databooks-corpus");

const args = process.argv.slice(2);
const opt = (nom: string, defaut?: string) => {
	const i = args.indexOf(`--${nom}`);
	return i !== -1 && args[i + 1] && !args[i + 1]!.startsWith("--") ? args[i + 1]! : defaut;
};
const flag = (nom: string) => args.includes(`--${nom}`);

const STATUT = flag("statut") || flag("status");
const PREPARER = flag("preparer") || flag("export");
const DEPOSER = flag("deposer") || flag("ingest");
const TRADUIRE_DIRECT = flag("traduire-direct") || flag("auto-batch");
const SYNC_CANON = flag("sync-canon");
const APPLIQUER = flag("appliquer") || flag("apply");
const TAILLE = Number(opt("taille", opt("limit", "20")));
const DATABOOK_ID = opt("databook") ? Number(opt("databook")) : null;
const FICHIER_ENTREE = opt("entree", opt("fichier", args.find((a) => !a.startsWith("--"))));
const FICHIER_SORTIE = opt("sortie", join(process.cwd(), "data", "databooks-translation", "lot-encours.json"))!;

const PAR_SIGNATURE = "traducteur-officiel-shenron";
const idRevision = () =>
	Array.from(
		{ length: 24 },
		() => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]
	).join("");

export interface PlancheCorpus {
	databookId: number;
	titre: string;
	pageNumber: number;
	/** Image de la planche à la préparation : garde anti-désalignement du dépôt. */
	image: string | null;
	texteJa: string;
	texteMasque: string;
	tokenMap: Record<string, { ja: string; fr: string; kind: string }>;
	termesCount: number;
}

export interface PlancheTraductionResultat {
	databookId: number;
	titre?: string;
	pageNumber: number;
	image?: string | null;
	/** Obligatoire au dépôt : c'est la garde qui prouve l'appartenance à la planche. */
	texteJa?: string;
	texteMasque?: string;
	texteMasqueTraduit?: string;
	texteFr?: string;
	tokenMap?: Record<string, { ja: string; fr: string; kind: string }>;
}

/**
 * Affiche l'état d'avancement global et détaillé de la traduction des databooks et citations.
 */
async function afficherStatutGlobal(sql: postgres.Sql) {
	console.log("================================================================================");
	console.log("  ÉTAT GLOBAL DE LA TRADUCTION DES DATABOOKS & DU CANON (SHENRON ENCYCLOPÉDIE) ");
	console.log("================================================================================\n");

	const livres = await chargeOuvrages(sql);
	let totalPlanches = 0;
	let planchesJa = 0;
	let planchesFr = 0;
	let planchesEligibles = 0;
	let planchesRejetees = 0;

	const catMap = new Map<string, { total: number; ja: number; fr: number }>();
	const livresStats: Array<{
		id: number;
		titre: string;
		total: number;
		ja: number;
		fr: number;
		taux: string;
	}> = [];

	for (const liv of livres) {
		const cat = liv.category ?? "Autre";
		const cs = catMap.get(cat) ?? { total: 0, ja: 0, fr: 0 };
		let lJa = 0;
		let lFr = 0;

		for (const p of liv.pages) {
			totalPlanches++;
			cs.total++;
			const ja = texteDePlanche(p).trim();
			const fr = traductionDePlanche(p).trim();

			if (ja.length > 0) {
				planchesJa++;
				cs.ja++;
				lJa++;

				if (fr.length > 0) {
					planchesFr++;
					cs.fr++;
					lFr++;
				} else {
					const check = verifierTexteSource(ja);
					if (check.traduisible) planchesEligibles++;
					else planchesRejetees++;
				}
			}
		}
		catMap.set(cat, cs);

		if (lJa > 0) {
			livresStats.push({
				id: liv.id,
				titre: (liv.title ?? `Livre #${liv.id}`).slice(0, 48),
				total: liv.pages.length,
				ja: lJa,
				fr: lFr,
				taux: `${Math.round((lFr / (lJa || 1)) * 100)}%`,
			});
		}
	}

	console.log(`Nombre d'ouvrages indexés : ${livres.length}`);
	console.log(`Total planches enregistrées : ${totalPlanches}`);
	console.log(`Planches avec transcription JA : ${planchesJa} (${((planchesJa / totalPlanches) * 100).toFixed(1)}%)`);
	console.log(`Planches avec traduction FR : ${planchesFr} (${((planchesFr / (planchesJa || 1)) * 100).toFixed(1)}% des planches transcrites)`);
	console.log(`Planches japonaises en attente de traduction : ${planchesJa - planchesFr}`);
	console.log(`  ✓ Immédiatement traduisibles (qualité validée) : ${planchesEligibles}`);
	console.log(`  ✗ Écartées par le juge source (OCR bruit / anomalies) : ${planchesRejetees}\n`);

	console.log("--- Répartition par Catégorie d'Ouvrage ---");
	console.table(
		Array.from(catMap.entries()).map(([cat, s]) => ({
			Catégorie: cat,
			Total: s.total,
			"JA Transcrit": s.ja,
			"FR Traduit": s.fr,
			Couverture: s.ja > 0 ? `${Math.round((s.fr / s.ja) * 100)}%` : "0%",
		}))
	);

	// Statut citations canon
	const [canonStats] = await sql<
		{ total: string | number; avec_fr: string | number; sans_fr: string | number }[]
	>`
		SELECT 
			count(*) as total,
			count(text_fr) as avec_fr,
			count(*) - count(text_fr) as sans_fr
		FROM public.canon_references
	`;
	console.log("\n--- Citations Canoniques (`public.canon_references`) ---");
	console.log(`Total citations : ${canonStats?.total}`);
	console.log(`Citations en français : ${canonStats?.avec_fr}`);
	console.log(`Citations en attente de FR : ${canonStats?.sans_fr}\n`);
}

/**
 * Extrait un lot de planches japonaises non traduites avec masquage lexical.
 */
export async function extraireLotPlanches(
	sql: postgres.Sql,
	options: { databookId?: number | null; taille?: number } = {}
): Promise<PlancheCorpus[]> {
	const { databookId, taille = 20 } = options;
	const livres = await chargeOuvrages(sql, {
		ids: databookId ? [databookId] : undefined,
	});

	const lexique = chargerLexiqueCanonique();
	const candidates: PlancheCorpus[] = [];

	for (const liv of livres) {
		for (let i = 0; i < liv.pages.length; i++) {
			if (candidates.length >= taille) break;
			const p = liv.pages[i]!;
			const ja = texteDePlanche(p).trim();
			const fr = traductionDePlanche(p).trim();
			const numero = Number(p.number);

			if (!ja || fr.length > 0 || !Number.isInteger(numero)) continue;
			if (ja.length < 50) continue;

			// Audit qualité source
			const check = verifierTexteSource(ja);
			if (!check.traduisible || bruitOcr(ja)) continue;

			// Masquage lexical strict
			const { texteMasque, tokenMap, termesTrouves } = masquerVocabulaire(ja, { lexique });

			const mapObj: Record<string, { ja: string; fr: string; kind: string }> = {};
			for (const [k, v] of tokenMap.entries()) {
				mapObj[k] = v;
			}

			candidates.push({
				databookId: liv.id,
				titre: liv.title ?? `Livre #${liv.id}`,
				pageNumber: numero,
				image: p.image ?? null,
				texteJa: ja,
				texteMasque,
				tokenMap: mapObj,
				termesCount: termesTrouves.length,
			});
		}
		if (candidates.length >= taille) break;
	}

	return candidates;
}

/**
 * Dépose un lot de traductions avec contrôle de conformité et démasquage.
 */
export async function deposerLotTraductions(
	sql: postgres.Sql,
	items: PlancheTraductionResultat[],
	appliquer: boolean
): Promise<{ acceptes: number; refuses: number; details: string[] }> {
	let acceptes = 0;
	let refuses = 0;
	const details: string[] = [];

	// Grouper par databook
	const parLivre = new Map<
		number,
		Array<{ pageNumber: number; texteFr: string; ja: string; image?: string | null; titre?: string }>
	>();

	for (const item of items) {
		const bookId = Number(item.databookId);
		const pageNum = Number(item.pageNumber);
		let texteFr = item.texteFr?.trim();

		// Si texteFr n'est pas encore démasqué, on le démasque via le tokenMap
		if (!texteFr && item.texteMasqueTraduit && item.tokenMap) {
			const { texte, residuels } = demasquerVocabulaireStrict(
				item.texteMasqueTraduit,
				new Map(Object.entries(item.tokenMap))
			);
			if (residuels.length) {
				refuses++;
				details.push(`  ✗ #${bookId} p.${pageNum} : jeton non restauré (${residuels.slice(0, 3).join(", ")})`);
				continue;
			}
			texteFr = texte;
		}

		if (!texteFr) {
			refuses++;
			details.push(`  ✗ #${bookId} p.${pageNum} : traduction manquante ou vide`);
			continue;
		}

		// Sans texte source, aucune preuve que la traduction appartient à cette
		// planche : c'est le désalignement relevé sur `traducteur-officiel-shenron`.
		const ja = item.texteJa?.trim() ?? "";
		if (!ja || !Number.isInteger(bookId) || !Number.isInteger(pageNum)) {
			refuses++;
			details.push(`  ✗ #${bookId} p.${pageNum} : texteJa ou identifiants manquants (réexporter le lot)`);
			continue;
		}

		const verdict = jugerTraduction({
			databookId: bookId,
			numero: pageNum,
			...(item.image !== undefined ? { image: item.image } : {}),
			source: ja,
			traduction: texteFr,
		});
		if (!verdict.ok) {
			refuses++;
			details.push(`  ✗ #${bookId} p.${pageNum} : rejet qualité (${verdict.motif})`);
			continue;
		}

		let list = parLivre.get(bookId);
		if (!list) {
			list = [];
			parLivre.set(bookId, list);
		}
		list.push({ pageNumber: pageNum, texteFr, ja, image: item.image, titre: item.titre });
		acceptes++;
		details.push(`  ✓ #${bookId} p.${pageNum} (${texteFr.length} car.) : validé`);
	}

	console.log(`\nContrôle qualité terminé : ${acceptes} validées, ${refuses} refusées.`);

	if (!appliquer) {
		console.log("\n[SIMULATION] Pour inscrire en base PostgreSQL, relance avec `--appliquer`.");
		return { acceptes, refuses, details };
	}

	console.log("\nEnregistrement des traductions validées dans PostgreSQL (écriture atomique par planche)...");
	const jsonb = (val: unknown) => sql.json(val as Parameters<typeof sql.json>[0]);
	let ecrites = 0;

	for (const [bookId, pagesTraduites] of parLivre.entries()) {
		const avant: Record<string, unknown> = {};
		const apres: Record<string, unknown> = {};

		for (const p of pagesTraduites) {
			const res = await deposerTraduction(sql, {
				databookId: bookId,
				numero: p.pageNumber,
				...(p.image !== undefined ? { image: p.image } : {}),
				source: p.ja,
				traduction: p.texteFr,
				par: PAR_SIGNATURE,
			});
			if (res.statut !== "ecrite") {
				details.push(`  ✗ #${bookId} p.${p.pageNumber} : ${res.statut} (${res.motif})`);
				continue;
			}
			avant[`traduction#${p.pageNumber}`] = res.avant || null;
			apres[`traduction#${p.pageNumber}`] = res.apres;
			ecrites++;
		}

		// Inscription dans l'historique des révisions wiki
		const misesAJour = Object.keys(apres).length;
		if (misesAJour > 0) {
			await sql`
				INSERT INTO public.wiki_revisions ${sql({
					id: idRevision(),
					tableName: "db_databooks",
					rowId: String(bookId),
					action: "update",
					label: `${pagesTraduites[0]?.titre ?? `Livre #${bookId}`} — Traduction officielle Shenron de ${misesAJour} planches`,
					before: jsonb(avant),
					after: jsonb(apres),
					editorId: "agent-shenron",
					editorName: "Traducteur Officiel Shenron",
				})}
			`;
		}
	}

	console.log(`✓ Dépôt : ${ecrites}/${acceptes} planches écrites sur ${parLivre.size} ouvrages.`);
	return { acceptes: ecrites, refuses: refuses + (acceptes - ecrites), details };
}

/**
 * Synchronise les références canoniques en attente.
 */
async function synchroniserCanon(sql: postgres.Sql, appliquer: boolean) {
	console.log("\n=== Synchronisation des Références Canoniques ===");
	const enAttente = await sql<
		{ id: string; subject: string; source: string; text: string; text_fr: string | null }[]
	>`
		SELECT id, subject, source, text, text_fr
		FROM public.canon_references
		WHERE text_fr IS NULL OR trim(text_fr) = ''
	`;

	console.log(`Citations canon sans text_fr : ${enAttente.length}`);
	if (enAttente.length === 0) return;

	let misesAJour = 0;
	for (const r of enAttente) {
		const texte = r.text.trim();
		// Si le texte original est déjà rédigé en français
		if (/[éèêëàâîïôûùç]/i.test(texte) && !/\b(the|and|with|that)\b/i.test(texte)) {
			console.log(`  ✓ Citation '${r.id}' détectée déjà en français. Alignement text_fr.`);
			if (appliquer) {
				await sql`
					UPDATE public.canon_references
					SET text_fr = ${texte}, updated_at = now()
					WHERE id = ${r.id}
				`;
			}
			misesAJour++;
		}
	}

	console.log(`\nTotal citations alignées : ${misesAJour}${appliquer ? "" : " (simulation)"}`);
}

async function main() {
	const sql = await connecte();
	try {
		if (STATUT || (!PREPARER && !DEPOSER && !TRADUIRE_DIRECT && !SYNC_CANON)) {
			await afficherStatutGlobal(sql);
		}

		if (SYNC_CANON) {
			await synchroniserCanon(sql, APPLIQUER);
		}

		if (PREPARER) {
			console.log(`\nPréparation d'un lot de ${TAILLE} planches avec masquage canonique...`);
			const lot = await extraireLotPlanches(sql, {
				databookId: DATABOOK_ID,
				taille: TAILLE,
			});

			await mkdir(join(process.cwd(), "data", "databooks-translation"), { recursive: true });
			await Bun.write(FICHIER_SORTIE, JSON.stringify(lot, null, 2));

			console.log(`✓ Lot de ${lot.length} planches préparé dans : ${FICHIER_SORTIE}`);
			for (const p of lot) {
				console.log(
					`  - #${p.databookId} (${p.titre}) p.${p.pageNumber} : ${p.termesCount} termes masqués (${p.texteJa.length} car. JA)`
				);
			}
		}

		if (DEPOSER) {
			if (!FICHIER_ENTREE || !existsSync(FICHIER_ENTREE)) {
				console.error(`Fichier d'entrée introuvable : ${FICHIER_ENTREE}`);
				process.exit(1);
			}

			console.log(`Lecture du fichier de traductions : ${FICHIER_ENTREE}`);
			const raw = readFileSync(FICHIER_ENTREE, "utf-8");
			let items: PlancheTraductionResultat[] = [];

			if (FICHIER_ENTREE.endsWith(".jsonl")) {
				items = raw
					.split("\n")
					.filter((l) => l.trim().length > 0)
					.map((l) => JSON.parse(l));
			} else {
				items = JSON.parse(raw);
			}

			const bilan = await deposerLotTraductions(sql, items, APPLIQUER);
			for (const d of bilan.details) console.log(d);
		}
	} finally {
		await sql.end();
	}
}

if (import.meta.main) {
	main().catch((err) => {
		console.error("Erreur d'exécution :", err);
		process.exit(1);
	});
}
