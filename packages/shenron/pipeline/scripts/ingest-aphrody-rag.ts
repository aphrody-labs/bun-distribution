/**
 * ingest-aphrody-rag.ts — verse le corpus d'auteur `.aphrody` dans le RAG.
 *
 * Pourquoi : les déclarations d'Akira Toriyama et les guides Shueisha traduits
 * par Kanzenshuu vivent dans `~/.aphrody/workspace/memory`. Le site en tire
 * déjà les citations de `/wiki/canon` (`canon-charge-aphrody.ts`), mais le RAG,
 * lui, ne les avait jamais vues : `rag_ask` pouvait citer un databook ou une
 * fiche wiki, jamais l'auteur lui-même. Ce script comble ce trou.
 *
 * La liste des documents admis n'est pas redéfinie ici : elle est importée du
 * site (`DOCUMENTS`, `REFUSÉ`). Une source ajoutée là-bas entre dans le RAG au
 * prochain passage, et un miroir de wiki de fans reste refusé aux deux endroits
 * — la règle est écrite une fois.
 *
 * Deux sorties, selon le besoin :
 *   - `data/rag/corpus-aphrody.json`, relu par `rag:build` (build complet) ;
 *   - `--injecte`, qui écrit directement dans `rag_chunks` du SQLite runtime et
 *     n'embarque QUE les nouveaux chunks dans `vec_chunks`. C'est la voie à
 *     chaud : pas de DDL sur `rag_chunks`, donc pas d'arrêt du bot, et pas de
 *     ré-embedding des 31 000 chunks déjà présents.
 *
 * Idempotent : `--injecte` purge d'abord `source_id = 'aphrody'`.
 *
 * Usage :
 *   bun apps/shenron/bot/scripts/ingest-aphrody-rag.ts              # corpus + rapport
 *   bun apps/shenron/bot/scripts/ingest-aphrody-rag.ts --injecte    # + écriture à chaud
 */
import { Database } from "bun:sqlite";
import * as sqliteVec from "sqlite-vec";
import { ShenronEmbeddingsClient } from "@shenron/pipeline/aphrody";
import { readdir } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chunkDocument } from "./_rag-chunk";
import { DOCUMENTS, REFUSÉ } from "../../../../apps/shenron/site/scripts/_aphrody-corpus";
import {
	ragMetaOf,
	repoRootFromScript,
	requireEmbedBaseUrl,
	requireScriptEmbeddingSpace,
	servedBotDbPath,
} from "./lib/script-env";

// B6 : racine dérivée par fileURLToPath (URL.pathname est faux sous Windows).
const ROOT = join(repoRootFromScript(import.meta.url), "apps", "bot");
const OUT = join(ROOT, "data/rag/corpus-aphrody.json");
const DBP = process.env.RAG_DB ?? servedBotDbPath(repoRootFromScript(import.meta.url));
const INJECTE = process.argv.includes("--injecte");
const SOURCE_ID = "aphrody";

/** `/wiki/canon` est la page qui expose ces déclarations au lecteur. */
const URL_CANON = "https://dragonballfr.com/wiki/canon";

async function corpusDir(): Promise<string> {
	const candidats = [
		process.env.APHRODY_HOME,
		join(homedir(), ".aphrody", "workspace"),
		join(homedir(), ".aphrody", "workspaces", "dbfr"),
	].filter((c): c is string => Boolean(c));
	for (const base of candidats) {
		if (await Bun.file(join(base, "ai.json")).exists()) return join(base, "memory");
	}
	console.error(`✗ Corpus .aphrody introuvable (essayés : ${candidats.join(", ")}).`);
	process.exit(1);
}

/**
 * Le markdown, débarrassé de ce qui ne se cite pas.
 *
 * Les fichiers `.aphrody` portent un en-tête de provenance (chemin d'origine,
 * date d'indexation) : indexé, il ferait remonter le nom d'un dossier du dépôt
 * sur une question posée à Toriyama.
 */
function nettoie(markdown: string): string {
	return markdown
		.replace(/^---\n[\s\S]*?\n---\n/, "")
		.replace(/<sup\b[^>]*>[^<]*<\/sup>/gi, "")
		.replace(/!\[[^\]]*\]\([^)]*\)/g, "")
		.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
		.replace(/[ \t]+\n/g, "\n")
		.trim();
}

const memoire = await corpusDir();
const fichiers = await readdir(memoire);

interface Doc {
	id: string;
	name: string;
	url: string;
	markdown: string;
	lang: string;
}

const docs: Doc[] = [];
const vus = new Set<string>();
const absents: string[] = [];

for (const [i, document] of DOCUMENTS.entries()) {
	const trouves = fichiers.filter((f) => f.startsWith(document.motif));
	if (trouves.length === 0) {
		absents.push(document.motif);
		continue;
	}
	for (const fichier of trouves) {
		// Le garde-fou de doctrine, rejoué ici : un miroir de wiki de fans ne
		// devient pas admissible parce qu'il a été ajouté à la liste.
		if (REFUSÉ.test(fichier)) {
			console.warn(`⚠ refusé (source interdite) : ${fichier}`);
			continue;
		}
		const brut = await Bun.file(join(memoire, fichier)).text();
		const markdown = nettoie(brut);
		if (markdown.length < 200) continue;
		// Le même guide existe en version française curée ET en traduction
		// Kanzenshuu : deux entrées légitimes, mais le même fichier atteint par
		// deux motifs ne doit pas être chunké deux fois.
		const empreinte = Bun.hash(markdown).toString(16);
		if (vus.has(empreinte)) continue;
		vus.add(empreinte);
		docs.push({
			id: `aphrody-${i}-${fichier.replace(/\.md$/, "")}`,
			name: document.annee ? `${document.source} (${document.annee})` : document.source,
			url: URL_CANON,
			markdown,
			lang: document.lang,
		});
	}
}

