/**
 * rag-embed-vectors.ts — publie dans le RAG Aphrody les chunks d'un `rag_chunks`
 * SQLite DÉJÀ construit, sans toucher à ce `rag_chunks`.
 *
 * Plus aucun embedding ni écriture de `vec_chunks` en local : chaque chunk est
 * envoyé à `POST /api/v1/shenron/rag/ingest` (Aphrody l'embarque dans l'espace
 * du contrat `shenron-rag` et confirme `vectorIndexed`), regroupé par
 * `source_id` sous une génération, puis la génération est validée par
 * `POST /api/v1/shenron/rag/sync/finish` (Aphrody vérifie le compte avant de
 * retirer l'ancienne génération). La base SQLite n'est ouverte qu'en lecture.
 *
 * Usage : bun packages/shenron/pipeline/scripts/rag-embed-vectors.ts
 *   RAG_DB (copie hors service, obligatoire), APHRODY_AI_HTTP_URL et
 *   APHRODY_AI_HTTP_TOKEN (ou leurs alias ; obligatoires, aucun défaut).
 */
import { Database } from "bun:sqlite";
import { AphrodyComputeClient } from "@shenron/pipeline/aphrody";
import { warnIgnoredEmbedBaseUrl } from "@shenron/pipeline/ai/config";
import { syncSource, type SyncResult } from "./_rag-aphrody-sync";
import type { SourceChunk } from "./_rag-sources-pg";
import {
	ragMetaOf,
	repoRootFromScript,
	requireAphrodyApiUrl,
	requireOfflineRagDb,
	requireScriptEmbeddingSpace,
} from "./lib/script-env";

const FALLBACK_SOURCE = "local_index";
const CONCURRENCY = Math.max(1, Math.min(16, Number(process.env.EMBED_CONCURRENCY ?? 6) || 6));

// Règle 9 (CLAUDE.md) : RAG_DB explicite, jamais la base servie ; B13 : API Aphrody sans défaut.
let DBP: string;
let client: AphrodyComputeClient;
try {
	DBP = requireOfflineRagDb(process.env, repoRootFromScript(import.meta.url));
	requireAphrodyApiUrl(process.env);
	warnIgnoredEmbedBaseUrl(process.env);
	client = new AphrodyComputeClient();
} catch (error) {
	console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
}

const db = new Database(DBP, { readonly: true });
db.run("PRAGMA busy_timeout = 15000");

// Jamais deux espaces d'embedding : contrat shenron-rag et rag_meta existant.
try {
	requireScriptEmbeddingSpace(process.env, ragMetaOf(db));
} catch (error) {
	console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
}

const rows = db
	.query(
		"SELECT kind, title, url, content, lang, source_id, entity FROM rag_chunks ORDER BY rowid"
	)
	.all() as {
	kind: string | null;
	title: string | null;
	url: string | null;
	content: string | null;
	lang: string | null;
	source_id: string | null;
	entity: string | null;
}[];
db.close();
if (rows.length === 0) {
	console.error("✗ rag_chunks vide — lancer d'abord `rag:build`.");
	process.exit(1);
}

const groups = new Map<string, SourceChunk[]>();
let skipped = 0;
for (const row of rows) {
	if (!row.title?.trim() || !row.content?.trim() || !row.url?.trim()) {
		skipped++;
		continue;
	}
	const source = row.source_id && /^[a-z0-9_]{1,64}$/.test(row.source_id) ? row.source_id : FALLBACK_SOURCE;
	const group = groups.get(source) ?? [];
	group.push({
		kind: row.kind?.trim() || "passage",
		title: row.title,
		url: row.url,
		content: row.content,
		lang: row.lang?.trim() || "fr",
		entity: row.entity ?? "",
	});
	groups.set(source, group);
}
if (skipped > 0) console.warn(`⚠ ${skipped} chunks sans titre, URL ou contenu ignorés.`);

if (!(await client.health()).rag) {
	console.error("✗ RAG Aphrody indisponible.");
	process.exit(1);
}

console.log(`→ ingestion Aphrody de ${rows.length - skipped} chunks (${groups.size} sources)…`);
const t0 = Date.now();
const results: SyncResult[] = [];
let failed = false;
for (const [source, chunks] of groups) {
	try {
		const { result } = await syncSource(client, source, chunks, undefined, {
			apply: true,
			force: true,
			concurrency: CONCURRENCY,
			requireVectors: true,
		});
		results.push(result);
		console.log(`✓ ${source} : ${result.indexed} indexés, ${result.retired} retirés.`);
	} catch (error) {
		failed = true;
		console.error(`✗ ${source} : ${error instanceof Error ? error.message : String(error)}`);
	}
}
const indexed = results.reduce((n, r) => n + r.indexed, 0);
console.log(
	`${failed ? "✗" : "✓"} ${indexed} chunks indexés avec vecteurs par Aphrody en ${Math.round((Date.now() - t0) / 1000)}s.`
);
if (failed) process.exitCode = 1;
