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
 * Ce script ne fait aucune DDL sur `rag_chunks` : il compare les chunks rendus
 * à ceux déjà indexés, **n'embarque que les nouveaux et les modifiés**, retire
 * les disparus, et bascule les vecteurs sous transaction. Le bot continue de
 * servir pendant l'opération.
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
import { Database } from "bun:sqlite";
import * as sqliteVec from "sqlite-vec";
import postgres from "postgres";
import { join, resolve } from "node:path";
import { PG_SOURCES, urlPostgres, type SourceChunk } from "./_rag-sources-pg";
import { ShenronEmbeddingsClient } from "@shenron/pipeline/aphrody";
import { ragMetaOf, requireEmbedBaseUrl, requireScriptEmbeddingSpace } from "./lib/script-env";

const ROOT = resolve(import.meta.dir, "../../../../apps/shenron/bot");
const DBP = process.env.RAG_DB ?? join(ROOT, "data/bot.db");
// Lots modestes : le sidecar sérialise ses inférences et sert aussi la recherche
// en production. Un lot de 64 passages faisait attendre les requêtes des
// visiteurs derrière lui ; 16 garde la file courte.
const EMBED_BATCH = Number(process.env.RAG_EMBED_BATCH ?? 16);
const args = process.argv.slice(2);
const APPLIQUER = args.includes("--appliquer");
const TOUTES = args.includes("--toutes");
const LISTE = args.includes("--liste");
const REPARER = args.includes("--reparer");
const CIBLES = args.filter((a) => !a.startsWith("--"));
const REPORT_ARG = args.find((a) => a.startsWith("--report="));
const REPORT_PATH = REPORT_ARG ? resolve(REPORT_ARG.slice("--report=".length)) : undefined;

const SOURCES = Object.keys(PG_SOURCES);

if (LISTE || (CIBLES.length === 0 && !TOUTES && !REPARER)) {
	console.log(`Sources resynchronisables :\n  ${SOURCES.join("\n  ")}`);
	console.log(process.env.RAG_BACKEND === "aphrody"
		? "\n  --toutes pour synchroniser toutes les sources · --reparer pour forcer une passe complète · --appliquer pour écrire · --report=PATH pour un rapport JSON\n"
		: "\n  --toutes pour tout passer en revue · --reparer pour réaligner chunks et vecteurs · --appliquer pour écrire · --report=PATH pour un rapport JSON\n");
	process.exit(LISTE ? 0 : 1);
}
const inconnues = CIBLES.filter((c) => !SOURCES.includes(c));
if (inconnues.length > 0) {
	console.error(`✗ Source inconnue : ${inconnues.join(", ")}. Connues : ${SOURCES.join(", ")}.`);
	process.exit(1);
}

if (process.env.RAG_BACKEND === "aphrody") {
	if (REPARER && !TOUTES && CIBLES.length === 0) process.argv.push("--toutes");
	await import("./rag-sync-aphrody.ts");
	process.exit(process.exitCode ?? 0);
}

// B13 : aucune adresse d'embedder par défaut ; erreur explicite nommant la variable.
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
const sql = postgres(await urlPostgres(), { max: 2, prepare: false });

/** Clé d'identité d'un chunk : l'URL seule ne suffit pas (articles découpés, planches ja+fr). */
const cle = (c: { url: string; title: string; content: string }) =>
	`${c.url} ${c.title} ${c.content.slice(0, 80)}`;

async function embarque(textes: string[]): Promise<Float32Array[]> {
	const vecteurs: Float32Array[] = [];
	let dernierLog = Date.now();
	for (let i = 0; i < textes.length; i += EMBED_BATCH) {
		const lot = textes.slice(i, i + EMBED_BATCH);
		let essais = 5;
		for (;;) {
			try {
				const vectors = await embeddingsClient.embed(lot, "passage", { timeoutMs: 120_000 });
				for (const vector of vectors) vecteurs.push(new Float32Array(vector));
				break;
			} catch (err) {
				if (--essais === 0) throw new Error(`embedder ${EMBED_URL} : ${String(err)}`, { cause: err });
				await Bun.sleep(2000);
			}
		}
		if (Date.now() - dernierLog > 30_000) {
			console.log(`    … ${vecteurs.length}/${textes.length} vecteurs`);
			dernierLog = Date.now();
		}
	}
	return vecteurs;
}

