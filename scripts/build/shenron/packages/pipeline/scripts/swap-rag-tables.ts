/**
 * swap-rag-tables.ts — Bascule les tables RAG fraîchement construites (sur une
 * copie) dans la base live du bot, sans rebuild sur la prod. À exécuter **bot
 * arrêté** : `systemctl stop shenron && bun scripts/swap-rag-tables.ts && systemctl start shenron`.
 *
 * Remplace rag_chunks (FTS5) + vec_chunks (vec0) + rag_meta en préservant les
 * rowid (alignement chunk↔vecteur). Source = $RAG_COPY (défaut /tmp/ragbuild.db).
 */
import { Database } from "bun:sqlite";
import * as sqliteVec from "sqlite-vec";
import { join } from "node:path";

const LIVE = join(import.meta.dir, "..", "data", "bot.db");
const COPY = process.env.RAG_COPY ?? "/tmp/ragbuild.db";
const EMBED_DIM = 384;

const db = new Database(LIVE);
sqliteVec.load(db);
db.run("PRAGMA busy_timeout=30000");
db.run(`ATTACH '${COPY}' AS src`);

const srcChunks = (db.query("SELECT count(*) n FROM src.rag_chunks").get() as { n: number }).n;
const srcVec = (db.query("SELECT count(*) n FROM src.vec_chunks").get() as { n: number }).n;
console.log(`source: rag_chunks=${srcChunks} vec_chunks=${srcVec}`);
if (srcChunks === 0 || srcVec === 0) {
	console.error("✗ copie vide — abandon (pas de swap)");
	process.exit(1);
}

db.exec("BEGIN");
// rag_chunks (FTS5)
db.run("DROP TABLE IF EXISTS rag_chunks");
db.run(
	"CREATE VIRTUAL TABLE rag_chunks USING fts5(kind, title, url, content, lang, source_id, entity, tokenize='unicode61 remove_diacritics 2')"
);
db.run(
	"INSERT INTO rag_chunks(rowid, kind, title, url, content, lang, source_id, entity) SELECT rowid, kind, title, url, content, lang, source_id, entity FROM src.rag_chunks"
);
// vec_chunks (vec0)
db.run("DROP TABLE IF EXISTS vec_chunks");
db.run(`CREATE VIRTUAL TABLE vec_chunks USING vec0(embedding float[${EMBED_DIM}])`);
db.run("INSERT INTO vec_chunks(rowid, embedding) SELECT rowid, embedding FROM src.vec_chunks");
// rag_meta
db.run("DROP TABLE IF EXISTS rag_meta");
db.run("CREATE TABLE rag_meta (model TEXT, dim INTEGER, count INTEGER, built_at INTEGER)");
db.run("INSERT INTO rag_meta SELECT model, dim, count, built_at FROM src.rag_meta");
db.exec("COMMIT");
db.run("DETACH src");

const c = (db.query("SELECT count(*) n FROM rag_chunks").get() as { n: number }).n;
const v = (db.query("SELECT count(*) n FROM vec_chunks").get() as { n: number }).n;
console.log(`✓ swap terminé : rag_chunks=${c} vec_chunks=${v}`);
db.close();
