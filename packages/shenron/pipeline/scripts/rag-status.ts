#!/usr/bin/env bun
import { tempPath } from "@aphrody/paths";
/**
 * rag-status.ts — Script de diagnostic et statut du RAG et de la base Dragon Ball.
 *
 * Ce script :
 * 1. Vérifie la taille et l'existence des fichiers de base de données.
 * 2. Analyse le contenu de rag_chunks (par type, langue, source).
 * 3. Affiche les métadonnées de la table rag_meta (modèle, dim, date de compilation).
 * 4. Calcule la taille moyenne des chunks.
 * 5. Teste les embeddings via Aphrody `POST /api/v1/shenron/embed`
 *    (APHRODY_AI_HTTP_URL / APHRODY_AI_HTTP_TOKEN obligatoires).
 * 6. Compte les lignes des tables structurées principales (personnages, techniques, planètes).

 *
 * Usage : bun apps/shenron/bot/scripts/rag-status.ts
 */

import { Database } from "bun:sqlite";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as sqliteVec from "sqlite-vec";
import { AphrodyComputeClient, ShenronEmbeddingsClient } from "@shenron/pipeline/aphrody";
import { requireAphrodyApiUrl } from "./lib/script-env";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const DB_PROD = process.env.RAG_DB ?? join(ROOT, "apps/shenron/bot/data/bot.db");
const DB_TMP = tempPath("rag.db");

