// SPDX-License-Identifier: Apache-2.0
/**
 * Moteur de Traduction Massive des Databooks (Shenron VPS + BXC + Lexique Canonique).
 *
 * Combine en mémoire haute vitesse :
 * 1. Extraction des planches japonaises sans traduction FR dans bot.db_databooks.
 * 2. Masquage lexical canonique via masquerVocabulaire() (protection des noms propres & techniques).
 * 3. Inférence de traduction par lot via defaultTranslateEngine (BXC Google Translate Engine).
 * 4. Démasquage canonique strict : un jeton non restauré (« Zêta010 ») fait échouer la planche.
 * 5. Juge unique de dépôt `jugerTraduction` (bruit OCR, copie, fuite de jeton, doublons,
 *    rapport de longueur, désalignement) puis écriture atomique PAR PLANCHE
 *    (`deposerTraduction`, `_databooks-base.ts`), sous gardes texte source + image.
 *
 * Écrit par défaut, comme avant ; `--dry-run` n'écrit rien.
 *
 * Utilisation :
 *   bun scripts/ops/massive-translate-worker.ts --statut
 *   bun scripts/ops/massive-translate-worker.ts --limite 100 --batch 10 --dry-run
 *   bun scripts/ops/massive-translate-worker.ts --book 4
 *   bun scripts/ops/massive-translate-worker.ts --tout
 */

import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join, resolve } from "node:path";
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
} from "../../../../../apps/shenron/site/scripts/_databooks-base";
import { classerDefaut } from "../../../../../apps/shenron/site/src/lib/databooks-defauts";
import {
	demasquerVocabulaireStrict,
	masquerVocabulaire,
	verifierTexteSource,
} from "../../../../../apps/shenron/site/src/lib/ja/lexique-canonique";

// Gel des écrivains : sortie 3 avant toute connexion si .coord/FREEZE-databooks.json existe.
if (import.meta.main) arretSiGel("massive-translate-worker");

const args = process.argv.slice(2);
const opt = (nom: string, defaut?: string) => {
	const i = args.indexOf(`--${nom}`);
	return i !== -1 && args[i + 1] ? args[i + 1]! : defaut;
};
const flag = (nom: string) => args.includes(`--${nom}`);

const STATUT = flag("statut");
const TOUT = flag("tout");
const EN_BOUCLE = flag("en-boucle");
const LIMITE = opt("limite") ? Number(opt("limite")) : TOUT ? Infinity : 100;
const BATCH_SIZE = Number(opt("batch", "8"));
const BOOK_ID = opt("book") ? Number(opt("book")) : null;
const SHARDS = Math.max(1, Number(opt("shards", "1")) || 1);
const SHARD_INDEX = Math.max(0, Number(opt("shard-index", "0")) || 0);
const DRY_RUN = flag("dry-run");
const SIGNATURE = "shenron-massive-vps";

/** Stable partitioning for concurrent lanes; unlike Math.random this is resumable. */
function appartientAuShard(databookId: number, pageNumber: number): boolean {
	if (SHARDS === 1) return true;
	if (SHARD_INDEX >= SHARDS) throw new Error(`shard-index ${SHARD_INDEX} hors plage 0..${SHARDS - 1}`);
	let hash = 2166136261;
	for (const code of `${databookId}:${pageNumber}`) {
		hash ^= code.charCodeAt(0);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0) % SHARDS === SHARD_INDEX;
}

// Résolution dynamique du moteur BXC
async function getTranslateEngine() {
	const paths = [
		process.env.BXC_ROOT && join(process.env.BXC_ROOT, "src", "google", "translate", "index.ts"),
		join(resolve(import.meta.dir, "..", "..", "..", "aphrody-web", "apps", "bxc"), "src", "google", "translate", "index.ts"),
		join(process.cwd(), "..", "aphrody-web", "apps", "bxc", "src", "google", "translate", "index.ts"),
		join(resolve(import.meta.dir, "..", "..", "..", "bxc"), "src", "google", "translate", "index.ts"),
		join(process.cwd(), "..", "bxc", "src", "google", "translate", "index.ts"),
	].filter((path): path is string => Boolean(path));

	for (const p of paths) {
		if (existsSync(p)) {
			const mod = await import(p);
			if (mod.defaultTranslateEngine) {
				return mod.defaultTranslateEngine;
			}
		}
	}

	throw new Error(
		"BXC translation engine not found. Set BXC_ROOT or install BXC next to the Shenron repository."
	);
}

