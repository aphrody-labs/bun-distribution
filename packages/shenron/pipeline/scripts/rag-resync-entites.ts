#!/usr/bin/env bun
/**
 * rag-resync-entites.ts — remet à jour dans le RAG les chunks d'UNE source,
 * sans reconstruire l'index entier, et sans réembarquer ce qui n'a pas bougé.
 *
 * Le besoin d'origine : corriger un titre ou une URL dans `bot.db_movies`
 * laissait le RAG citer l'ancienne valeur jusqu'au prochain `rag:build` —
 * c'est-à-dire jusqu'au prochain créneau où l'on accepte quinze minutes
 * d'embedding et le risque qu'interdit la règle 9 du dépôt (« ne jamais
 * lancer rag:build au premier plan ou sur le service de prod »). Une fiche
 * corrigée sur le site restait donc fausse dans les réponses du bot.
 *
 * Le script n'embarque plus rien en local et n'écrit plus `rag_chunks` /
 * `vec_chunks` : il délègue à `rag-sync-aphrody.ts`, qui envoie les chunks
 * rendus de chaque source à `POST /api/v1/shenron/rag/ingest` (Aphrody embarque
 * et indexe) sous une génération, puis la valide par
 * `POST /api/v1/shenron/rag/sync/finish` (retrait des disparus après contrôle
 * du compte). Une source inchangée (manifeste) n'est pas renvoyée.
 *
 * Toutes les sources sont rendues depuis PostgreSQL, la source de vérité, par
 * `_rag-sources-pg.ts` — le même rendu que le build complet. Le réplica SQLite
 * n'en porte qu'une projection (ni articles, ni sections de fiches, ni `visible`
 * sur les personnages).
 *
 * SIMULATION PAR DÉFAUT.
 *
 * Usage :
 *   bun apps/shenron/bot/scripts/rag-resync-entites.ts --liste
 *   bun apps/shenron/bot/scripts/rag-resync-entites.ts db_characters
 *   bun apps/shenron/bot/scripts/rag-resync-entites.ts db_characters --appliquer
 *   bun apps/shenron/bot/scripts/rag-resync-entites.ts databooks --appliquer
 *   bun apps/shenron/bot/scripts/rag-resync-entites.ts --toutes --appliquer
 *   bun apps/shenron/bot/scripts/rag-resync-entites.ts --reparer --appliquer
 */
import { PG_SOURCES } from "./_rag-sources-pg";
import { warnIgnoredEmbedBaseUrl } from "@shenron/pipeline/ai/config";

const args = process.argv.slice(2);
const TOUTES = args.includes("--toutes");
const LISTE = args.includes("--liste");
const REPARER = args.includes("--reparer");
const CIBLES = args.filter((a) => !a.startsWith("--"));
const SOURCES = Object.keys(PG_SOURCES);

if (LISTE || (CIBLES.length === 0 && !TOUTES && !REPARER)) {
	console.log(`Sources resynchronisables :\n  ${SOURCES.join("\n  ")}`);
	console.log(
		"\n  --toutes pour synchroniser toutes les sources · --reparer pour forcer une passe complète · --appliquer pour écrire · --report=PATH pour un rapport JSON\n"
	);
	process.exit(LISTE ? 0 : 1);
}
const inconnues = CIBLES.filter((c) => !SOURCES.includes(c));
if (inconnues.length > 0) {
	console.error(`✗ Source inconnue : ${inconnues.join(", ")}. Connues : ${SOURCES.join(", ")}.`);
	process.exit(1);
}

// Embeddings et index : uniquement Aphrody (/api/v1/shenron/rag/ingest puis /rag/sync/finish).
warnIgnoredEmbedBaseUrl(process.env);
if (REPARER && !TOUTES && CIBLES.length === 0) process.argv.push("--toutes");
await import("./rag-sync-aphrody.ts");
process.exit(process.exitCode ?? 0);
