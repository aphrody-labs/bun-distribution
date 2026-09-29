/**
 * Script d'importation des outils communautaires depuis le rapport GitHub.
 * Analyse le rapport Markdown et insère les projets pertinents dans la table db_tools.
 */
import { db } from "./_db";
import { dbTools, dbGames } from "../../src/db/schema";
import { eq, like } from "drizzle-orm";
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

		console.log("🚀 Début de l'importation des outils communautaires depuis GitHub...");

		for (const line of lines) {
			if (!line.startsWith("| [")) continue;
			if (line.includes("Projet | Stars")) continue;

			const parts = line.split("|").map((p) => p.trim());
			if (parts.length < 5) continue;

			const nameMatch = parts[1].match(/\[(.*?)\]\((.*?)\)/);
			if (!nameMatch) continue;

			const fullName = nameMatch[1];
			const url = nameMatch[2];
			const stars = parseInt(parts[2].replace("⭐", "").trim());
			const language = parts[3];
			const description = parts[4];

			// Détection de la catégorie
			let category = "utility";
			if (
				description.toLowerCase().includes("modding") ||
				description.toLowerCase().includes("tool")
			)
				category = "modding";
			if (description.toLowerCase().includes("shader")) category = "shader";
			if (description.toLowerCase().includes("api")) category = "api";
			if (description.toLowerCase().includes("engine")) category = "engine";

			// Filtrage : on veut les outils, pas les jeux (déjà importés ou à ignorer ici)
			const isTool =
				description.toLowerCase().includes("tool") ||
				description.toLowerCase().includes("modding") ||
				description.toLowerCase().includes("shader") ||
				description.toLowerCase().includes("manager") ||
				description.toLowerCase().includes("editor") ||
				description.toLowerCase().includes("decryptor") ||
				description.toLowerCase().includes("api") ||
				description.toLowerCase().includes("library") ||
				description.toLowerCase().includes("recompiled");

			if (fullName.toLowerCase().includes("debezium")) continue;

			if (isTool && stars >= 2) {
				const slug = slugify(fullName.replace("/", "-"));

				const exists = await db.select().from(dbTools).where(eq(dbTools.slug, slug)).limit(1);

				if (exists.length === 0) {
					// Tentative de liaison avec un jeu
					let targetGameId: number | null = null;
					const gameKeywords = [
						{ kw: "xenoverse", slug: "xenoverse-2" },
						{ kw: "fighterz", slug: "fighterz" },
						{ kw: "kakarot", slug: "kakarot" },
						{ kw: "sparking", slug: "sparking-zero" },
						{ kw: "budokai", slug: "budokai-3" },
						{ kw: "tenkaichi", slug: "tenkaichi-3" },
						{ kw: "legends", slug: "legends" },
						{ kw: "dokkan", slug: "dokkan-battle" },
					];

					for (const gk of gameKeywords) {
						if (
							description.toLowerCase().includes(gk.kw) ||
							fullName.toLowerCase().includes(gk.kw)
						) {
							const game = await db
								.select()
								.from(dbGames)
								.where(eq(dbGames.slug, gk.slug))
								.limit(1);
							if (game.length > 0) targetGameId = game[0].id;
							break;
						}
					}

					await db.insert(dbTools).values({
						slug,
						name: fullName,
						description,
						url,
						author: fullName.split("/")[0],
						language,
						category,
						targetGameId,
						stars,
					});
					imported++;
					console.log(`✅ Outil importé : ${fullName} (${category})`);
				} else {
					skipped++;
				}
			}
		}

		console.log(`\n📊 Importation terminée !`);
		console.log(`✨ Nouveaux outils importés : ${imported}`);
		console.log(`⏭️ Déjà présents / ignorés : ${skipped}`);
	} catch (err) {
		console.error("❌ Erreur lors de l'importation:", err);
		process.exit(1);
	}
}

main();
