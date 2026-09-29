// SPDX-License-Identifier: Apache-2.0
import { Database } from "bun:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";

function inspect(name: string, path: string) {
	try {
		const db = new Database(path);
		console.log(`=== ${name} (${path}) ===`);
		const tables = db.query("SELECT name FROM sqlite_master WHERE type='table'").all() as any[];
		for (const t of tables) {
			const count = db.query(`SELECT COUNT(*) as c FROM "${t.name}"`).get() as any;
			console.log(`  Table: ${t.name} -> ${count?.c} entrées`);
		}
		if (tables.some((t) => t.name === "documents")) {
			const samples = db.query("SELECT id, title, source, LENGTH(content) as len FROM documents LIMIT 5").all();
			console.log("  Exemples documents:", samples);
			const sources = db.query("SELECT source, COUNT(*) as c FROM documents GROUP BY source").all();
			console.log("  Sources documents:", sources);
		}
		if (tables.some((t) => t.name === "ocr_pages")) {
			const samples = db.query("SELECT * FROM ocr_pages LIMIT 5").all();
			console.log("  Exemples ocr_pages:", samples);
		}
	} catch (e: any) {
		console.log(`=== ${name} Erreur: ${e.message} ===`);
	}
}

const workspace = process.env.APHRODY_WORKSPACE?.trim() || join(homedir(), ".aphrody", "workspace");
inspect("knowledge.db", join(workspace, "knowledge.db"));
inspect("ocr/results.db", join(workspace, "ocr", "results.db"));
