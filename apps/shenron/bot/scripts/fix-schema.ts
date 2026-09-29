import { DatabaseService } from "../src/db/index";
import "reflect-metadata";
import { container } from "tsyringe";

async function main() {
	const dbs = container.resolve(DatabaseService);
	console.log("🛠️ Création manuelle de la table db_tools...");

	try {
		dbs.runRaw(`
			CREATE TABLE IF NOT EXISTS db_tools (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				slug TEXT NOT NULL UNIQUE,
				name TEXT NOT NULL,
				description TEXT,
				url TEXT NOT NULL,
				author TEXT,
				language TEXT,
				category TEXT,
				target_game_id INTEGER,
				stars INTEGER DEFAULT 0
			);
		`);
		console.log("✅ Table db_tools créée ou déjà existante.");

		try {
			dbs.runRaw("ALTER TABLE db_episodes ADD COLUMN video_url TEXT;");
			console.log("✅ Colonne video_url ajoutée à db_episodes.");
		} catch (e) {}

		try {
			dbs.runRaw("ALTER TABLE db_movies ADD COLUMN trailer_url TEXT;");
			console.log("✅ Colonne trailer_url ajoutée à db_movies.");
		} catch (e) {}
	} catch (err) {
		console.error("❌ Erreur lors de la création de la table:", err);
	} finally {
		dbs.close();
	}
}

main();
