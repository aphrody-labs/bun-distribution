/**
 * Script d'importation des jeux Dragon Ball depuis le rapport GitHub.
 * Analyse le rapport Markdown et insère les projets pertinents dans la table db_games.
 */
import { db } from "./_db";
import { dbGames } from "../../src/db/schema";
import { eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPORT_PATH = join(process.cwd(), "reports/github-scan-2026-05-19.md");

function slugify(text: string) {
	return text
		.toString()
		.toLowerCase()
		.trim()
		.replace(/\s+/g, "-")
		.replace(/[^\w-]+/g, "")
		.replace(/--+/g, "-");
}

async function main() {
	try {
		const content = readFileSync(REPORT_PATH, "utf-8");
		const lines = content.split("\n");
		let imported = 0;
		let skipped = 0;

		console.log("🚀 Début de l'importation des jeux depuis GitHub...");

		for (const line of lines) {
			// Format attendu : | [Projet](URL) | ⭐ Stars | Langage | Description |
			if (!line.startsWith("| [")) continue;
			if (line.includes("Projet | Stars")) continue; // Header

			const parts = line.split("|").map((p) => p.trim());
			if (parts.length < 5) continue;

			const nameMatch = parts[1].match(/\[(.*?)\]\((.*?)\)/);
			if (!nameMatch) continue;

			const fullName = nameMatch[1];
			const url = nameMatch[2];
			const stars = parseInt(parts[2].replace("⭐", "").trim());
			const language = parts[3];
			const description = parts[4];

			// Filtrage : on ne veut que les projets qui ressemblent à des jeux ou outils de modding
			const isGameRelated =
				description.toLowerCase().includes("game") ||
				description.toLowerCase().includes("modding") ||
				description.toLowerCase().includes("engine") ||
				description.toLowerCase().includes("recompiled") ||
				description.toLowerCase().includes("emulator") ||
				fullName.toLowerCase().includes("game") ||
				fullName.toLowerCase().includes("online");

			// Ignorer les faux positifs (ex: debezium)
			if (fullName.toLowerCase().includes("debezium")) continue;

			if (isGameRelated && stars >= 5) {
				const slug = slugify(fullName.replace("/", "-"));

				const exists = await db.select().from(dbGames).where(eq(dbGames.slug, slug)).limit(1);

				if (exists.length === 0) {
					await db.insert(dbGames).values({
						slug,
						title: fullName,
						description: `${description} (Projet GitHub communautaire)`,
						platforms: language || "GitHub",
						officialUrl: url,
						publisher: "Communauté GitHub",
						developer: fullName.split("/")[0],
						releaseDate: new Date(), // Date d'import
					});
					imported++;
					console.log(`✅ Importé : ${fullName}`);
				} else {
					skipped++;
				}
			}
		}

		console.log(`\n📊 Importation terminée !`);
		console.log(`✨ Nouveaux jeux importés : ${imported}`);
		console.log(`⏭️ Déjà présents / ignorés : ${skipped}`);
	} catch (err) {
		console.error("❌ Erreur lors de l'importation:", err);
		process.exit(1);
	}
}

main();
