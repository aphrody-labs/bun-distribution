/**
 * notebooklm-sync.ts — Synchronise le corpus RAG Dragon Ball avec Google NotebookLM (PLAN B2).
 *
 * Scanne le dossier `data/rag/` pour trouver les fichiers Markdown du corpus,
 * cherche ou crée un notebook nommé « Dragon Ball Canon » via le CLI `aphrody`,
 * et y téléverse séquentiellement tous les fichiers du corpus.
 *
 * Requiert les variables d'environnement configurées pour NotebookLM :
 * - NOTEBOOKLM_AT_TOKEN
 * - NOTEBOOKLM_BL_TOKEN
 * - NOTEBOOKLM_COOKIES ou NOTEBOOKLM_OAUTH_TOKEN
 *
 * Usage : bun apps/bot/scripts/notebooklm-sync.ts
 */
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const RAG_DIR = new URL("../data/rag/", import.meta.url).pathname;
const APHRODY_BIN = "/home/ubuntu/.local/bin/aphrody";

async function runCmd(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
	const proc = Bun.spawn([APHRODY_BIN, ...args], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const stdout = await new Response(proc.stdout).text();
	const stderr = await new Response(proc.stderr).text();
	const code = await proc.exited;
	return { code, stdout, stderr };
}

async function findOrCreateNotebook(title: string): Promise<string | null> {
	console.log(`[NOTEBOOKLM] Recherche du notebook « ${title} »…`);
	const listRes = await runCmd(["notebooklm", "list"]);
	if (listRes.code !== 0) {
		console.error("✗ Échec de la récupération de la liste des notebooks :");
		console.error(listRes.stderr || listRes.stdout);
		return null;
	}

	// Exemple de format attendu dans stdout :
	// ID_NOTEBOOK  Title: Dragon Ball Canon
	// On parse les lignes
	const lines = listRes.stdout.split("\n");
	for (const line of lines) {
		if (line.includes(title)) {
			const match = line.match(/^([a-zA-Z0-9_-]+)\s+/);
			if (match) {
				console.log(`✓ Notebook existant trouvé : ID = ${match[1]}`);
				return match[1];
			}
		}
	}

	console.log(`[NOTEBOOKLM] Aucun notebook trouvé. Création de « ${title} »…`);
	const createRes = await runCmd(["notebooklm", "create", "--title", title]);
	if (createRes.code !== 0) {
		console.error("✗ Échec de la création du notebook :");
		console.error(createRes.stderr || createRes.stdout);
		return null;
	}

	// Recherche de l'ID créé dans la sortie
	// Souvent format: Created notebook: ID_NOTEBOOK
	const idMatch =
		createRes.stdout.match(/Created\s+(?:notebook)?\s*:?\s*([a-zA-Z0-9_-]+)/i) ||
		createRes.stdout.match(/([a-zA-Z0-9_-]+)/);
	if (idMatch) {
		console.log(`✓ Notebook créé avec succès : ID = ${idMatch[1]}`);
		return idMatch[1];
	}

	// Fallback: ré-interroger la liste pour récupérer le nouvel ID
	console.log("[NOTEBOOKLM] ID introuvable dans la sortie, interrogation de la liste…");
	const list2 = await runCmd(["notebooklm", "list"]);
	for (const line of list2.stdout.split("\n")) {
		if (line.includes(title)) {
			const match = line.match(/^([a-zA-Z0-9_-]+)\s+/);
			if (match) return match[1];
		}
	}

	return null;
}

async function main() {
	if (!existsSync(RAG_DIR)) {
		console.error(`✗ Dossier RAG introuvable : ${RAG_DIR}`);
		process.exit(1);
	}

	// Récupère les fichiers markdown (.md)
	const files = readdirSync(RAG_DIR)
		.filter((f) => f.endsWith(".md"))
		.map((f) => join(RAG_DIR, f));

	console.log(`[NOTEBOOKLM] ${files.length} fichiers Markdown trouvés à synchroniser.`);
	if (files.length === 0) {
		console.log("[NOTEBOOKLM] Aucun fichier à traiter.");
		return;
	}

	const notebookId = await findOrCreateNotebook("Dragon Ball Canon");
	if (!notebookId) {
		console.error(
			"✗ Impossible d'initialiser le notebook dans NotebookLM. Vérifiez vos cookies/tokens."
		);
		process.exit(1);
	}

	console.log(`\n[NOTEBOOKLM] Début de la synchronisation vers le notebook ${notebookId}…`);
	let uploaded = 0;
	for (let i = 0; i < files.length; i++) {
		const filePath = files[i];
		const fileName = filePath.split("/").pop() || "";
		console.log(`[${i + 1}/${files.length}] Téléversement de ${fileName}…`);

		const uploadRes = await runCmd(["notebooklm", "upload", notebookId, filePath]);
		if (uploadRes.code === 0) {
			console.log(`   ✓ Réussi`);
			uploaded++;
		} else {
			console.error(`   ✗ Échec du téléversement :`);
			console.error(uploadRes.stderr || uploadRes.stdout);
		}

		// Petite pause de politesse entre les uploads
		await new Promise((r) => setTimeout(r, 1000));
	}

	console.log(`\n=== SYNCHRONISATION TERMINÉE ===`);
	console.log(`Fichiers téléversés avec succès : ${uploaded}/${files.length}`);
}

main().catch((err) => {
	console.error("✗ Erreur fatale lors de la synchronisation NotebookLM :", err);
	process.exit(1);
});
