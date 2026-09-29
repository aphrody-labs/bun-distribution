/**
 * rag-embed-vectors.ts — (re)calcule UNIQUEMENT le volet dense `vec_chunks` à
 * partir d'un `rag_chunks` DÉJÀ construit, sans toucher à `rag_chunks`.
 *
 * Pourquoi : `rag:build` reconstruit TOUT (DROP rag_chunks → re-chunk → embed),
 * ce qui exige soit l'arrêt du bot (downtime), soit un DROP DDL qui gèle ses
 * handlers. Ici on ne fait aucune DDL sur `rag_chunks` (la table lexicale que le
 * bot interroge) : pendant les ~minutes d'embedding le script ne tient AUCUN
 * verrou d'écriture (il ne fait que des appels HTTP au sidecar), le bot continue
 * de servir en mode lexical, et l'insertion finale de `vec_chunks` est atomique
 * (bascule nette lexical → hybride). À utiliser quand `rag_chunks` est bon mais
 * `vec_chunks` est vide/périmé (cf. après un `fix-*`/rebuild interrompu).
 *
 * Usage : bun apps/bot/scripts/rag-embed-vectors.ts
 *   RAG_DB (copie hors service, obligatoire) et EMBED_URL ou
 *   APHRODY_SHENRON_EMBED_BASE_URL (obligatoire, aucun défaut).
 */
import { Database } from "bun:sqlite";
import * as sqliteVec from "sqlite-vec";
import { ShenronEmbeddingsClient } from "@shenron/pipeline/aphrody";
import {
	ragMetaOf,
	repoRootFromScript,
	requireEmbedBaseUrl,
	requireOfflineRagDb,
	requireScriptEmbeddingSpace,
} from "./lib/script-env";

// Règle 9 (CLAUDE.md) : RAG_DB explicite, jamais la base servie ; B13 : embedder sans défaut.
let DBP: string;
let embed: ReturnType<typeof requireEmbedBaseUrl>;
try {
	DBP = requireOfflineRagDb(process.env, repoRootFromScript(import.meta.url));
	embed = requireEmbedBaseUrl(process.env);
} catch (error) {
	console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
}
const EMBED_URL = embed.baseUrl;
const embeddingsClient = new ShenronEmbeddingsClient({ baseUrl: embed.baseUrl });
const BATCH_SIZE = Number(process.env.EMBED_BATCH_SIZE ?? 64);
const CONCURRENCY = Number(process.env.EMBED_CONCURRENCY ?? 6);

const db = new Database(DBP);
db.run("PRAGMA busy_timeout = 15000"); // tolère les verrous brefs du bot live
sqliteVec.load(db);

// Jamais deux espaces d'embedding dans un index : contrat shenron-rag et rag_meta existant.
let space: ReturnType<typeof requireScriptEmbeddingSpace>;
try {
	space = requireScriptEmbeddingSpace(process.env, ragMetaOf(db));
} catch (error) {
	console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
}
const EMBED_MODEL = space.model;
const EMBED_DIM = space.dimensions;

const chunkCount = (db.query("SELECT count(*) c FROM rag_chunks").get() as { c: number }).c;
if (chunkCount === 0) {
	console.error("✗ rag_chunks vide — lancer d'abord `rag:build`.");
	process.exit(1);
}

const chunks = db.query("SELECT rowid, title, content FROM rag_chunks ORDER BY rowid").all() as {
	rowid: number;
	title: string;
	content: string;
}[];
const texts = chunks.map((c) => `${c.title}. ${c.content}`.slice(0, 1200));
const vectors: Float32Array[] = Array.from({ length: texts.length });

console.log(
	`→ embeddings via sidecar (${EMBED_URL}) sur ${chunks.length} chunks (sans toucher rag_chunks)…`
);
const t0 = Date.now();

const queue: { index: number; batchTexts: string[] }[] = [];
for (let i = 0; i < texts.length; i += BATCH_SIZE) {
	queue.push({ index: i, batchTexts: texts.slice(i, i + BATCH_SIZE) });
}
const totalBatches = queue.length;
let done = 0;

async function worker(): Promise<void> {
	while (queue.length > 0) {
		const item = queue.shift();
		if (!item) continue;
		let retries = 15;
		let batchVectors: Float32Array[] = [];
		for (;;) {
			try {
				const data = await embeddingsClient.embed(item.batchTexts, "passage", { timeoutMs: 120_000 });
				batchVectors = data.map((vector) => new Float32Array(vector));
				break;
			} catch (err) {
				if (--retries <= 0) {
					console.error(`\n✗ Échec embedding lot ${item.index}:`, err);
					process.exit(1);
				}
				await new Promise((r) => setTimeout(r, 1000));
			}
		}
		for (let j = 0; j < batchVectors.length; j++) vectors[item.index + j] = batchVectors[j];
		if (++done % 10 === 0 || done === totalBatches) {
			process.stdout.write(
				`\r  embedding ${((done / totalBatches) * 100).toFixed(1)}% (${done}/${totalBatches} lots)`
			);
		}
	}
}

await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
console.log(
	`\n✓ Embeddings calculés en ${Math.round((Date.now() - t0) / 1000)}s. Insertion atomique…`
);

// Insertion atomique : le bot bascule en une fois de lexical → hybride.
db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(embedding float[${EMBED_DIM}])`);
const insVec = db.query("INSERT INTO vec_chunks (rowid, embedding) VALUES (?, ?)");
db.transaction(() => {
	db.run("DELETE FROM vec_chunks");
	for (let i = 0; i < chunks.length; i++) insVec.run(chunks[i].rowid, vectors[i]);
})();

db.run(
	"CREATE TABLE IF NOT EXISTS rag_meta (model TEXT, dim INTEGER, count INTEGER, built_at INTEGER)"
);
db.run("DELETE FROM rag_meta");
db.query("INSERT INTO rag_meta (model, dim, count, built_at) VALUES (?, ?, ?, ?)").run(
	EMBED_MODEL,
	EMBED_DIM,
	vectors.length,
	Date.now()
);
console.log(`✓ vec_chunks : ${vectors.length} vecteurs insérés. Hybride restauré.`);
db.close();