interface PlancheTache {
	databookId: number;
	bookTitle: string;
	/** Numéro éditorial EXACT de la planche (jamais la position). */
	pageNumber: number;
	/** Image de la planche lue au moment de la préparation (garde anti-désalignement). */
	image: string | null;
	texteJa: string;
	texteMasque: string;
	tokenMap: Map<string, { ja: string; fr: string; kind: string }>;
}

interface Retenue {
	tache: PlancheTache;
	texteFr: string;
}

async function main() {
	console.log("==========================================================");
	console.log("   SHENRON MASSIVE TRANSLATE WORKER (VPS + BXC + CANON)   ");
	console.log("==========================================================\n");

	const sql = await connecte();
	try {
		if (STATUT) {
			const stats = await sql`
				SELECT
					count(*) as total_livres,
					sum(jsonb_array_length(pages)) as total_planches,
					sum((SELECT count(*) FROM jsonb_array_elements(pages) p WHERE (p->>'text') IS NOT NULL AND length(trim(p->>'text')) > 0)) as planches_ja,
					sum((SELECT count(*) FROM jsonb_array_elements(pages) p WHERE (p->>'text_fr') IS NOT NULL AND length(trim(p->>'text_fr')) > 0)) as planches_fr
				FROM bot.db_databooks
				WHERE pages IS NOT NULL
			`;
			console.log("Statistiques globales de la base PostgreSQL :");
			console.table(stats);
			return;
		}

		console.log("1. Chargement du moteur de traduction BXC souverain...");
		const engine = await getTranslateEngine();
		console.log("   ✓ Moteur BXC connecté avec succès.\n");

		let iteration = 0;
		let cumulTraduits = 0;

		while (true) {
			iteration++;
			if (iteration > 1) {
				console.log(`\n==========================================================`);
				console.log(`--- Démarrage de l'itération #${iteration} (Cumul : ${cumulTraduits} traductions) ---`);
				console.log(`==========================================================\n`);
			}

			console.log("Extraction des planches candidates dans bot.db_databooks...");
			const ouvrages = await chargeOuvrages(sql, {
				ids: BOOK_ID ? [BOOK_ID] : undefined,
			});

			const tachesCandidates: PlancheTache[] = [];
			let totalPlanchesScan = 0;
			let dejaTraduites = 0;
			let sansTexteJa = 0;
			let rejetSource = 0;

			for (const o of ouvrages) {
				for (const p of o.pages) {
					totalPlanchesScan++;
					const ja = texteDePlanche(p).trim();
					const fr = traductionDePlanche(p).trim();
					const numero = Number(p.number);

					if (!ja) {
						sansTexteJa++;
						continue;
					}
					if (fr) {
						dejaTraduites++;
						continue;
					}
					if (!Number.isInteger(numero)) {
						rejetSource++;
						continue;
					}
					if (!appartientAuShard(o.id, numero)) continue;

					const checkSource = verifierTexteSource(ja);
					if (!checkSource.traduisible || classerDefaut(ja) !== null || bruitOcr(ja) !== null) {
						rejetSource++;
						continue;
					}

					const { texteMasque, tokenMap } = masquerVocabulaire(ja);

					tachesCandidates.push({
						databookId: o.id,
						bookTitle: o.title ?? `Livre #${o.id}`,
						pageNumber: numero,
						image: p.image ?? null,
						texteJa: ja,
						texteMasque,
						tokenMap,
					});
				}
			}

			// Tri déterministe : les lanes reprennent sans se chevaucher après un arrêt.
			tachesCandidates.sort((a, b) => a.databookId - b.databookId || a.pageNumber - b.pageNumber);

			const taches = tachesCandidates.slice(0, LIMITE);

			console.log(`   - Planches scannées : ${totalPlanchesScan}`);
			console.log(`   - Déjà traduites en FR : ${dejaTraduites}`);
			console.log(`   - Sans texte japonais : ${sansTexteJa}`);
			console.log(`   - Rejetées par le juge source : ${rejetSource}`);
			console.log(`   - Total candidates éligibles (lane ${SHARD_INDEX + 1}/${SHARDS}) : ${tachesCandidates.length}`);
			console.log(`   - Sélectionnées pour ce lot (mélange global) : ${taches.length}\n`);

			if (taches.length === 0) {
				console.log("Aucune planche en attente de traduction pour ces critères.");
				break;
			}

			console.log(
				`3. Démarrage de la traduction par lots de ${BATCH_SIZE} planches (Objectif : ${taches.length})...\n`
			);

			let retenues = 0;
			let deposees = 0;
			let refusQualite = 0;
			let conflits = 0;
			let erreursMoteur = 0;

			let aDeposer: Retenue[] = [];

			/** Démasque strictement et juge ; la planche n'est retenue que si tout passe. */
			const retenir = (tache: PlancheTache, traduitBrut: string, mode: string) => {
				if (!traduitBrut) {
					erreursMoteur++;
					return;
				}
				const { texte: texteFr, residuels } = demasquerVocabulaireStrict(traduitBrut, tache.tokenMap);
				if (residuels.length) {
					refusQualite++;
					console.warn(
						`  [QUALITÉ REJETÉE] ${tache.bookTitle} p.${tache.pageNumber} : jeton non restauré (${residuels.slice(0, 3).join(", ")})`
					);
					return;
				}
				const verdict = jugerTraduction({
					databookId: tache.databookId,
					numero: tache.pageNumber,
					image: tache.image,
					source: tache.texteJa,
					traduction: texteFr,
				});
				if (!verdict.ok) {
					refusQualite++;
					console.warn(`  [QUALITÉ REJETÉE] ${tache.bookTitle} p.${tache.pageNumber} : ${verdict.motif}`);
					return;
				}
				retenues++;
				aDeposer.push({ tache, texteFr });
				console.log(
					`  ✓ [${retenues}/${taches.length}]${mode} ${tache.bookTitle} p.${tache.pageNumber} (${texteFr.length} car)`
				);
			};

			const debut = Date.now();

			for (let i = 0; i < taches.length; i += BATCH_SIZE) {
				const batch = taches.slice(i, i + BATCH_SIZE);
				const batchInputs = batch.map((t) => t.texteMasque);

				try {
					// Appel haute performance BXC avec backoff exponentiel
					let reponse = null;
					for (let attempt = 1; attempt <= 3; attempt++) {
						try {
							reponse = await engine.translate({
								q: batchInputs,
								target: "fr",
								source: "ja",
							});
							break;
						} catch (err: any) {
							if (attempt === 3) throw err;
							console.warn(
								`  [RATE-LIMIT BXC] Tentative ${attempt}/3, pause de ${attempt * 2}s...`
							);
							await new Promise((r) => setTimeout(r, attempt * 2000));
						}
					}
					if (!reponse) throw new Error("Réponse vide du moteur de traduction");
					await new Promise((r) => setTimeout(r, 600));

					const translations = reponse.data.translations;
					// Un lot rendu incomplet recollerait la traduction d'une planche sur
					// une autre : on bascule en unitaire plutôt que de deviner l'alignement.
					if (!Array.isArray(translations) || translations.length !== batch.length) {
						throw new Error(
							`${Array.isArray(translations) ? translations.length : 0} traductions pour ${batch.length} planches`
						);
					}

					for (let j = 0; j < batch.length; j++) {
						retenir(batch[j]!, translations[j]?.translatedText ?? "", "");
					}
				} catch (err) {
					console.warn(
						`  Erreur sur le lot [${i}..${i + batch.length}], basculement en mode unitaire :`,
						(err as any)?.message ?? err
					);
					for (const tache of batch) {
						try {
							await new Promise((r) => setTimeout(r, 400));
							const repIndiv = await engine.translate({
								q: [tache.texteMasque],
								target: "fr",
								source: "ja",
							});
							retenir(tache, repIndiv?.data?.translations?.[0]?.translatedText ?? "", " (unitaire)");
						} catch (errIndiv) {
							erreursMoteur++;
							console.error(
								`  Échec unitaire ${tache.bookTitle} p.${tache.pageNumber}:`,
								(errIndiv as any)?.message ?? errIndiv
							);
						}
					}
				}

				// Dépôt incrémental
				if (aDeposer.length >= 40 || (i + BATCH_SIZE >= taches.length && aDeposer.length > 0)) {
					if (!DRY_RUN) {
						const bilan = await appliquerMisesAJour(sql, aDeposer);
						deposees += bilan.ecrites;
						refusQualite += bilan.rejetees;
						conflits += bilan.conflits;
					}
					aDeposer = [];
				}
			}

			const dureeSec = ((Date.now() - debut) / 1000).toFixed(1);
			console.log("\n==========================================================");
			console.log(`Bilan de la session de traduction :`);
			console.log(`  - Durée totale : ${dureeSec}s`);
			console.log(`  - Planches retenues par le juge : ${retenues}`);
			console.log(`  - Planches enregistrées : ${DRY_RUN ? "0 (dry-run)" : deposees}`);
			console.log(`  - Rejets par le juge qualité : ${refusQualite}`);
			console.log(`  - Conflits d'écriture (planche changée entre-temps) : ${conflits}`);
			console.log(`  - Erreurs de traduction : ${erreursMoteur}`);
			cumulTraduits += deposees;
			if (!EN_BOUCLE || taches.length === 0) {
				break;
			}
			console.log("\nPause de 2 secondes avant l'itération suivante...");
			await new Promise((r) => setTimeout(r, 2000));
		}
	} finally {
		await sql.end();
	}
}

