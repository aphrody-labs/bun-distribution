/**
 * purge-orphan-manga-rag-chunks.ts — Supprime les chunks RAG manga « orphelins »
 * de `rag_chunks` (FTS5) + `vec_chunks` (vec0), c.-à-d. les chunks `kind IN
 * ('manga_volume','manga_chapter')` qu'un `rag:build` frais NE produirait PLUS
 * (leur tome/chapitre a été supprimé de la base — cf. purge des entrées manga
 * fantômes 2026-07-04). Évite un `rag:build` complet (~15 min, DDL DROP qui gèle
 * les handlers) quand seuls quelques chunks obsolètes doivent partir.
 *
 * Identification SANS colonne d'id : on reproduit À L'IDENTIQUE les templates
 * title+content de `rag-build.ts` (:242-244 volumes, :261-263 chapitres, collapse
 * whitespace de `add()` :101) depuis la base ACTUELLE → l'ensemble des clés
 * « valides ». Un chunk manga est orphelin ssi sa clé (title\x00content) n'y est
 * pas. Garde-fou anti-sur-suppression : on refuse de committer si une entité
 * manga actuelle n'a plus AUCUN chunk (couverture incomplète = template dérivé).
 *
 * rag_chunks et vec_chunks partagent le rowid (rag-build.ts :515/:591-596) →
 * on supprime le même rowid dans les deux, en une transaction.
 *
 * bot.db est ouvert en écriture : LANCER BOT ARRÊTÉ (piège lock SQLite →
 * handlers Bun.serve figés). Idempotent. Usage :
 *   sudo systemctl stop shenron
 *   cd apps/bot && bun scripts/purge-orphan-manga-rag-chunks.ts [--dry-run]
 *   sudo systemctl start shenron
 */
import { Database } from "bun:sqlite";
import * as sqliteVec from "sqlite-vec";

const DBP = process.env.RAG_DB ?? new URL("../data/bot.db", import.meta.url).pathname;
const DRY = process.argv.includes("--dry-run");

const db = new Database(DBP);
sqliteVec.load(db);

const s = (v: unknown) => (v == null ? "" : String(v));
const collapse = (c: string) => c.replace(/\s+/g, " ").trim();
const KEYSEP = "\x00";

type Row = Record<string, unknown>;
const q = (sql: string) => db.query(sql).all() as Row[];

// ── Ensemble des clés VALIDES reproduites depuis la base actuelle ────────────
const valid = new Set<string>();

// Volumes (rag-build.ts:240-247)
for (const v of q(
	`SELECT id, series, volume_number, title, title_ja, isbn FROM db_manga_volumes`
)) {
	const title = `Volume ${s(v.volume_number)} — ${s(v.title)}`;
	const content = collapse(
		`Volume ${s(v.volume_number)} du manga ${s(v.series)}${v.title ? ` intitulé ${s(v.title)}` : ""}${v.title_ja ? ` (${s(v.title_ja)})` : ""}.${v.isbn ? ` ISBN: ${s(v.isbn)}` : ""}`
	);
	valid.add(title + KEYSEP + content);
}
// Chapitres (rag-build.ts:250-266)
for (const ch of q(
	`SELECT id, series, chapter_number, title, title_ja, volume_id FROM db_manga_chapters`
)) {
	const vol = ch.volume_id
		? (q(`SELECT volume_number FROM db_manga_volumes WHERE id = ${Number(ch.volume_id)}`)[0] as
				| Row
				| undefined)
		: undefined;
	const volCtx = vol ? ` (Volume ${s(vol.volume_number)})` : "";
	const title = `Chapitre ${s(ch.chapter_number)} — ${s(ch.title)}`;
	const content = collapse(
		`Chapitre ${s(ch.chapter_number)} du manga ${s(ch.series)}${volCtx}${ch.title ? ` intitulé ${s(ch.title)}` : ""}${ch.title_ja ? ` (${s(ch.title_ja)})` : ""}`
	);
	valid.add(title + KEYSEP + content);
}
console.log(`clés valides reproduites (entités manga actuelles) : ${valid.size}`);

