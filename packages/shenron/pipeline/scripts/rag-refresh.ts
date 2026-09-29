/**
 * rag-refresh.ts — Orchestrateur hebdomadaire de rafraîchissement RAG.
 *
 * 1. Copie de travail de bot.db vers /tmp (le build n'écrit jamais la base servie).
 * 2. Reconstruction de l'index sur cette copie (`RAG_DB`).
 * 3. Réinjection des seules tables d'index (`rag_chunks`, `vec_chunks`, `rag_meta`)
 *    dans la base de production, sous transaction.
 * 4. Évaluation RAG.
 *
 * Le crawl Fandom qui alimentait autrefois les étapes 1 et 2 a été retiré :
 * Fandom est une source interdite (cf. CLAUDE.md), et ce timer le réintroduisait
 * chaque dimanche dans l'index. Le corpus licite (databooks, manga, Kanzenshuu,
 * tables éditoriales PostgreSQL) est rafraîchi par ses propres ingests.
 *
 * Remplacer la base entière par la copie ferait perdre les écritures runtime du
 * bot (économie, niveaux, tickets) faites pendant le build : on ne recopie donc
 * que l'index.
 *
 * Usage : bun apps/shenron/bot/scripts/rag-refresh.ts [--no-vectors]
 */
import { Database } from "bun:sqlite";
import { copyFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import * as sqliteVec from "sqlite-vec";

import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const BOT_DIR = join(ROOT, "apps/shenron/bot");
const DB_PROD = join(BOT_DIR, "data/bot.db");
import os from "node:os";

const DB_TMP = join(os.tmpdir(), "shenron-rag.db");
const noVectors = process.argv.includes("--no-vectors");

async function runCmd(cmd: string[], env: Record<string, string> = {}, cwd = ROOT): Promise<void> {
	console.log(`[RAG-REFRESH] Exécution: ${cmd.join(" ")}`);
	const proc = Bun.spawn(cmd, {
		cwd,
		stdout: "inherit",
		stderr: "inherit",
		env: { ...process.env, ...env },
	});
	const code = await proc.exited;
	if (code !== 0) {
		throw new Error(`Échec de la commande (exit code: ${code}): ${cmd.join(" ")}`);
	}
}

/** Recopie l'index fraîchement construit dans la base servie, sans toucher au runtime. */
function reinjecterIndex(source: string, cible: string): void {
	const db = new Database(cible);
	db.exec("PRAGMA busy_timeout = 60000");
	sqliteVec.load(db);
	db.run(`ATTACH DATABASE '${source.replace(/'/g, "''")}' AS neuf`);
	try {
		db.transaction(() => {
			db.run("DELETE FROM rag_chunks");
			db.run(
				"INSERT INTO rag_chunks(rowid, kind, title, url, content, lang, source_id, entity) " +
					"SELECT rowid, kind, title, url, content, lang, source_id, entity FROM neuf.rag_chunks"
			);
			db.run("DELETE FROM vec_chunks");
			db.run("INSERT INTO vec_chunks(rowid, embedding) SELECT rowid, embedding FROM neuf.vec_chunks");
			db.run("DELETE FROM rag_meta");
			db.run("INSERT INTO rag_meta SELECT * FROM neuf.rag_meta");
		})();
	} finally {
		db.run("DETACH DATABASE neuf");
		db.close();
	}
}

async function main() {
	console.log("=== DÉBUT DU RAFRAÎCHISSEMENT RAG HEBDOMADAIRE ===");
	if (process.env.RAG_BACKEND === "aphrody") {
		await runCmd(["bun", "packages/shenron/pipeline/scripts/rag-sync-aphrody.ts", "--toutes", "--appliquer", "--force"]);
		await runCmd(["bun", "scripts/ops/eval-aphrody-rag.ts", "--ci"]);
		console.log("✓ Corpus Aphrody synchronisé et évalué.");
		return;
	}

	if (!existsSync(DB_PROD)) throw new Error(`Base de production introuvable : ${DB_PROD}`);

	console.log("\n[RAG-REFRESH] 1. Copie de travail…");
	rmSync(DB_TMP, { force: true });
	copyFileSync(DB_PROD, DB_TMP);

	console.log("\n[RAG-REFRESH] 2. Construction de l'index sur la copie…");
	await runCmd(
		["bun", "packages/shenron/pipeline/scripts/rag-build.ts", ...(noVectors ? ["--no-vectors"] : [])],
		{ RAG_DB: DB_TMP }
	);

	console.log("\n[RAG-REFRESH] 3. Réinjection de l'index dans la base servie…");
	copyFileSync(DB_PROD, `${DB_PROD}.bak`);
	reinjecterIndex(DB_TMP, DB_PROD);
	console.log("✓ Index RAG mis à jour (runtime préservé).");

	console.log("\n[RAG-REFRESH] 4. Lancement de l'évaluation RAG…");
	await runCmd(["bun", "apps/shenron/bot/scripts/rag-eval.ts"]);

	console.log("\n=== RAFRAÎCHISSEMENT RAG TERMINÉ AVEC SUCCÈS ===");
}

main().catch((err) => {
	console.error("\n✗ [RAG-REFRESH] ERREUR FATALE:", err);
	process.exit(1);
});
