import "reflect-metadata";
import "./wiki-write-guard";
import { container } from "tsyringe";
import { DatabaseService } from "~/db/index";
import { dbGames } from "~/db/schema";
import { logger } from "~/lib/logger";

async function runGameSeed() {
	const dbs = container.resolve(DatabaseService);
	const db = dbs.db;

	logger.info("→ Seeding Games from scraped Wikipedia list...");

	const gameNames = [
		"Super Butōden",
		"Super Butōden 2",
		"Super Butōden 3",
		"Shin Butōden",
		"Ultimate Butōden",
		"Extreme Butōden",
		"Idainaru Son Goku Densetsu",
		"Idainaru Dragon Ball Densetsu",
		"Budokai",
		"Budokai 2",
		"Budokai 3",
		"Shin Budokai",
		"Origins",
		"Origins 2",
		"Raging Blast",
		"Raging Blast 2",
		"Ultimate Tenkaichi",
		"Xenoverse",
		"Xenoverse 2",
		"Xenoverse 3",
		"The Legacy of Goku",
		"Supersonic Warriors",
		"Budokai Tenkaichi",
		"Sparking! Zero",
		"Side Story: Plan to Eradicate the Saiyans",
		"Buyū Retsuden",
		"Ultimate Battle 22",
		"Hyper Dimension",
		"Final Bout",
		"Legendary Super Warriors",
		"Taiketsu",
		"Advanced Adventure",
		"Sagas",
		"Transformation",
		"Super Dragon Ball Z",
		"Harukanaru Densetsu",
		"Burst Limit",
		"Infinite World",
		"Attack of the Saiyans",
		"Revenge of King Piccolo",
		"Evolution",
		"Online",
		"Heroes",
		"For Kinect",
		"Battle of Z",
		"Dokkan Battle",
		"Fusions",
		"FighterZ",
		"Legends",
		"Kakarot",
		"Famicom Jump: Hero Retsuden",
		"Famicom Jump II: Saikyō no Shichinin",
		"Jump Super Stars",
		"Battle Stadium D.O.N",
		"Jump Ultimate Stars",
		"J-Stars Victory VS",
		"Jump Force",
	];

	let inserted = 0;
	for (const name of gameNames) {
		const slug = name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/(^-|-$)/g, "");
		await db
			.insert(dbGames)
			.values({
				slug,
				title: name,
				platforms: "Unknown",
				releaseDate: null,
			})
			.onConflictDoNothing();
		inserted++;
	}

	logger.info(`✓ ${inserted} games inserted into db_games.`);
}

if (import.meta.main) {
	runGameSeed()
		.then(() => {
			const dbs = container.resolve(DatabaseService);
			return dbs.close();
		})
		.catch((err) => {
			console.error(err);
			process.exit(1);
		});
}
