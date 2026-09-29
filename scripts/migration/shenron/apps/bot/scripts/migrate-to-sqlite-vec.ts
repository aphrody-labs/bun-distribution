/**
 * migrate-to-sqlite-vec.ts — Migre la table rag_vectors existante vers la table virtuelle vec_chunks (sqlite-vec).
 * Évite de ré-embedder tout le corpus de zéro (gain de 1h de calcul CPU).
 *
 * Usage : bun apps/bot/scripts/migrate-to-sqlite-vec.ts
 */
import { Database } from "bun:sqlite";
import * as sqliteVec from "sqlite-vec";
import { existsSync } from "node:fs";

const DBP = process.env.RAG_DB ?? new URL("../../data/bot.db", import.meta.url).pathname;

if (!existsSync(DBP)) {
	console.error(`✗ Base de données introuvable : ${DBP}`);
	process.exit(1);
}

const db = new Database(DBP);
sqliteVec.load(db);

console.log("-> Début de la migration vers sqlite-vec...");

// 1. Vérifier si l'ancienne table rag_vectors existe
const hasOldTable = db
	.query("SELECT name FROM sqlite_master WHERE type='table' AND name='rag_vectors'")
	.get();

if (!hasOldTable) {
	console.log("✗ L'ancienne table rag_vectors n'existe pas ou a déjà été migrée.");
	db.close();
	process.exit(0);
}

// 2. Créer la table virtuelle vec_chunks si elle n'existe pas
db.run("DROP TABLE IF EXISTS vec_chunks");
db.run("CREATE VIRTUAL TABLE vec_chunks USING vec0(embedding float[384])");

// 3. Lire les vecteurs de rag_vectors et les insérer dans vec_chunks
const rows = db.query("SELECT rowid, vec FROM rag_vectors ORDER BY rowid").all() as {
	rowid: number;
	vec: Uint8Array;
}[];

console.log(`→ Migration de ${rows.length} vecteurs...`);

const ins = db.query("INSERT INTO vec_chunks (rowid, embedding) VALUES (?, ?)");
const tx = db.transaction(() => {
	for (const r of rows) {
		// Reconstruire le Float32Array depuis le buffer
		const f32 = new Float32Array(r.vec.buffer, r.vec.byteOffset, r.vec.byteLength / 4);
		ins.run(r.rowid, f32);
	}
});
tx();

// 4. Supprimer la table temporaire/ancienne rag_vectors
db.run("DROP TABLE IF EXISTS rag_vectors");

console.log("✓ Migration vers sqlite-vec terminée avec succès !");
db.close();