if (docs.length === 0) {
	console.error("✗ Aucun document admis lu — corpus inchangé.");
	process.exit(1);
}

interface ChunkPret {
	title: string;
	url: string;
	content: string;
	lang: string;
}
const chunks: ChunkPret[] = [];
for (const d of docs) {
	for (const c of chunkDocument(d.markdown, 1400, 0.15)) {
		const contenu = c.content.replace(/\s+/g, " ").trim();
		if (contenu.length < 120) continue;
		chunks.push({ title: d.name, url: d.url, content: contenu, lang: d.lang });
	}
}

writeFileSync(OUT, JSON.stringify({ docs }, null, 0));
console.log(`✓ ${docs.length} documents .aphrody → ${chunks.length} chunks → ${OUT}`);
for (const d of docs) console.log(`  · ${d.name} [${d.lang}] ${d.markdown.length} car.`);
if (absents.length > 0) console.warn(`⚠ motifs sans fichier : ${absents.join(", ")}`);

if (!INJECTE) {
	console.log("→ simulation : relancer avec --injecte pour écrire dans rag_chunks.");
	process.exit(0);
}

if (process.env.RAG_BACKEND === "aphrody") {
	const sync = Bun.spawn(
		[process.execPath, join(import.meta.dir, "rag-sync-aphrody.ts"), SOURCE_ID, "--appliquer", "--force"],
		{ stdout: "inherit", stderr: "inherit", env: process.env }
	);
	process.exit(await sync.exited);
}

// ── Écriture à chaud ────────────────────────────────────────────────────────

// B13 : aucune adresse d'embedder par défaut ; vérifié avant toute écriture.
let embed: ReturnType<typeof requireEmbedBaseUrl>;
try {
	embed = requireEmbedBaseUrl(process.env);
} catch (error) {
	console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
}
const EMBED_URL = embed.baseUrl;
const embeddingsClient = new ShenronEmbeddingsClient({ baseUrl: embed.baseUrl });

const db = new Database(DBP);
db.run("PRAGMA busy_timeout = 15000");
sqliteVec.load(db);
// Jamais deux espaces d'embedding dans un index : contrat shenron-rag et rag_meta existant.
try {
	requireScriptEmbeddingSpace(process.env, ragMetaOf(db));
} catch (error) {
	console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
}

const avant = (db.query("SELECT count(*) c FROM rag_chunks").get() as { c: number }).c;
const ancien = db
	.query("SELECT rowid FROM rag_chunks WHERE source_id = ?")
	.all(SOURCE_ID) as { rowid: number }[];

db.run("BEGIN");
for (const { rowid } of ancien) {
	db.run("DELETE FROM vec_chunks WHERE rowid = ?", [rowid]);
	db.run("DELETE FROM rag_chunks WHERE rowid = ?", [rowid]);
}
const ins = db.prepare(
	`INSERT INTO rag_chunks (kind, title, url, content, lang, source_id, entity) VALUES ('author', ?, ?, ?, ?, ?, '')`
);
const rowids: number[] = [];
for (const c of chunks) {
	const { lastInsertRowid } = ins.run(c.title, c.url, c.content, c.lang, SOURCE_ID);
	rowids.push(Number(lastInsertRowid));
}
db.run("COMMIT");
console.log(`✓ rag_chunks : ${ancien.length} anciens retirés, ${chunks.length} insérés (${avant} → ${
	(db.query("SELECT count(*) c FROM rag_chunks").get() as { c: number }).c
}).`);

// Seuls les nouveaux chunks passent par l'embedder : les 31 000 voisins gardent
// leurs vecteurs, le bot n'est jamais privé du volet dense.
const textes = chunks.map((c) => `${c.title}. ${c.content}`.slice(0, 1200));
const vecteurs: Float32Array[] = [];
for (let i = 0; i < textes.length; i += 64) {
	const lot = textes.slice(i, i + 64);
	let vectors: number[][];
	try {
		vectors = await embeddingsClient.embed(lot, "passage", { timeoutMs: 120_000 });
	} catch (error) {
		console.error(`✗ embedder ${EMBED_URL} : ${String(error)}. Chunks lexicaux seuls.`);
		process.exit(1);
	}
	for (const vector of vectors) vecteurs.push(new Float32Array(vector));
	console.log(`  embeddings ${Math.min(i + 64, textes.length)}/${textes.length}`);
}

db.run("BEGIN");
const insVec = db.prepare("INSERT INTO vec_chunks (rowid, embedding) VALUES (?, ?)");
for (const [i, rowid] of rowids.entries()) {
	insVec.run(rowid, new Uint8Array(vecteurs[i].buffer));
}
db.run("COMMIT");
console.log(`✓ vec_chunks : ${rowids.length} vecteurs ajoutés.`);
db.close();
