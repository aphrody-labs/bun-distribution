import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const DOC_URL =
	"https://docs.google.com/document/d/1q4z5Bhva42er9AFxS7RyUDtONivwi_tnin9CSwVGt4g/export?format=txt";
const OUT_DIR = join(import.meta.dirname, "../data");
const OUT_PATH = join(OUT_DIR, "doc-links.json");

async function main() {
	console.log("=== RÉCUPÉRATION DES LIENS DU GOOGLE DOC ===");
	console.log(`URL: ${DOC_URL}\n`);

	try {
		const response = await fetch(DOC_URL);
		if (!response.ok) {
			throw new Error(`Erreur HTTP: ${response.status} ${response.statusText}`);
		}

		const text = await response.text();

		// Expression régulière pour capturer les URLs http/https
		const urlRegex = /https?:\/\/[^\s"']+/g;
		const matches = text.match(urlRegex) || [];

		// Nettoyer et dédupliquer les URLs
		const urls = Array.from(new Set(matches.map((url) => url.trim().replace(/[.,;)]$/, ""))));

		console.log(`✓ Récupération réussie !`);
		console.log(`Nombre total de liens uniques trouvés: ${urls.length}\n`);

		if (!existsSync(OUT_DIR)) {
			mkdirSync(OUT_DIR, { recursive: true });
		}

		// Écrire les liens sous forme de fichier JSON
		writeFileSync(OUT_PATH, JSON.stringify({ source: DOC_URL, urls }, null, 2), "utf-8");
		console.log(`✓ Fichier écrit avec succès dans: ${OUT_PATH}`);

		// Afficher les 10 premiers liens en aperçu
		console.log("\nAperçu des 10 premiers liens :");
		urls.slice(0, 10).forEach((url, i) => {
			console.log(`  [${i + 1}] ${url}`);
		});
	} catch (error) {
		console.error("✗ Échec de la récupération ou de l'écriture :", error);
		process.exit(1);
	}
}

main();