function formatBytes(bytes: number): string {
	if (bytes === 0) return "0 B";
	const k = 1024;
	const sizes = ["B", "KB", "MB", "GB"];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function printHeader(title: string) {
	console.log(`\n================================================================================`);
	console.log(`⚡ ${title.toUpperCase()}`);
	console.log(`================================================================================`);
}

/** Embeds one probe query through Aphrody (real round trip, token included). */
async function checkEmbeddings(
	client: ShenronEmbeddingsClient
): Promise<{ status: string; latency?: number; details?: string }> {
	const t0 = Date.now();
	try {
		const [vector] = await client.embed(["Son Goku"], "query", { timeoutMs: 3_000 });
		return { status: "ONLINE", latency: Date.now() - t0, details: `${vector?.length ?? 0} dimensions` };
	} catch (err: any) {
		return { status: "OFFLINE", details: err.message };
	}
}

function analyzeDb(dbPath: string, label: string) {
	if (!existsSync(dbPath)) {
		console.log(`❌ Base de données ${label} non trouvée à : ${dbPath}`);
		return;
	}

	const fileStats = statSync(dbPath);
	console.log(`📂 Fichier : ${dbPath}`);
	console.log(`   Taille : ${formatBytes(fileStats.size)}`);
	console.log(`   Modifié le : ${fileStats.mtime.toLocaleString()}`);

	let db: Database;
	try {
		db = new Database(dbPath, { readonly: true });
		sqliteVec.load(db);
	} catch (err: any) {
		console.log(`❌ Impossible d'ouvrir la base de données : ${err.message}`);
		return;
	}

	try {
		// 1. Métadonnées RAG
		let meta: any = null;
		try {
			meta = db.query("SELECT * FROM rag_meta LIMIT 1").get();
		} catch {}

		if (meta) {
			console.log(`\n🏷️  MÉTA-DONNÉES RAG :`);
			console.log(`   Modèle d'embeddings : ${meta.model}`);
			console.log(`   Dimensions          : ${meta.dim}`);
			console.log(`   Nombre de vecteurs  : ${meta.count}`);
			console.log(`   Indexé le           : ${new Date(meta.built_at).toLocaleString()}`);
		} else {
			console.log(`\n⚠️  Aucune méta-donnée RAG (rag_meta vide ou absente).`);
		}

		// 2. Volume de chunks
		const chunkCount = (db.query("SELECT COUNT(*) c FROM rag_chunks").get() as any).c;
		const vecCount = (db.query("SELECT COUNT(*) c FROM vec_chunks").get() as any).c;
		console.log(`\n📊 CHUNKS DANS L'INDEX :`);
		console.log(`   Total chunks (FTS5 text)    : ${chunkCount}`);
		console.log(`   Total vecteurs (sqlite-vec) : ${vecCount}`);

		if (chunkCount > 0) {
			// 3. Répartition par type (kind)
			const kinds = db
				.query("SELECT kind, COUNT(*) c FROM rag_chunks GROUP BY kind ORDER BY c DESC")
				.all() as any[];
			console.log(`\n🧩 Répartition par catégorie (kind) :`);
			for (const k of kinds) {
				console.log(`   - ${k.kind.padEnd(20)}: ${k.c.toString().padStart(6)} chunks`);
			}

			// 4. Répartition par langue (lang)
			const langs = db
				.query("SELECT lang, COUNT(*) c FROM rag_chunks GROUP BY lang ORDER BY c DESC")
				.all() as any[];
			console.log(`\n🌐 Répartition par langue (lang) :`);
			for (const l of langs) {
				console.log(`   - ${l.lang.padEnd(20)}: ${l.c.toString().padStart(6)} chunks`);
			}

			// 5. Répartition par source_id (top 10)
			const sources = db
				.query(
					"SELECT source_id, COUNT(*) c FROM rag_chunks GROUP BY source_id ORDER BY c DESC LIMIT 10"
				)
				.all() as any[];
			console.log(`\n🔌 Top 10 des sources (source_id) :`);
			for (const s of sources) {
				console.log(`   - ${s.source_id.padEnd(25)}: ${s.c.toString().padStart(6)} chunks`);
			}

			// 6. Longueur moyenne des contenus
			const avgLen = (db.query("SELECT AVG(LENGTH(content)) a FROM rag_chunks").get() as any).a;
			console.log(`\n📏 Taille moyenne des chunks : ${Math.round(avgLen)} caractères`);
		}

		// 7. Statistiques des tables structurées principales
		console.log(`\n🗄️  DONNÉES STRUCTURÉES :`);
		const tables = [
			"db_characters",
			"db_planets",
			"db_races",
			"db_techniques",
			"db_transformations",
			"db_sagas",
			"db_movies",
			"db_games",
			"db_episodes",
			"db_manga_volumes",
			"db_manga_chapters",
		];

		for (const tbl of tables) {
			try {
				const count = (db.query(`SELECT COUNT(*) c FROM ${tbl}`).get() as any).c;
				console.log(`   - ${tbl.padEnd(22)}: ${count.toString().padStart(5)} enregistrements`);
			} catch {
				console.log(`   - ${tbl.padEnd(22)}: non disponible`);
			}
		}
	} catch (err: any) {
		console.log(`❌ Erreur d'analyse de la base de données : ${err.message}`);
	} finally {
		db.close();
	}
}

async function main() {
	if (process.env.RAG_BACKEND === "aphrody") {
		// B13 : aucune adresse par défaut.
		const stats = await new AphrodyComputeClient({ baseUrl: requireAphrodyApiUrl(process.env) }).ragStats();
		console.log(JSON.stringify({ backend: "aphrody", ...stats }, null, 2));
		return;
	}
	// B13 : aucune adresse par défaut ; jette si APHRODY_AI_HTTP_URL / _TOKEN manquent.
	const embeddings = new ShenronEmbeddingsClient();
	printHeader("Embeddings Aphrody");
	const sidecar = await checkEmbeddings(embeddings);
	console.log(`🔌 Status   : ${sidecar.status}`);
	if (sidecar.latency !== undefined) {
		console.log(`⏱️  Latence  : ${sidecar.latency} ms`);
	}
	console.log(`💬 Détails  : ${sidecar.details}`);
	console.log(`🔗 URL      : ${embeddings.baseUrl.origin}/api/v1/shenron/embed`);

	printHeader("Base de données active (bot.db)");
	analyzeDb(DB_PROD, "active (production)");

	if (existsSync(DB_TMP)) {
		printHeader("Base de données temporaire de build (/tmp/rag.db)");
		analyzeDb(DB_TMP, "temporaire (build)");
	}

	console.log(`\n================================================================================`);
	console.log(`⭐ Diagnostic terminé le ${new Date().toISOString()}`);
	console.log(`================================================================================\n`);
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
