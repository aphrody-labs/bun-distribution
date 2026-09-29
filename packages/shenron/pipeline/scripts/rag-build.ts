/**
 * rag-build.ts — Construit l'index de recherche RAG (FTS5 + vecteurs) Dragon Ball.
 *
 * Sources :
 *   - PostgreSQL (source de vérité) via `_rag-sources-pg.ts` : fiches, articles,
 *     sections, variantes, piliers (combats, objets, dragons, vœux, chronologie,
 *     puissances, lieux, tournois, doublage, musiques), références canon, pages
 *     éditoriales, planches manga citables et databooks — le MÊME rendu que
 *     `rag-resync-entites.ts`, qui entretient l'index à chaud ;
 *   - corpus scrapé `data/rag/corpus.json` (Kanzenshuu…) et Xenoverse 2 ;
 *   - corpus d'auteur `.aphrody` (`data/rag/corpus-aphrody.json`).
 *
 * Récupération HYBRIDE : BM25 lexical (`rag_chunks`) + embeddings denses
 * multilingues (`vec_chunks`, multilingual-e5-small via le sidecar). DROP +
 * recreate : ne JAMAIS lancer sur la base servie (cf. docs/rag-enrichment.md,
 * procédure copy-swap) — pour une mise à jour à chaud, `rag-resync-entites.ts`.
 *
 * Usage : RAG_DB=/tmp/ragbuild.db bun apps/shenron/bot/scripts/rag-build.ts [--no-vectors]
 */
import { Database } from "bun:sqlite";
import * as sqliteVec from "sqlite-vec";
import postgres from "postgres";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { ShenronEmbeddingsClient } from "@shenron/pipeline/aphrody";
import { PG_SOURCES, resolveEntity, urlPostgres } from "./_rag-sources-pg";
import { CORPUS_DIR, loadCorpusDocs, renderCorpusDocs } from "./_rag-corpus-sources";
import {
	repoRootFromScript,
	requireEmbedBaseUrl,
	requireOfflineRagDb,
	requireScriptEmbeddingSpace,
} from "./lib/script-env";

if (process.env.RAG_BACKEND === "aphrody") {
	if (!process.argv.includes("--toutes")) process.argv.push("--toutes");
	if (!process.argv.includes("--dry-run") && !process.argv.includes("--appliquer")) process.argv.push("--appliquer");
	await import("./rag-sync-aphrody.ts");
	process.exit(process.exitCode ?? 0);
}

// Règle 9 (CLAUDE.md) : DROP + recreate — RAG_DB explicite, jamais la base servie.
// B13 : l'embedder n'a pas d'adresse par défaut (sauf --no-vectors).
// Espace d'embedding : celui du contrat (index shenron-rag), jamais un autre.
let DBP: string;
let embed: ReturnType<typeof requireEmbedBaseUrl> | null = null;
let space: ReturnType<typeof requireScriptEmbeddingSpace>;
try {
	DBP = requireOfflineRagDb(process.env, repoRootFromScript(import.meta.url));
	space = requireScriptEmbeddingSpace(process.env);
	if (!process.argv.includes("--no-vectors")) embed = requireEmbedBaseUrl(process.env);
} catch (error) {
	console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
}
const EMBED_MODEL = space.model;
const EMBED_DIM = space.dimensions;

if (!existsSync(DBP)) {
	console.error(`✗ Base RAG introuvable : ${DBP}`);
	process.exit(1);
}

const db = new Database(DBP);
sqliteVec.load(db);

db.run(`DROP TABLE IF EXISTS rag_chunks`);
db.run(
	`CREATE VIRTUAL TABLE rag_chunks USING fts5(kind, title, url, content, lang, source_id, entity, tokenize='unicode61 remove_diacritics 2')`
);
const ins = db.query(
	`INSERT INTO rag_chunks (kind, title, url, content, lang, source_id, entity) VALUES (?, ?, ?, ?, ?, ?, ?)`
);

let n = 0;
const add = (kind: string, title: string, url: string, content: string, lang: string, sourceId: string, entity: string) => {
	const c = (content || "").replace(/\s+/g, " ").trim();
	if (c.length < 12) return;
	ins.run(kind, title || "", url || "", c, lang, sourceId, entity || resolveEntity(title) || resolveEntity(c));
	n++;
};

// ── PostgreSQL ──────────────────────────────────────────────────────────────
const sql = postgres(await urlPostgres(), { max: 2, prepare: false });
try {
	for (const [sourceId, rendu] of Object.entries(PG_SOURCES)) {
		let chunks;
		try {
			chunks = await rendu(sql);
		} catch (error) {
			console.warn(`⚠ ${sourceId} ignoré : ${error instanceof Error ? error.message : String(error)}`);
			continue;
		}
		db.transaction(() => {
			for (const c of chunks) add(c.kind, c.title, c.url, c.content, c.lang, sourceId, c.entity);
		})();
		console.log(`✓ ${sourceId} : ${chunks.length} chunks`);
	}
} finally {
	await sql.end();
}