async function resynchronise(
	source: string
): Promise<{
	source: string;
	indexed: number;
	rendered: number;
	added: number;
	removed: number;
	unchanged: number;
}> {
	const chunks: SourceChunk[] = await PG_SOURCES[source]!(sql);

	const anciens = db
		.query("SELECT rowid, title, url, content FROM rag_chunks WHERE source_id = ?")
		.all(source) as { rowid: number; title: string; url: string; content: string }[];

	const parCle = new Map<string, { rowid: number }>();
	for (const a of anciens) if (!parCle.has(cle(a))) parCle.set(cle(a), a);

	const vus = new Set<string>();
	const nouveaux: SourceChunk[] = [];
	let inchanges = 0;
	for (const c of chunks) {
		const k = cle(c);
		if (vus.has(k)) continue;
		vus.add(k);
		if (parCle.has(k)) inchanges++;
		else nouveaux.push(c);
	}
	// Doublons de clé déjà indexés : seul le premier est reconnu, les autres partent.
	const gardes = new Set([...parCle.values()].map((a) => a.rowid));
	const retires = anciens.filter((a) => !vus.has(cle(a)) || !gardes.has(a.rowid));

	// Un chunk dont le titre ou l'URL change sort d'un côté et rentre de
	// l'autre : on ne cherche pas à les apparier, le coût est le même et le
	// rapport reste lisible (ajouts + retraits plutôt qu'une modification).
	console.log(
		`→ ${source} : ${anciens.length} indexés, ${chunks.length} rendus · ` +
			`${nouveaux.length} à embarquer, ${retires.length} à retirer, ${inchanges} inchangés.`
	);
	for (const c of nouveaux.slice(0, 5)) console.log(`  + ${c.title} — ${c.url}`);
	if (nouveaux.length > 5) console.log(`  + … et ${nouveaux.length - 5} autres`);
	for (const a of retires.slice(0, 5)) console.log(`  − ${a.title} — ${a.url}`);
	if (retires.length > 5) console.log(`  − … et ${retires.length - 5} autres`);

	if (!APPLIQUER || (nouveaux.length === 0 && retires.length === 0)) {
		return {
			source,
			indexed: anciens.length,
			rendered: chunks.length,
			added: nouveaux.length,
			removed: retires.length,
			unchanged: inchanges,
		};
	}

	// Les vecteurs AVANT la transaction : si l'embedder tombe, l'index n'a pas
	// bougé d'un octet. L'inverse laisserait des chunks lexicaux sans vecteur,
	// invisibles à la recherche dense et donc silencieusement dégradés.
	const vecteurs = await embarque(nouveaux.map((c) => `${c.title}. ${c.content}`.slice(0, 1200)));

	db.run("BEGIN IMMEDIATE");
	try {
		const del = db.prepare("DELETE FROM rag_chunks WHERE rowid = ?");
		const delVec = db.prepare("DELETE FROM vec_chunks WHERE rowid = ?");
		for (const { rowid } of retires) {
			delVec.run(rowid);
			del.run(rowid);
		}
		const ins = db.prepare(
			"INSERT INTO rag_chunks (kind, title, url, content, lang, source_id, entity) VALUES (?, ?, ?, ?, ?, ?, ?)"
		);
		const insVec = db.prepare("INSERT INTO vec_chunks (rowid, embedding) VALUES (?, ?)");
		for (const [i, c] of nouveaux.entries()) {
			const { lastInsertRowid } = ins.run(c.kind, c.title, c.url, c.content, c.lang, source, c.entity);
			insVec.run(Number(lastInsertRowid), new Uint8Array(vecteurs[i]!.buffer));
		}
		db.run("COMMIT");
	} catch (err) {
		db.run("ROLLBACK");
		throw err;
	}
	console.log(`✓ ${source} : +${nouveaux.length} chunks, −${retires.length}, vecteurs à jour.`);
	return {
		source,
		indexed: anciens.length,
		rendered: chunks.length,
		added: nouveaux.length,
		removed: retires.length,
		unchanged: inchanges,
	};
}