/**
 * Dépose planche par planche (écriture atomique, gardes texte + image +
 * traduction vide), puis une révision wiki par ouvrage pour ce qui a été écrit.
 */
async function appliquerMisesAJour(
	sql: postgres.Sql,
	retenues: Retenue[]
): Promise<{ ecrites: number; rejetees: number; conflits: number }> {
	const parLivre = new Map<number, Retenue[]>();
	for (const r of retenues) {
		const liste = parLivre.get(r.tache.databookId) ?? [];
		liste.push(r);
		parLivre.set(r.tache.databookId, liste);
	}
	let ecrites = 0;
	let rejetees = 0;
	let conflits = 0;
	for (const [databookId, liste] of parLivre) {
		const before: Record<string, unknown> = {};
		const after: Record<string, unknown> = {};
		for (const { tache, texteFr } of liste) {
			const res = await deposerTraduction(sql, {
				databookId,
				numero: tache.pageNumber,
				image: tache.image,
				source: tache.texteJa,
				traduction: texteFr,
				par: SIGNATURE,
			});
			if (res.statut === "rejetee") rejetees++;
			else if (res.statut === "conflit") conflits++;
			else {
				ecrites++;
				before[`traduction#${tache.pageNumber}`] = res.avant || null;
				after[`traduction#${tache.pageNumber}`] = res.apres;
			}
		}
		if (Object.keys(after).length > 0) {
			await sql`INSERT INTO public.wiki_revisions ${sql({
				id: randomBytes(12).toString("hex"),
				tableName: "db_databooks",
				rowId: String(databookId),
				action: "update",
				label: `${liste[0]!.tache.bookTitle} — traduction massive contrôlée`,
				before: sql.json(before as postgres.JSONValue),
				after: sql.json(after as postgres.JSONValue),
				editorId: "agent-shenron",
				editorName: "Shenron massive translation quality gate",
			})}`;
		}
	}
	console.log(`   Dépôt PostgreSQL : ${ecrites} écrites, ${rejetees} rejetées, ${conflits} conflits.`);
	return { ecrites, rejetees, conflits };
}

if (import.meta.main) {
	main().catch((err) => {
		console.error("Erreur massive translate :", err);
		process.exit(1);
	});
}