// ── Corpus scrapé (Kanzenshuu…), Xenoverse 2 et corpus d'auteur ────────────
const scraped = ["corpus.json", "corpus-xv2.json"].flatMap((name) => {
	const path = resolve(CORPUS_DIR, name);
	const docs = loadCorpusDocs(path);
	if (!docs) console.warn(`⚠ ${path} introuvable, ignoré.`);
	return docs ?? [];
});
const renderedScraped = renderCorpusDocs(scraped);
db.transaction(() => {
	for (const c of renderedScraped.passages) add(c.kind, c.title, c.url, c.content, c.lang, c.sourceId, c.entity);
})();
console.log(`✓ corpus scrapé : ${scraped.length} documents`);
if (renderedScraped.refusedFandom > 0) console.warn(`⚠ ${renderedScraped.refusedFandom} document(s) Fandom refusés (source interdite).`);

const author = loadCorpusDocs(resolve(CORPUS_DIR, "corpus-aphrody.json"));
if (author) {
	const renderedAuthor = renderCorpusDocs(author, true);
	db.transaction(() => {
		for (const c of renderedAuthor.passages) add(c.kind, c.title, c.url, c.content, c.lang, c.sourceId, c.entity);
	})();
	console.log(`✓ corpus d'auteur : ${author.length} documents`);
}

console.log(`✓ rag_chunks construit : ${n} chunks.`);

// ── Embeddings denses ───────────────────────────────────────────────────────
db.run(`DROP TABLE IF EXISTS vec_chunks`);
db.run(`CREATE VIRTUAL TABLE vec_chunks USING vec0(embedding float[${EMBED_DIM}])`);
db.run(`CREATE TABLE IF NOT EXISTS rag_meta (model TEXT, dim INTEGER, count INTEGER, built_at INTEGER)`);

if (process.argv.includes("--no-vectors")) {
	console.log("→ --no-vectors : vec_chunks laissé vide (mode lexical BM25).");
	db.close();
	process.exit(0);
}

const chunks = db.query(`SELECT rowid, title, content FROM rag_chunks ORDER BY rowid`).all() as {
	rowid: number;
	title: string;
	content: string;
}[];
if (!embed) throw new Error("embedder non configuré");
const embeddingsClient = new ShenronEmbeddingsClient({ baseUrl: embed.baseUrl });
console.log(`→ embeddings via ${embed.baseUrl} (${embed.name}) sur ${chunks.length} chunks…`);
const t0 = Date.now();
const BATCH = 32;
const CONCURRENCE = 4;
const vectors: Float32Array[] = Array.from({ length: chunks.length });
let prochain = 0;
let faits = 0;

async function worker(): Promise<void> {
	for (;;) {
		const debut = prochain;
		prochain += BATCH;
		if (debut >= chunks.length) return;
		const lot = chunks.slice(debut, debut + BATCH).map((c) => `${c.title}. ${c.content}`.slice(0, 1200));
		for (let essais = 15; ; essais--) {
			try {
				const vs = await embeddingsClient.embed(lot, "passage", { timeoutMs: 120_000 });
				vs.forEach((v, j) => {
					vectors[debut + j] = new Float32Array(v);
				});
				break;
			} catch (err) {
				if (essais <= 1) {
					console.error(`\n✗ Échec d'embedding du lot ${debut} :`, err);
					process.exit(1);
				}
				await Bun.sleep(1000);
			}
		}
		faits += lot.length;
		process.stdout.write(`\r  embeddings : ${((faits / chunks.length) * 100).toFixed(1)} % (${faits}/${chunks.length})`);
	}
}
await Promise.all(Array.from({ length: CONCURRENCE }, () => worker()));
console.log("");

const insVec = db.query(`INSERT INTO vec_chunks (rowid, embedding) VALUES (?, ?)`);
db.transaction(() => {
	for (let i = 0; i < chunks.length; i++) insVec.run(chunks[i]!.rowid, vectors[i]!);
})();
db.run(`DELETE FROM rag_meta`);
db.query(`INSERT INTO rag_meta (model, dim, count, built_at) VALUES (?, ?, ?, ?)`).run(
	EMBED_MODEL,
	EMBED_DIM,
	vectors.length,
	Date.now()
);
console.log(`✓ vec_chunks : ${vectors.length} vecteurs en ${Math.round((Date.now() - t0) / 1000)} s.`);
db.close();