/**
 * Réalignement chunks ↔ vecteurs. Un script qui supprime des passages sans leurs
 * vecteurs (ou en insère sans embedding) laisse des vecteurs orphelins qui
 * occupent des places du k-NN, et des passages que la recherche dense ne verra
 * jamais. On retire les premiers et on embarque les seconds.
 */
async function repare(): Promise<{ orphanVectors: number; chunksWithoutVectors: number }> {
	const chunks = db.query("SELECT rowid, title, content FROM rag_chunks").all() as {
		rowid: number;
		title: string;
		content: string;
	}[];
	const ids = new Set(chunks.map((c) => c.rowid));
	const vecIds = new Set((db.query("SELECT rowid FROM vec_chunks").all() as { rowid: number }[]).map((r) => r.rowid));
	const orphelins = [...vecIds].filter((id) => !ids.has(id));
	const sansVecteur = chunks.filter((c) => !vecIds.has(c.rowid));
	console.log(`→ réparation : ${orphelins.length} vecteurs orphelins, ${sansVecteur.length} passages sans vecteur.`);
	if (!APPLIQUER || (orphelins.length === 0 && sansVecteur.length === 0)) {
		return { orphanVectors: orphelins.length, chunksWithoutVectors: sansVecteur.length };
	}
	const vecteurs = await embarque(sansVecteur.map((c) => `${c.title}. ${c.content}`.slice(0, 1200)));
	db.run("BEGIN IMMEDIATE");
	try {
		const del = db.prepare("DELETE FROM vec_chunks WHERE rowid = ?");
		for (const id of orphelins) del.run(id);
		const ins = db.prepare("INSERT INTO vec_chunks (rowid, embedding) VALUES (?, ?)");
		// Un passage supprimé entre la lecture et l'écriture ne reçoit pas de vecteur.
		const encore = db.prepare("SELECT 1 FROM rag_chunks WHERE rowid = ?");
		for (const [i, c] of sansVecteur.entries()) {
			if (encore.get(c.rowid)) ins.run(c.rowid, new Uint8Array(vecteurs[i]!.buffer));
		}
		db.run("COMMIT");
	} catch (err) {
		db.run("ROLLBACK");
		throw err;
	}
	console.log(`✓ réparation : −${orphelins.length} orphelins, +${sansVecteur.length} vecteurs.`);
	return { orphanVectors: orphelins.length, chunksWithoutVectors: sansVecteur.length };
}

const cibles = TOUTES ? SOURCES : CIBLES;
const total = { added: 0, removed: 0, unchanged: 0 };
const sourceReports: Array<Awaited<ReturnType<typeof resynchronise>>> = [];
let repairReport = { orphanVectors: 0, chunksWithoutVectors: 0 };
try {
	for (const source of cibles) {
		try {
			const b = await resynchronise(source);
			sourceReports.push(b);
			total.added += b.added;
			total.removed += b.removed;
			total.unchanged += b.unchanged;
		} catch (err) {
			console.error(`✗ ${source} : ${err instanceof Error ? err.message : String(err)}`);
			process.exitCode = 1;
		}
	}
	// Toujours en fin de passe complète : l'index sort aligné, quoi qu'aient fait
	// d'autres écrivains entre-temps.
	if (REPARER || TOUTES) repairReport = await repare();
} finally {
	await sql.end();
}

// `rag_meta.count` sert de compteur affiché (sonde, API de couverture) : le
// laisser sur la valeur du dernier build ferait mentir l'index sur lui-même.
if (APPLIQUER) {
	const [{ n }] = db.query("SELECT count(*) n FROM rag_chunks").all() as { n: number }[];
	db.run("UPDATE rag_meta SET count = ?, built_at = ?", [n, Date.now()]);
		console.log(`\n✓ index : ${n} chunks · +${total.added} −${total.removed} (${total.unchanged} inchangés).`);
} else {
	console.log("\n→ simulation : relancer avec --appliquer.");
}
if (REPORT_PATH) {
	await Bun.write(
		REPORT_PATH,
		`${JSON.stringify(
			{
				schema: "shenron-rag-resync/v1",
				generatedAt: new Date().toISOString(),
				mode: APPLIQUER ? "apply" : "simulation",
				sources: sourceReports,
				totals: { ...total, repair: repairReport },
			},
			null,
		2
		)}\n`
	);
	console.log(`✓ rapport JSON : ${REPORT_PATH}`);
}
db.close();