// ── Chunks manga stockés → orphelins ────────────────────────────────────────
const chunks = q(
	`SELECT rowid, kind, title, content FROM rag_chunks WHERE kind IN ('manga_volume','manga_chapter')`
);
const orphanRowids: number[] = [];
const coveredValid = new Set<string>();
for (const c of chunks) {
	const key = s(c.title) + KEYSEP + s(c.content); // content déjà collapse en base
	if (valid.has(key)) coveredValid.add(key);
	else orphanRowids.push(Number(c.rowid));
}

const totalManga = chunks.length;
const uncovered = [...valid].filter((k) => !coveredValid.has(k));
console.log(
	`chunks manga stockés : ${totalManga} · valides couverts : ${coveredValid.size} · ORPHELINS : ${orphanRowids.length}`
);

// ── Garde-fous ──────────────────────────────────────────────────────────────
if (uncovered.length > 0) {
	console.error(
		`✗ ABORT : ${uncovered.length} entité(s) manga actuelle(s) SANS chunk correspondant → template dérivé, risque de sur-suppression. Exemple:`,
		uncovered[0]
	);
	db.close();
	process.exit(1);
}
if (orphanRowids.length === 0) {
	console.log("✓ aucun chunk manga orphelin — rien à faire.");
	db.close();
	process.exit(0);
}
if (orphanRowids.length >= totalManga) {
	console.error(
		`✗ ABORT : suppression de TOUS les chunks manga (${orphanRowids.length}/${totalManga}) — incohérent.`
	);
	db.close();
	process.exit(1);
}

const [{ pre_rag }] = q(`SELECT count(*) AS pre_rag FROM rag_chunks`) as any;
const [{ pre_vec }] = q(`SELECT count(*) AS pre_vec FROM vec_chunks`) as any;

if (DRY) {
	console.log(
		`· DRY-RUN : ${orphanRowids.length} rowids seraient supprimés de rag_chunks + vec_chunks (pre rag=${pre_rag} vec=${pre_vec}).`
	);
	db.close();
	process.exit(0);
}

// ── Suppression transactionnelle (même rowid dans les deux tables) ───────────
db.run("BEGIN");
try {
	const delRag = db.prepare(`DELETE FROM rag_chunks WHERE rowid = ?`);
	const delVec = db.prepare(`DELETE FROM vec_chunks WHERE rowid = ?`);
	for (const rid of orphanRowids) {
		delRag.run(rid);
		delVec.run(rid);
	}
	// Vérif in-tx
	const postRag = (q(`SELECT count(*) AS n FROM rag_chunks`)[0] as any).n as number;
	const postVec = (q(`SELECT count(*) AS n FROM vec_chunks`)[0] as any).n as number;
	if (postRag !== pre_rag - orphanRowids.length || postVec !== pre_vec - orphanRowids.length) {
		throw new Error(
			`compte post incohérent : rag ${pre_rag}->${postRag}, vec ${pre_vec}->${postVec}, attendu -${orphanRowids.length}`
		);
	}
	// Chunks manga restants = total - orphelins (les chunks à clé valide, doublons
	// de clé inclus, sont conservés → peut dépasser le nb de clés distinctes).
	const remainingManga = (
		q(
			`SELECT count(*) AS n FROM rag_chunks WHERE kind IN ('manga_volume','manga_chapter')`
		)[0] as any
	).n as number;
	if (remainingManga !== totalManga - orphanRowids.length) {
		throw new Error(
			`chunks manga restants ${remainingManga} ≠ attendu ${totalManga - orphanRowids.length}`
		);
	}
	db.run("COMMIT");
	console.log(
		`✓ COMMIT : rag_chunks ${pre_rag}→${postRag} · vec_chunks ${pre_vec}→${postVec} · chunks manga restants ${remainingManga}`
	);
} catch (e) {
	db.run("ROLLBACK");
	console.error("✗ ROLLBACK :", (e as Error).message);
	db.close();
	process.exit(1);
}

db.run(`PRAGMA wal_checkpoint(TRUNCATE)`);
db.close();
console.log("✓ Purge des chunks RAG manga orphelins terminée. (redémarrer shenron)");
